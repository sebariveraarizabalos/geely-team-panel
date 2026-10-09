import unittest

from agent.backtest import check_exit, run_backtest
from agent.config import Config
from agent.models import Candle, Signal
from tests.helpers import make_candles, trending


def candle(o, h, l, c, i=0):
    return Candle(i, o, h, l, c, 1.0, i + 1)


class ExitRuleTests(unittest.TestCase):
    def test_long_stop_and_target(self):
        self.assertEqual(check_exit("LONG", 95, 110, candle(100, 101, 94, 96)), (95, "stop"))
        self.assertEqual(check_exit("LONG", 95, 110, candle(100, 111, 99, 108)), (110, "take_profit"))
        self.assertIsNone(check_exit("LONG", 95, 110, candle(100, 105, 97, 102)))

    def test_candle_touching_both_levels_counts_as_stop(self):
        self.assertEqual(check_exit("LONG", 95, 110, candle(100, 112, 94, 100)), (95, "stop"))
        self.assertEqual(check_exit("SHORT", 105, 90, candle(100, 106, 89, 100)), (105, "stop"))

    def test_gap_through_stop_fills_at_open(self):
        self.assertEqual(check_exit("LONG", 95, 110, candle(92, 93, 90, 91)), (92, "stop_gap"))
        self.assertEqual(check_exit("SHORT", 105, 90, candle(108, 109, 107, 108)), (108, "stop_gap"))

    def test_short_target(self):
        self.assertEqual(check_exit("SHORT", 105, 90, candle(100, 101, 89, 92)), (90, "take_profit"))


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.cfg = Config(risk_per_trade_pct=1.0, max_leverage=10, fee_pct=0.0, slippage_pct=0.0)

    def _run(self, closes, signal_index, signal, equity=1000.0, cfg=None):
        candles = make_candles(closes, spread=0.0)
        fn = lambda i: signal if i == signal_index else None
        return run_backtest(candles, cfg or self.cfg, equity=equity, signal_fn=fn)

    def test_winning_trade_realises_reward_risk(self):
        closes = [100] * 5 + [100, 103, 106, 111, 112]
        signal = Signal("LONG", 100, 95, 110, "t")
        result = self._run(closes, 4, signal)
        self.assertEqual(len(result.trades), 1)
        trade = result.trades[0]
        self.assertEqual(trade.exit_reason, "take_profit")
        self.assertAlmostEqual(trade.r_multiple, 2.0)
        self.assertAlmostEqual(result.end_equity, 1020.0)

    def test_losing_trade_loses_exactly_the_risk(self):
        closes = [100] * 5 + [100, 98, 94, 93, 93]
        signal = Signal("LONG", 100, 95, 110, "t")
        result = self._run(closes, 4, signal)
        trade = result.trades[0]
        self.assertEqual(trade.exit_reason, "stop")
        self.assertAlmostEqual(trade.r_multiple, -1.0)
        self.assertAlmostEqual(result.end_equity, 990.0)
        self.assertGreater(result.max_drawdown_pct, 0)

    def test_short_trade_profits_when_price_falls(self):
        closes = [100] * 5 + [100, 97, 93, 89, 88]
        signal = Signal("SHORT", 100, 105, 90, "t")
        result = self._run(closes, 4, signal)
        self.assertEqual(result.trades[0].exit_reason, "take_profit")
        self.assertAlmostEqual(result.end_equity, 1020.0)

    def test_fees_and_slippage_reduce_pnl(self):
        closes = [100] * 5 + [100, 103, 106, 111, 112]
        signal = Signal("LONG", 100, 95, 110, "t")
        costly = Config(risk_per_trade_pct=1.0, max_leverage=10, fee_pct=0.1, slippage_pct=0.1)
        self.assertLess(self._run(closes, 4, signal, cfg=costly).end_equity, 1020.0)

    def test_open_position_is_closed_at_end_of_data(self):
        closes = [100] * 5 + [100, 101, 102, 103, 104]
        signal = Signal("LONG", 100, 95, 120, "t")
        result = self._run(closes, 4, signal)
        self.assertEqual(result.trades[0].exit_reason, "end_of_data")

    def test_entry_happens_on_next_candle_open_not_signal_close(self):
        closes = [100] * 5 + [110, 111, 112, 120, 121]
        candles = make_candles(closes, spread=0.0)
        signal = Signal("LONG", 100, 95, 110, "t")
        result = run_backtest(candles, self.cfg, signal_fn=lambda i: signal if i == 4 else None)
        self.assertAlmostEqual(result.trades[0].entry, candles[5].open)

    def test_position_size_respects_leverage_cap(self):
        closes = [100] * 5 + [100, 101, 102, 103, 104]
        signal = Signal("LONG", 100, 99.99, 120, "t")
        capped = Config(risk_per_trade_pct=1.0, max_leverage=2, fee_pct=0.0, slippage_pct=0.0)
        trade = self._run(closes, 4, signal, cfg=capped).trades[0]
        self.assertLessEqual(trade.qty * trade.entry, 2 * 1000.0 + 1e-6)

    def test_full_strategy_runs_end_to_end(self):
        cfg = Config()
        result = run_backtest(make_candles(trending(900, 0.001, amp=0.05)), cfg)
        summary = result.summary()
        self.assertGreater(summary["trades"], 0)
        self.assertGreaterEqual(summary["max_drawdown_pct"], 0)


if __name__ == "__main__":
    unittest.main()
