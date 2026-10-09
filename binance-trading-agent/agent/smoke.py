from decimal import ROUND_UP, Decimal

from .binance_client import BinanceAPIError, BinanceConnectionError
from .config import Config
from .models import Signal
from .risk import fmt_decimal, to_decimal
from .runner import ExchangeExecutor, ProtectionError

RETRYABLE = (BinanceAPIError, BinanceConnectionError)


class ConsoleJournal:
    def log(self, event, **fields):
        print(f"    [{event}] {fields}")


def _cleanup(client, symbol, out) -> bool:
    try:
        for order in client.open_algo_orders(symbol):
            client.cancel_algo_order(symbol, order["algoId"])
        held = client.positions().get(symbol)
        if held:
            side = "SELL" if held["qty"] > 0 else "BUY"
            client.market_order(symbol, side, Decimal(str(abs(held["qty"]))), reduce_only=True)
        if client.positions().get(symbol) or client.open_algo_orders(symbol):
            out("  [FAIL] leftovers remain; close them manually on the testnet")
            return False
        out("  [ok] position closed and conditional orders cancelled")
        return True
    except RETRYABLE as exc:
        out(f"  [FAIL] cleanup error: {exc}; close manually on the testnet")
        return False


def run_smoke_test(client, symbol: str, cfg: Config, out=print) -> bool:
    """Open the smallest valid long on testnet, confirm stop and target exist, then clean up."""
    if not client.testnet or client.dry_run:
        raise RuntimeError("smoke test runs only against the testnet with a real (non dry-run) client")

    filters = client.symbol_filters(symbol)
    price = client.klines(symbol, "1m", limit=2)[-1].close
    target = max(filters.min_notional * Decimal("1.5"), Decimal(10))
    steps = (target / to_decimal(price) / filters.step_size).to_integral_value(rounding=ROUND_UP)
    qty = max(steps * filters.step_size, filters.min_qty)
    signal = Signal("LONG", price, price * 0.95, price * 1.05, "smoke test")
    executor = ExchangeExecutor(client, cfg, ConsoleJournal())

    ok, entered = True, False
    out(f"1/4 entering LONG {symbol} qty={fmt_decimal(qty)} at ~{price:g} (stop -5%, target +5%)")
    try:
        executor.enter(symbol, signal, qty, filters, 0)
        entered = True
        out("  [ok] entry, stop and take-profit were accepted")
    except ProtectionError as exc:
        ok = False
        out(f"  [FAIL] {exc}")
        out("  the safety logic flattened the position; this is the failure the agent must never ignore")
    except RETRYABLE as exc:
        ok = False
        out(f"  [FAIL] {exc}")

    try:
        if entered:
            out("2/4 verifying on the exchange")
            held = client.positions().get(symbol)
            algos = client.open_algo_orders(symbol)
            if held and held["qty"] > 0:
                out(f"  [ok] open position: {held['qty']}")
            else:
                ok = False
                out("  [FAIL] expected an open long position")
            if len(algos) >= 2:
                out(f"  [ok] {len(algos)} conditional orders registered")
            else:
                ok = False
                out(f"  [FAIL] expected 2 conditional orders, found {len(algos)}")
    except RETRYABLE as exc:
        ok = False
        out(f"  [FAIL] verification error: {exc}")
    finally:
        out("3/4 cleaning up")
        ok = _cleanup(client, symbol, out) and ok

    out("4/4 " + ("PASSED: the order flow works on this exchange" if ok else "FAILED: do not go live"))
    return ok
