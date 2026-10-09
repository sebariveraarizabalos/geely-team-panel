from dataclasses import dataclass


@dataclass(frozen=True)
class Candle:
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time: int


@dataclass(frozen=True)
class Signal:
    side: str
    entry: float
    stop: float
    take_profit: float
    reason: str
