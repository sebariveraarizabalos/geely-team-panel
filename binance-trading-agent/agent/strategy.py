from dataclasses import dataclass
from typing import Optional, Sequence

from .config import Config
from .indicators import atr, ema, rsi
from .models import Candle, Signal


@dataclass
class Features:
    closes: list
    ema_fast: list
    ema_slow: list
    ema_trend: list
    rsi: list
    atr: list


def compute_features(candles: Sequence[Candle], cfg: Config) -> Features:
    closes = [c.close for c in candles]
    return Features(
        closes=closes,
        ema_fast=ema(closes, cfg.ema_fast),
        ema_slow=ema(closes, cfg.ema_slow),
        ema_trend=ema(closes, cfg.ema_trend),
        rsi=rsi(closes, cfg.rsi_period),
        atr=atr(candles, cfg.atr_period),
    )


def signal_at(f: Features, i: int, cfg: Config) -> Optional[Signal]:
    """Trend-pullback entry evaluated on the close of candle i (no lookahead)."""
    if i < 1:
        return None
    values = (f.ema_fast[i], f.ema_slow[i], f.ema_trend[i], f.rsi[i], f.rsi[i - 1], f.atr[i])
    if any(v is None for v in values):
        return None
    ef, es, et, r, r_prev, a = values
    close = f.closes[i]
    risk = a * cfg.atr_stop_mult
    if risk <= 0:
        return None

    if ef > es > et and close > et and r_prev < cfg.rsi_long_trigger <= r:
        stop = close - risk
        if stop <= 0:
            return None
        return Signal(
            "LONG",
            close,
            stop,
            close + cfg.reward_risk * risk,
            f"uptrend EMA{cfg.ema_fast}>EMA{cfg.ema_slow}>EMA{cfg.ema_trend}, "
            f"RSI {r_prev:.1f}->{r:.1f} recrossed {cfg.rsi_long_trigger:g}",
        )
    if ef < es < et and close < et and r_prev > cfg.rsi_short_trigger >= r:
        take_profit = close - cfg.reward_risk * risk
        if take_profit <= 0:
            return None
        return Signal(
            "SHORT",
            close,
            close + risk,
            take_profit,
            f"downtrend EMA{cfg.ema_fast}<EMA{cfg.ema_slow}<EMA{cfg.ema_trend}, "
            f"RSI {r_prev:.1f}->{r:.1f} recrossed {cfg.rsi_short_trigger:g}",
        )
    return None


def generate_signal(candles: Sequence[Candle], cfg: Config) -> Optional[Signal]:
    if len(candles) < cfg.ema_trend + 2:
        return None
    return signal_at(compute_features(candles, cfg), len(candles) - 1, cfg)
