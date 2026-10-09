import json
import logging
import os
import time
from datetime import datetime, timezone

from .backtest import check_exit
from .binance_client import BinanceAPIError, BinanceConnectionError
from .config import Config
from .risk import RiskManager, SymbolFilters, position_size, round_to_tick, stop_price
from .strategy import generate_signal

log = logging.getLogger("agent.runner")

RETRYABLE = (BinanceAPIError, BinanceConnectionError)


class ProtectionError(Exception):
    """Raised when a position could not be protected with an exchange-side stop."""

    def __init__(self, message, flat):
        super().__init__(message)
        self.flat = flat


class Journal:
    def __init__(self, path):
        self.path = path

    def log(self, event, **fields):
        record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"), "event": event, **fields}
        with open(self.path, "a") as fh:
            fh.write(json.dumps(record, default=str) + "\n")
        log.info("%s %s", event, fields)
        return record


def _client_id(symbol: str, tag: str) -> str:
    return f"ta-{symbol}-{int(time.time())}-{tag}"[:36]


class PaperAccount:
    def __init__(self, equity: float, fee_pct: float):
        self.equity = equity
        self.fee = fee_pct / 100
        self.positions: dict = {}

    def open(self, symbol, signal, qty, opened_ms):
        self.equity -= qty * signal.entry * self.fee
        self.positions[symbol] = {
            "side": signal.side, "entry": signal.entry, "stop": signal.stop,
            "tp": signal.take_profit, "qty": qty, "opened_ms": opened_ms,
        }

    def update(self, symbol, candles) -> list:
        pos = self.positions.get(symbol)
        closed = []
        if not pos:
            return closed
        for c in candles:
            if c.open_time <= pos["opened_ms"]:
                continue
            hit = check_exit(pos["side"], pos["stop"], pos["tp"], c)
            if hit:
                price, reason = hit
                direction = 1 if pos["side"] == "LONG" else -1
                pnl = direction * (price - pos["entry"]) * pos["qty"] - pos["qty"] * price * self.fee
                self.equity += pnl
                del self.positions[symbol]
                closed.append({"symbol": symbol, "exit": price, "reason": reason, "pnl": round(pnl, 4)})
                break
        return closed


class PaperExecutor:
    def __init__(self, cfg: Config, journal):
        self.cfg = cfg
        self.journal = journal
        self.account = PaperAccount(cfg.paper_equity, cfg.fee_pct)

    def equity(self) -> float:
        return self.account.equity

    def open_symbols(self) -> set:
        return set(self.account.positions)

    def sync(self, symbol, candles, open_symbols: set) -> None:
        for event in self.account.update(symbol, candles):
            open_symbols.discard(symbol)
            self.journal.log("paper_exit", **event, equity=round(self.account.equity, 4))

    def enter(self, symbol, signal, qty, filters: SymbolFilters, opened_ms: int) -> dict:
        self.account.open(symbol, signal, float(qty), opened_ms)
        return {"venue": "paper", "qty": str(qty)}


class ExchangeExecutor:
    def __init__(self, client, cfg: Config, journal):
        self.client = client
        self.cfg = cfg
        self.journal = journal

    def equity(self) -> float:
        bal = self.client.balance()
        return bal["balance"] + bal["unrealized"]

    def open_symbols(self) -> set:
        return set(self.client.positions())

    def sync(self, symbol, candles, open_symbols: set) -> None:
        if symbol in open_symbols:
            return
        for order in self.client.open_algo_orders(symbol):
            self.client.cancel_algo_order(symbol, order["algoId"])
            self.journal.log("cleanup_algo_order", symbol=symbol, algo_id=order["algoId"])

    def _flatten(self, symbol, exit_side, qty) -> bool:
        try:
            self.client.market_order(symbol, exit_side, qty, reduce_only=True, client_id=_client_id(symbol, "x"))
            return True
        except RETRYABLE as exc:
            self.journal.log("critical", symbol=symbol, error=str(exc),
                             note="FLATTEN FAILED - close the position manually now")
            return False

    def enter(self, symbol, signal, qty, filters: SymbolFilters, opened_ms: int) -> dict:
        side, exit_side = ("BUY", "SELL") if signal.side == "LONG" else ("SELL", "BUY")
        c = self.client
        c.set_margin_type(symbol, "ISOLATED")
        c.set_leverage(symbol, self.cfg.max_leverage)

        fill_qty = qty
        try:
            resp = c.market_order(symbol, side, qty, client_id=_client_id(symbol, "e"))
        except BinanceConnectionError:
            held = c.positions().get(symbol)
            if not held:
                raise
            fill_qty = abs(held["qty"])
            resp = {}
        fill_price = float(resp.get("avgPrice") or 0) or signal.entry

        sl = stop_price(signal.side, signal.stop, filters.tick_size)
        tp = round_to_tick(signal.take_profit, filters.tick_size)
        try:
            c.algo_order(symbol, exit_side, "STOP_MARKET", sl, client_id=_client_id(symbol, "sl"))
        except RETRYABLE as exc:
            flat = self._flatten(symbol, exit_side, fill_qty)
            self.journal.log("emergency_flatten", symbol=symbol, error=str(exc), flat=flat)
            raise ProtectionError(f"stop order failed for {symbol}: {exc}", flat) from None
        try:
            c.algo_order(symbol, exit_side, "TAKE_PROFIT_MARKET", tp, client_id=_client_id(symbol, "tp"))
        except RETRYABLE as exc:
            self.journal.log("warning", symbol=symbol, error=str(exc), note="take-profit not placed; stop is active")
        return {"venue": "exchange", "qty": str(fill_qty), "fill_price": fill_price, "stop": str(sl), "take_profit": str(tp)}


