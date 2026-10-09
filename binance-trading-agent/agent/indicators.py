from typing import Optional, Sequence

from .models import Candle


def ema(values: Sequence[float], period: int) -> list:
    if period <= 0:
        raise ValueError("period must be positive")
    out: list = [None] * len(values)
    if len(values) < period:
        return out
    k = 2 / (period + 1)
    prev = sum(values[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * k + prev * (1 - k)
        out[i] = prev
    return out


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    return 100 - 100 / (1 + avg_gain / avg_loss)


def rsi(values: Sequence[float], period: int = 14) -> list:
    out: list = [None] * len(values)
    if len(values) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = values[i] - values[i - 1]
        gains += max(d, 0.0)
        losses += max(-d, 0.0)
    avg_gain, avg_loss = gains / period, losses / period
    out[period] = _rsi_value(avg_gain, avg_loss)
    for i in range(period + 1, len(values)):
        d = values[i] - values[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(d, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-d, 0.0)) / period
        out[i] = _rsi_value(avg_gain, avg_loss)
    return out


def atr(candles: Sequence[Candle], period: int = 14) -> list:
    n = len(candles)
    out: list = [None] * n
    if n <= period:
        return out
    true_ranges = []
    for i in range(1, n):
        c, prev_close = candles[i], candles[i - 1].close
        true_ranges.append(max(c.high - c.low, abs(c.high - prev_close), abs(c.low - prev_close)))
    prev = sum(true_ranges[:period]) / period
    out[period] = prev
    for i in range(period + 1, n):
        prev = (prev * (period - 1) + true_ranges[i - 1]) / period
        out[i] = prev
    return out
