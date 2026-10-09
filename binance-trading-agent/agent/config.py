import json
import re
from dataclasses import dataclass, field, fields
from pathlib import Path


class ConfigError(ValueError):
    pass


SYMBOL_RE = re.compile(r"^[A-Z0-9]{4,20}$")
INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"}


@dataclass
class Config:
    symbols: list = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT", "SOLUSDT"])
    interval: str = "1h"
    ema_fast: int = 20
    ema_slow: int = 50
    ema_trend: int = 200
    rsi_period: int = 14
    rsi_long_trigger: float = 40.0
    rsi_short_trigger: float = 60.0
    atr_period: int = 14
    atr_stop_mult: float = 2.0
    reward_risk: float = 2.0
    risk_per_trade_pct: float = 0.5
    max_leverage: int = 3
    max_open_positions: int = 2
    max_daily_loss_pct: float = 3.0
    max_trades_per_day: int = 6
    paper_equity: float = 1000.0
    fee_pct: float = 0.05
    slippage_pct: float = 0.02
    poll_seconds: int = 30
    max_signal_age_seconds: int = 120
    journal_path: str = "journal.jsonl"
    state_path: str = "state.json"
    kill_switch_path: str = "KILL"

    def validate(self) -> "Config":
        if not self.symbols:
            raise ConfigError("symbols must not be empty")
        for s in self.symbols:
            if not isinstance(s, str) or not SYMBOL_RE.match(s):
                raise ConfigError(f"invalid symbol: {s!r}")
        if self.interval not in INTERVALS:
            raise ConfigError(f"interval must be one of {sorted(INTERVALS)}")
        if not (1 < self.ema_fast < self.ema_slow < self.ema_trend):
            raise ConfigError("require 1 < ema_fast < ema_slow < ema_trend")
        if not (0 < self.rsi_long_trigger < 50 < self.rsi_short_trigger < 100):
            raise ConfigError("require 0 < rsi_long_trigger < 50 < rsi_short_trigger < 100")
        if self.atr_stop_mult <= 0 or self.reward_risk <= 0:
            raise ConfigError("atr_stop_mult and reward_risk must be positive")
        if not (0 < self.risk_per_trade_pct <= 5):
            raise ConfigError("risk_per_trade_pct must be in (0, 5]")
        if not (1 <= self.max_leverage <= 20):
            raise ConfigError("max_leverage must be in [1, 20]")
        if self.max_open_positions < 1 or self.max_trades_per_day < 1:
            raise ConfigError("max_open_positions and max_trades_per_day must be >= 1")
        if not (0 < self.max_daily_loss_pct <= 20):
            raise ConfigError("max_daily_loss_pct must be in (0, 20]")
        if self.paper_equity <= 0:
            raise ConfigError("paper_equity must be positive")
        if self.fee_pct < 0 or self.slippage_pct < 0:
            raise ConfigError("fee_pct and slippage_pct must be >= 0")
        if self.poll_seconds < 5:
            raise ConfigError("poll_seconds must be >= 5")
        if self.max_signal_age_seconds < self.poll_seconds:
            raise ConfigError("max_signal_age_seconds must be >= poll_seconds")
        return self


def load_config(path=None) -> Config:
    if path is None:
        return Config().validate()
    try:
        raw = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise ConfigError(f"cannot read config {path}: {exc}") from exc
    known = {f.name for f in fields(Config)}
    unknown = set(raw) - known
    if unknown:
        raise ConfigError(f"unknown config keys: {sorted(unknown)}")
    return Config(**raw).validate()
