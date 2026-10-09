import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from agent.config import Config, ConfigError, load_config
from agent.risk import RiskManager, SymbolFilters, fmt_decimal, position_size, stop_price

FILTERS = SymbolFilters(Decimal("0.001"), Decimal("0.001"), Decimal("0.1"), Decimal("5"))


class SizingTests(unittest.TestCase):
    def test_risks_the_configured_fraction(self):
        qty = position_size(10000, 1.0, 100, 98, FILTERS, 10)
        self.assertEqual(qty, Decimal("50"))

    def test_leverage_caps_the_notional(self):
        qty = position_size(10000, 1.0, 100, 99.9, FILTERS, 3)
        self.assertEqual(qty, Decimal("300"))

    def test_quantity_is_rounded_down_to_step(self):
        qty = position_size(1000, 0.5, 100, 97, FILTERS, 10)
        self.assertEqual(qty, Decimal("1.666"))

    def test_below_minimum_returns_zero(self):
        self.assertEqual(position_size(10, 0.5, 100, 90, FILTERS, 3), Decimal(0))

    def test_degenerate_inputs_return_zero(self):
        self.assertEqual(position_size(1000, 1, 100, 100, FILTERS, 3), Decimal(0))
        self.assertEqual(position_size(0, 1, 100, 98, FILTERS, 3), Decimal(0))

    def test_stop_rounds_away_from_entry(self):
        self.assertEqual(stop_price("LONG", 97.96, Decimal("0.1")), Decimal("97.9"))
        self.assertEqual(stop_price("SHORT", 102.04, Decimal("0.1")), Decimal("102.1"))

    def test_decimal_formatting_has_no_exponent(self):
        self.assertEqual(fmt_decimal(Decimal("1E+2")), "100")
        self.assertEqual(fmt_decimal(0.5), "0.5")
        self.assertEqual(fmt_decimal(Decimal("2.500")), "2.5")


class RiskManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = Config(state_path=str(Path(self.tmp.name) / "state.json"), max_daily_loss_pct=3.0,
                          max_trades_per_day=2, max_open_positions=1)
        self.day = "2026-10-09"
        self.risk = RiskManager(self.cfg, today=lambda: self.day)
        self.risk.start_of_day(1000.0)

    def test_allows_when_within_limits(self):
        self.assertEqual(self.risk.can_open(1000.0, 0), (True, "ok"))

    def test_daily_loss_halts_trading(self):
        ok, reason = self.risk.can_open(960.0, 0)
        self.assertFalse(ok)
        self.assertIn("daily loss", reason)
        self.assertFalse(self.risk.can_open(1000.0, 0)[0])

    def test_trade_and_position_caps(self):
        self.assertFalse(self.risk.can_open(1000.0, 1)[0])
        self.risk.record_trade()
        self.risk.record_trade()
        self.assertFalse(self.risk.can_open(1000.0, 0)[0])

    def test_new_day_clears_daily_halt_but_not_permanent_halt(self):
        self.risk.halt("daily loss")
        self.day = "2026-10-10"
        self.risk.start_of_day(990.0)
        self.assertTrue(self.risk.can_open(990.0, 0)[0])
        self.risk.halt("stop order failed", permanent=True)
        self.day = "2026-10-11"
        self.risk.start_of_day(990.0)
        self.assertFalse(self.risk.can_open(990.0, 0)[0])

    def test_state_survives_restart_and_reset_halt_clears_it(self):
        self.risk.halt("stop order failed", permanent=True)
        reloaded = RiskManager(self.cfg, today=lambda: self.day)
        self.assertEqual(reloaded.halted_reason, "stop order failed")
        reloaded.reset_halt()
        self.assertIsNone(RiskManager(self.cfg, today=lambda: self.day).halted_reason)


class ConfigTests(unittest.TestCase):
    def test_defaults_are_valid(self):
        self.assertIsInstance(load_config(), Config)

    def test_rejects_unsafe_values(self):
        for bad in ({"risk_per_trade_pct": 10}, {"max_leverage": 50}, {"symbols": ["btc/usdt"]},
                    {"ema_fast": 60}, {"interval": "7m"}, {"max_daily_loss_pct": 0}):
            with self.assertRaises(ConfigError, msg=str(bad)):
                Config(**bad).validate()

    def test_rejects_unknown_keys(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "c.json"
            path.write_text('{"risk_per_trad_pct": 1}')
            with self.assertRaises(ConfigError):
                load_config(path)


if __name__ == "__main__":
    unittest.main()
