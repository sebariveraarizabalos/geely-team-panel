import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from agent.binance_client import BinanceAPIError, BinanceConnectionError
from agent.config import Config
from agent.models import Candle, Signal
from agent.risk import RiskManager, SymbolFilters
from agent.runner import Agent, ExchangeExecutor, PaperAccount, ProtectionError
from tests.helpers import HOUR, make_candles

FILTERS = SymbolFilters(Decimal("0.001"), Decimal("0.001"), Decimal("0.1"), Decimal("5"))
SIGNAL = Signal("LONG", 100.0, 98.0, 104.0, "test")
NOW_S = 1_800_000_000
NOW_MS = NOW_S * 1000


class MemJournal:
    def __init__(self):
        self.events = []

    def log(self, event, **fields):
        self.events.append((event, fields))

    def names(self):
        return [e for e, _ in self.events]


class FakeClient:
    def __init__(self, candles=None, fail=(), held=None, algo_open=()):
        self.candles, self.fail, self.held = candles or [], set(fail), held or {}
        self.algo_open, self.calls = list(algo_open), []

    def klines(self, symbol, interval, limit=500, end_time=None):
        if "klines" in self.fail:
            raise BinanceConnectionError("down")
        return self.candles

    def symbol_filters(self, symbol):
        return FILTERS

    def set_margin_type(self, symbol, margin_type="ISOLATED"):
        self.calls.append(("margin", margin_type))

    def set_leverage(self, symbol, leverage):
        self.calls.append(("leverage", leverage))

    def market_order(self, symbol, side, qty, *, reduce_only=False, client_id=None):
        self.calls.append(("market", side, str(qty), reduce_only))
        if reduce_only and "flatten" in self.fail:
            raise BinanceAPIError(400, -1, "flatten rejected")
        if not reduce_only and "market" in self.fail:
            raise BinanceAPIError(400, -2019, "Margin is insufficient.")
        if not reduce_only and "market_timeout" in self.fail:
            raise BinanceConnectionError("timeout")
        return {"avgPrice": "100.0"}

    def algo_order(self, symbol, side, order_type, trigger_price, client_id=None):
        self.calls.append(("algo", side, order_type, str(trigger_price)))
        if order_type in self.fail:
            raise BinanceAPIError(400, -4120, "order type not supported")
        return {"algoId": 1}

    def positions(self):
        return self.held

    def open_algo_orders(self, symbol):
        return self.algo_open

    def cancel_algo_order(self, symbol, algo_id):
        self.calls.append(("cancel", algo_id))


