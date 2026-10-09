import math

from agent.models import Candle

HOUR = 3_600_000


def make_candles(closes, start=0, spread=0.002, step=HOUR):
    out, prev = [], closes[0]
    for i, close in enumerate(closes):
        t = start + i * step
        out.append(Candle(t, prev, max(prev, close) * (1 + spread), min(prev, close) * (1 - spread),
                          close, 1.0, t + step - 1))
        prev = close
    return out


def trending(n, drift, amp=0.04, period=5.0, base=100.0):
    return [base * math.exp(drift * t) * (1 + amp * math.sin(t / period)) for t in range(n)]
