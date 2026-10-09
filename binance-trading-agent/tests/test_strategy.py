import unittest

from agent.config import Config
from agent.indicators import atr, ema, rsi
from agent.models import Candle
from agent.strategy import compute_features, generate_signal, signal_at
from tests.helpers import make_candles, trending


class IndicatorTests(unittest.TestCase):
    def test_ema_matches_hand_calculation(self):
        out = ema([1, 2, 3, 4, 5], 3)
        self.assertEqual(out[:2], [None, None])
        self.assertAlmostEqual(out[2], 2.0)
        self.assertAlmostEqual(out[3], 3.0)
        self.assertAlmostEqual(out[4], 4.0)

    def test_ema_of_constant_series_is_constant(self):
        self.assertAlmostEqual(ema([7.0] * 30, 10)[-1], 7.0)

    def test_rsi_extremes(self):
        self.assertEqual(rsi(list(range(1, 40)), 14)[-1], 100.0)
        self.assertEqual(rsi(list(range(40, 1, -1)), 14)[-1], 0.0)
        self.assertEqual(rsi([5.0] * 40, 14)[-1], 50.0)

    def test_atr_of_constant_range(self):
        candles = [Candle(i, 100, 101, 99, 100, 1, i) for i in range(30)]
        self.assertAlmostEqual(atr(candles, 14)[-1], 2.0)

    def test_short_input_returns_none(self):
        self.assertEqual(ema([1, 2], 5), [None, None])
        self.assertEqual(rsi([1, 2], 14), [None, None])


class StrategyTests(unittest.TestCase):
    def setUp(self):
        self.cfg = Config()

    def _signals(self, candles):
        f = compute_features(candles, self.cfg)
        return [s for s in (signal_at(f, i, self.cfg) for i in range(len(candles))) if s]

    def test_uptrend_with_pullbacks_yields_only_longs(self):
        signals = self._signals(make_candles(trending(700, 0.001, amp=0.05)))
        self.assertTrue(signals)
        for s in signals:
            self.assertEqual(s.side, "LONG")
            self.assertLess(s.stop, s.entry)
            self.assertLess(s.entry, s.take_profit)
            self.assertAlmostEqual(s.take_profit - s.entry, self.cfg.reward_risk * (s.entry - s.stop), places=6)

    def test_downtrend_with_bounces_yields_only_shorts(self):
        signals = self._signals(make_candles(trending(700, -0.001, amp=0.05)))
        self.assertTrue(signals)
        for s in signals:
            self.assertEqual(s.side, "SHORT")
            self.assertGreater(s.stop, s.entry)
            self.assertGreater(s.entry, s.take_profit)
            self.assertAlmostEqual(s.entry - s.take_profit, self.cfg.reward_risk * (s.stop - s.entry), places=6)

    def test_flat_market_yields_nothing(self):
        self.assertEqual(self._signals(make_candles([100.0] * 400)), [])

    def test_signal_does_not_depend_on_future_candles(self):
        candles = make_candles(trending(700, 0.001, amp=0.05))
        features = compute_features(candles, self.cfg)
        for i in range(250, 700, 7):
            self.assertEqual(signal_at(features, i, self.cfg), generate_signal(candles[: i + 1], self.cfg))

    def test_requires_enough_history(self):
        candles = make_candles(trending(self.cfg.ema_trend, 0.001, amp=0.05))
        self.assertIsNone(generate_signal(candles, self.cfg))


if __name__ == "__main__":
    unittest.main()