class ExchangeExecutorTests(unittest.TestCase):
    def make(self, **kw):
        self.client = FakeClient(**kw)
        self.journal = MemJournal()
        return ExchangeExecutor(self.client, Config(), self.journal)

    def enter(self, executor):
        return executor.enter("BTCUSDT", SIGNAL, Decimal("2.5"), FILTERS, 0)

    def test_entry_places_market_then_stop_then_target(self):
        self.enter(self.make())
        self.assertEqual(self.client.calls, [
            ("margin", "ISOLATED"), ("leverage", 3), ("market", "BUY", "2.5", False),
            ("algo", "SELL", "STOP_MARKET", "98.0"), ("algo", "SELL", "TAKE_PROFIT_MARKET", "104.0"),
        ])

    def test_stop_failure_flattens_immediately_and_raises(self):
        executor = self.make(fail={"STOP_MARKET"})
        with self.assertRaises(ProtectionError) as ctx:
            self.enter(executor)
        self.assertTrue(ctx.exception.flat)
        self.assertIn(("market", "SELL", "2.5", True), self.client.calls)
        self.assertNotIn(("algo", "SELL", "TAKE_PROFIT_MARKET", "104.0"), self.client.calls)
        self.assertIn("emergency_flatten", self.journal.names())

    def test_failed_flatten_is_reported_as_critical(self):
        executor = self.make(fail={"STOP_MARKET", "flatten"})
        with self.assertRaises(ProtectionError) as ctx:
            self.enter(executor)
        self.assertFalse(ctx.exception.flat)
        self.assertIn("critical", self.journal.names())

    def test_target_failure_keeps_the_protected_position(self):
        result = self.enter(self.make(fail={"TAKE_PROFIT_MARKET"}))
        self.assertEqual(result["venue"], "exchange")
        self.assertIn("warning", self.journal.names())

    def test_rejected_entry_places_no_protective_orders(self):
        executor = self.make(fail={"market"})
        with self.assertRaises(BinanceAPIError):
            self.enter(executor)
        self.assertFalse([c for c in self.client.calls if c[0] == "algo"])

    def test_entry_timeout_with_filled_position_still_gets_a_stop(self):
        executor = self.make(fail={"market_timeout"}, held={"BTCUSDT": {"qty": 2.5, "entry": 100.0}})
        result = self.enter(executor)
        self.assertEqual(result["qty"], "2.5")
        self.assertIn(("algo", "SELL", "STOP_MARKET", "98.0"), self.client.calls)

    def test_entry_timeout_without_position_aborts(self):
        executor = self.make(fail={"market_timeout"})
        with self.assertRaises(BinanceConnectionError):
            self.enter(executor)
        self.assertFalse([c for c in self.client.calls if c[0] == "algo"])

    def test_orphan_algo_orders_are_cancelled_when_flat(self):
        executor = self.make(algo_open=[{"algoId": 9}])
        executor.sync("BTCUSDT", [], set())
        self.assertIn(("cancel", 9), self.client.calls)

    def test_algo_orders_are_kept_while_position_is_open(self):
        executor = self.make(algo_open=[{"algoId": 9}])
        executor.sync("BTCUSDT", [], {"BTCUSDT"})
        self.assertNotIn(("cancel", 9), self.client.calls)


class FakeExecutor:
    def __init__(self, equity=1000.0, open_symbols=(), enter_error=None):
        self._equity, self.open, self.entered, self.enter_error = equity, set(open_symbols), [], enter_error

    def equity(self):
        return self._equity

    def open_symbols(self):
        return set(self.open)

    def sync(self, symbol, candles, open_symbols):
        pass

    def enter(self, symbol, signal, qty, filters, opened_ms):
        if self.enter_error:
            raise self.enter_error
        self.entered.append((symbol, signal.side, qty, opened_ms))
        return {"venue": "fake", "qty": str(qty)}


class AgentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.kill = Path(self.tmp.name) / "KILL"
        self.cfg = Config(symbols=["BTCUSDT"], state_path=str(Path(self.tmp.name) / "state.json"),
                          kill_switch_path=str(self.kill), max_open_positions=1)
        self.journal = MemJournal()
        self.now = NOW_S
        n = 300
        self.last_close = NOW_MS - 30_000
        start = self.last_close + 1 - n * HOUR
        self.candles = make_candles([100.0] * n, start=start)

    def build(self, executor=None, client=None, signal=SIGNAL, equity=None):
        self.executor = executor or FakeExecutor()
        self.client = client or FakeClient(candles=self.candles)
        self.signal_calls = []

        def signal_fn(candles, cfg):
            self.signal_calls.append(candles[-1].close_time)
            return signal

        risk = RiskManager(self.cfg, today=lambda: "2026-10-09")
        return Agent(self.cfg, self.client, self.executor, risk, self.journal, "test",
                     signal_fn=signal_fn, now=lambda: self.now, sleep=lambda s: None)

    def test_fresh_signal_opens_one_position_with_risk_based_size(self):
        agent = self.build()
        agent.run_once()
        self.assertEqual(self.executor.entered, [("BTCUSDT", "LONG", Decimal("2.5"), self.last_close)])
        self.assertIn("entry", self.journal.names())

    def test_stale_signal_is_ignored(self):
        self.now = NOW_S + 600
        agent = self.build()
        agent.run_once()
        self.assertEqual(self.executor.entered, [])
        self.assertEqual(self.signal_calls, [])

    def test_same_candle_is_never_traded_twice(self):
        agent = self.build()
        agent.run_once()
        agent.run_once()
        self.assertEqual(len(self.executor.entered), 1)

    def test_unfinished_candle_is_excluded(self):
        live = Candle(self.last_close + 1, 100, 101, 99, 100, 1, NOW_MS + 3_000_000)
        agent = self.build(client=FakeClient(candles=self.candles + [live]))
        agent.run_once()
        self.assertEqual(self.signal_calls, [self.last_close])

    def test_kill_switch_blocks_new_entries(self):
        self.kill.write_text("")
        agent = self.build()
        agent.run_once()
        self.assertEqual(self.executor.entered, [])
        self.assertIn("kill_switch_active", self.journal.names())

    def test_existing_position_blocks_new_entry_for_that_symbol(self):
        agent = self.build(executor=FakeExecutor(open_symbols={"BTCUSDT"}))
        agent.run_once()
        self.assertEqual(self.executor.entered, [])

    def test_position_cap_rejects_signal(self):
        agent = self.build(executor=FakeExecutor(open_symbols={"ETHUSDT"}))
        agent.run_once()
        self.assertEqual(self.executor.entered, [])
        self.assertIn("rejected", self.journal.names())

    def test_size_below_exchange_minimum_is_rejected(self):
        agent = self.build(executor=FakeExecutor(equity=10.0))
        agent.run_once()
        self.assertEqual(self.executor.entered, [])
        self.assertIn("rejected", self.journal.names())

    def test_no_signal_no_trade(self):
        agent = self.build(signal=None)
        agent.run_once()
        self.assertEqual(self.executor.entered, [])

    def test_protection_failure_halts_the_agent_permanently(self):
        agent = self.build(executor=FakeExecutor(enter_error=ProtectionError("stop failed", flat=True)))
        agent.run_once()
        self.assertIn("protection failure", agent.risk.halted_reason)
        self.assertTrue(agent.risk.state["halted_permanent"])
        self.assertIn("halted", self.journal.names())
        self.executor.enter_error = None
        agent._last_seen.clear()
        agent.run_once()
        self.assertEqual(self.executor.entered, [])

    def test_market_data_outage_does_not_crash_the_cycle(self):
        agent = self.build(client=FakeClient(candles=self.candles, fail={"klines"}))
        agent.run_once()
        self.assertIn("error", self.journal.names())
        self.assertEqual(self.executor.entered, [])


class PaperAccountTests(unittest.TestCase):
    def candle(self, t, o, h, l, c):
        return Candle(t, o, h, l, c, 1.0, t + 1)

    def test_take_profit_updates_equity(self):
        account = PaperAccount(1000.0, 0.0)
        account.open("BTCUSDT", SIGNAL, 2.5, opened_ms=100)
        events = account.update("BTCUSDT", [self.candle(150, 100, 105, 99, 104)])
        self.assertEqual(events[0]["reason"], "take_profit")
        self.assertAlmostEqual(account.equity, 1010.0)
        self.assertEqual(account.positions, {})

    def test_candles_before_the_entry_are_ignored(self):
        account = PaperAccount(1000.0, 0.0)
        account.open("BTCUSDT", SIGNAL, 2.5, opened_ms=100)
        self.assertEqual(account.update("BTCUSDT", [self.candle(50, 100, 120, 90, 100)]), [])
        self.assertIn("BTCUSDT", account.positions)

    def test_stop_loss_updates_equity(self):
        account = PaperAccount(1000.0, 0.0)
        account.open("BTCUSDT", SIGNAL, 2.5, opened_ms=100)
        account.update("BTCUSDT", [self.candle(150, 100, 101, 97, 98)])
        self.assertAlmostEqual(account.equity, 995.0)


if __name__ == "__main__":
    unittest.main()