class Agent:
    def __init__(self, cfg: Config, client, executor, risk: RiskManager, journal, mode: str,
                 signal_fn=generate_signal, now=time.time, sleep=time.sleep):
        self.cfg = cfg
        self.client = client
        self.executor = executor
        self.risk = risk
        self.journal = journal
        self.mode = mode
        self.signal_fn = signal_fn
        self.now = now
        self.sleep = sleep
        self._last_seen: dict = {}
        self._kill_logged = False

    def kill_switch_active(self) -> bool:
        active = os.path.exists(self.cfg.kill_switch_path)
        if active and not self._kill_logged:
            self.journal.log("kill_switch_active", note="no new entries; open positions keep their exchange stops")
        self._kill_logged = active
        return active

    def run_once(self) -> None:
        equity = self.executor.equity()
        open_symbols = self.executor.open_symbols()
        self.risk.start_of_day(equity)
        killed = self.kill_switch_active()
        for symbol in self.cfg.symbols:
            try:
                self._process_symbol(symbol, equity, open_symbols, killed)
            except RETRYABLE as exc:
                self.journal.log("error", symbol=symbol, error=str(exc))
            except ProtectionError as exc:
                reason = f"protection failure on {symbol} (flat={exc.flat})"
                self.risk.halt(reason, permanent=True)
                self.journal.log("halted", reason=reason)

    def _process_symbol(self, symbol, equity, open_symbols, killed) -> None:
        cfg = self.cfg
        candles = self.client.klines(symbol, cfg.interval, limit=cfg.ema_trend + 100)
        now_ms = int(self.now() * 1000)
        closed = [c for c in candles if c.close_time <= now_ms]
        if len(closed) < cfg.ema_trend + 2:
            self.journal.log("skip", symbol=symbol, reason="not enough history")
            return

        self.executor.sync(symbol, closed, open_symbols)
        last = closed[-1]
        if self._last_seen.get(symbol) == last.open_time:
            return
        self._last_seen[symbol] = last.open_time

        if killed or symbol in open_symbols:
            return
        if now_ms - last.close_time > cfg.max_signal_age_seconds * 1000:
            return

        signal = self.signal_fn(closed, cfg)
        if signal is None:
            return
        self.journal.log("signal", symbol=symbol, side=signal.side, entry=signal.entry,
                         stop=signal.stop, take_profit=signal.take_profit, reason=signal.reason)

        ok, why = self.risk.can_open(equity, len(open_symbols))
        if not ok:
            self.journal.log("rejected", symbol=symbol, reason=why)
            return

        filters = self.client.symbol_filters(symbol)
        qty = position_size(equity, cfg.risk_per_trade_pct, signal.entry, signal.stop, filters, cfg.max_leverage)
        if qty <= 0:
            self.journal.log("rejected", symbol=symbol, reason="position size below exchange minimums")
            return

        result = self.executor.enter(symbol, signal, qty, filters, last.close_time)
        open_symbols.add(symbol)
        self.risk.record_trade()
        self.journal.log("entry", symbol=symbol, side=signal.side, requested_qty=str(qty),
                         risk_pct=cfg.risk_per_trade_pct, mode=self.mode, **result)

    def run_forever(self) -> None:
        self.journal.log("agent_started", mode=self.mode, symbols=self.cfg.symbols, interval=self.cfg.interval)
        backoff = 0
        try:
            while True:
                try:
                    self.run_once()
                    backoff = 0
                except RETRYABLE as exc:
                    limited = isinstance(exc, BinanceAPIError) and exc.status in (418, 429)
                    backoff = 300 if limited else min(max(backoff * 2, 5), 300)
                    self.journal.log("error", error=str(exc), backoff_seconds=backoff)
                self.sleep(self.cfg.poll_seconds + backoff)
        except KeyboardInterrupt:
            self.journal.log("agent_stopped", note="exchange-side stop orders remain active")


def preflight(client, mode: str) -> list:
    problems = []
    if mode == "dry-run":
        return problems
    skew = abs(client.server_time_ms() - int(time.time() * 1000))
    if skew > 2000:
        problems.append(f"clock skew vs Binance is {skew} ms; sync your system clock (signed requests will fail)")
    if client.is_hedge_mode():
        problems.append("account is in Hedge Mode; switch to One-way Mode (this agent assumes one position per symbol)")
    return problems
