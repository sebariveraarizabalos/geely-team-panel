import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, ROUND_UP, Decimal
from pathlib import Path

from .config import Config


@dataclass(frozen=True)
class SymbolFilters:
    step_size: Decimal
    min_qty: Decimal
    tick_size: Decimal
    min_notional: Decimal


def to_decimal(x) -> Decimal:
    return x if isinstance(x, Decimal) else Decimal(str(x))


def fmt_decimal(x) -> str:
    s = format(to_decimal(x), "f")
    return s.rstrip("0").rstrip(".") if "." in s else s


def round_down(value, step) -> Decimal:
    step = to_decimal(step)
    return (to_decimal(value) / step).to_integral_value(rounding=ROUND_DOWN) * step


def round_to_tick(price, tick, mode=ROUND_HALF_UP) -> Decimal:
    tick = to_decimal(tick)
    return (to_decimal(price) / tick).to_integral_value(rounding=mode) * tick


def stop_price(side: str, price, tick) -> Decimal:
    return round_to_tick(price, tick, ROUND_DOWN if side == "LONG" else ROUND_UP)


def position_size(equity, risk_pct, entry, stop, filters: SymbolFilters, max_leverage) -> Decimal:
    equity, entry, stop = to_decimal(equity), to_decimal(entry), to_decimal(stop)
    distance = abs(entry - stop)
    if equity <= 0 or entry <= 0 or distance <= 0:
        return Decimal(0)
    qty = equity * to_decimal(risk_pct) / 100 / distance
    qty = min(qty, equity * to_decimal(max_leverage) / entry)
    qty = round_down(qty, filters.step_size)
    if qty < filters.min_qty or qty * entry < filters.min_notional:
        return Decimal(0)
    return qty


def _utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


class RiskManager:
    def __init__(self, cfg: Config, today=_utc_today):
        self.cfg = cfg
        self._today = today
        self.path = Path(cfg.state_path)
        self.state = self._load()

    def _load(self) -> dict:
        try:
            return json.loads(self.path.read_text())
        except (OSError, ValueError):
            return {}

    def _save(self) -> None:
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.state, indent=2))
        os.replace(tmp, self.path)

    def start_of_day(self, equity: float) -> None:
        today = self._today()
        if self.state.get("date") == today:
            return
        self.state["date"] = today
        self.state["day_start_equity"] = equity
        self.state["trades_today"] = 0
        if not self.state.get("halted_permanent"):
            self.state.pop("halted_reason", None)
        self._save()

    def halt(self, reason: str, permanent: bool = False) -> None:
        self.state["halted_reason"] = reason
        self.state["halted_permanent"] = permanent
        self._save()

    def reset_halt(self) -> None:
        self.state.pop("halted_reason", None)
        self.state.pop("halted_permanent", None)
        self._save()

    @property
    def halted_reason(self):
        return self.state.get("halted_reason")

    def record_trade(self) -> None:
        self.state["trades_today"] = self.state.get("trades_today", 0) + 1
        self._save()

    def can_open(self, equity: float, open_positions: int):
        if self.halted_reason:
            return False, f"halted: {self.halted_reason}"
        start = self.state.get("day_start_equity")
        if start and start > 0:
            loss_pct = (start - equity) / start * 100
            if loss_pct >= self.cfg.max_daily_loss_pct:
                self.halt(f"daily loss {loss_pct:.2f}% reached limit {self.cfg.max_daily_loss_pct}%")
                return False, f"halted: {self.halted_reason}"
        if self.state.get("trades_today", 0) >= self.cfg.max_trades_per_day:
            return False, "max trades per day reached"
        if open_positions >= self.cfg.max_open_positions:
            return False, "max open positions reached"
        return True, "ok"
