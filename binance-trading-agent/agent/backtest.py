import csv
from dataclasses import dataclass, field
from typing import Callable, Optional, Sequence

from .config import Config
from .models import Candle, Signal
from .strategy import compute_features, signal_at


def check_exit(side: str, stop: float, take_profit: float, c: Candle) -> Optional[tuple]:
    """Stop is evaluated before target, so a candle touching both counts as a loss."""
    if side == "LONG":
        if c.open <= stop:
            return c.open, "stop_gap"
        if c.low <= stop:
            return stop, "stop"
        if c.high >= take_profit:
            return take_profit, "take_profit"
    else:
        if c.open >= stop:
            return c.open, "stop_gap"
        if c.high >= stop:
            return stop, "stop"
        if c.low <= take_profit:
            return take_profit, "take_profit"
    return None


@dataclass
class Trade:
    side: str
    entry_time: int
    exit_time: int
    entry: float
    exit: float
    qty: float
    pnl: float
    r_multiple: float
    exit_reason: str


@dataclass
class BacktestResult:
    trades: list = field(default_factory=list)
    start_equity: float = 0.0
    end_equity: float = 0.0
    max_drawdown_pct: float = 0.0
    buy_hold_pct: float = 0.0

    def summary(self) -> dict:
        wins = [t for t in self.trades if t.pnl > 0]
        losses = [t for t in self.trades if t.pnl <= 0]
        gross_win = sum(t.pnl for t in wins)
        gross_loss = -sum(t.pnl for t in losses)
        n = len(self.trades)
        return {
            "trades": n,
            "win_rate_pct": round(len(wins) / n * 100, 1) if n else 0.0,
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "avg_r": round(sum(t.r_multiple for t in self.trades) / n, 2) if n else 0.0,
            "return_pct": round((self.end_equity / self.start_equity - 1) * 100, 2),
            "max_drawdown_pct": round(self.max_drawdown_pct, 2),
            "buy_and_hold_pct": round(self.buy_hold_pct, 2),
            "end_equity": round(self.end_equity, 2),
        }


def run_backtest(candles: Sequence[Candle], cfg: Config, equity: float = 1000.0,
                 signal_fn: Optional[Callable[[int], Optional[Signal]]] = None) -> BacktestResult:
    if signal_fn is None:
        features = compute_features(candles, cfg)

        def signal_fn(i):
            return signal_at(features, i, cfg)

    slip = cfg.slippage_pct / 100
    fee = cfg.fee_pct / 100
    result = BacktestResult(start_equity=equity)
    peak = equity
    pos = None
    pending: Optional[Signal] = None
    n = len(candles)

    def close_position(price: float, reason: str, time_ms: int) -> None:
        nonlocal equity, peak, pos
        direction = 1 if pos["side"] == "LONG" else -1
        exit_price = price * (1 - slip * direction)
        pnl = direction * (exit_price - pos["entry"]) * pos["qty"]
        pnl -= pos["qty"] * (pos["entry"] + exit_price) * fee
        equity += pnl
        peak = max(peak, equity)
        result.max_drawdown_pct = max(result.max_drawdown_pct, (peak - equity) / peak * 100)
        result.trades.append(Trade(pos["side"], pos["time"], time_ms, pos["entry"], exit_price,
                                   pos["qty"], pnl, pnl / pos["risk_amount"], reason))
        pos = None

    for i, c in enumerate(candles):
        if pending is not None and pos is None:
            sig, pending = pending, None
            direction = 1 if sig.side == "LONG" else -1
            entry = c.open * (1 + slip * direction)
            dist = abs(sig.entry - sig.stop)
            reward = abs(sig.take_profit - sig.entry)
            stop = entry - direction * dist
            if dist > 0 and stop > 0 and equity > 0:
                risk_amount = equity * cfg.risk_per_trade_pct / 100
                qty = min(risk_amount / dist, equity * cfg.max_leverage / entry)
                pos = {"side": sig.side, "entry": entry, "stop": stop, "tp": entry + direction * reward,
                       "qty": qty, "risk_amount": risk_amount, "time": c.open_time}
        if pos is not None:
            hit = check_exit(pos["side"], pos["stop"], pos["tp"], c)
            if hit:
                close_position(hit[0], hit[1], c.close_time)
        if pos is None and pending is None and i < n - 1:
            pending = signal_fn(i)

    if pos is not None:
        close_position(candles[-1].close, "end_of_data", candles[-1].close_time)
    result.end_equity = equity
    if n >= 2:
        result.buy_hold_pct = (candles[-1].close / candles[0].close - 1) * 100
    return result


def load_csv(path: str) -> list:
    with open(path, newline="") as fh:
        return [
            Candle(int(r["open_time"]), float(r["open"]), float(r["high"]), float(r["low"]),
                   float(r["close"]), float(r["volume"]), int(r["close_time"]))
            for r in csv.DictReader(fh)
        ]
