import unittest
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

import requests

from agent.binance_client import (BinanceAPIError, BinanceConnectionError, BinanceFutures, LIVE_URL,
                                  TESTNET_URL, fetch_history, parse_filters, sign)

SECRET = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def json(self):
        if self._payload is ValueError:
            raise ValueError("bad json")
        return self._payload


class FakeSession:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers=None, timeout=None):
        self.calls.append((method, url, headers or {}))
        item = self.responses.pop(0) if self.responses else FakeResponse({})
        if isinstance(item, Exception):
            raise item
        return item


def client(*responses, **kw):
    session = FakeSession(*responses)
    kw.setdefault("now", lambda: 1_700_000_000)
    return BinanceFutures("key123", SECRET, session=session, **kw), session


def query_of(url):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


class SigningTests(unittest.TestCase):
    def test_matches_binance_documentation_vector(self):
        query = ("symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1"
                 "&price=0.1&recvWindow=5000&timestamp=1499827319559")
        self.assertEqual(sign(SECRET, query),
                         "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71")

    def test_signed_request_carries_key_timestamp_and_valid_signature(self):
        c, session = client(FakeResponse([{"asset": "USDT", "balance": "100", "availableBalance": "90"}]))
        c.balance()
        method, url, headers = session.calls[0]
        self.assertEqual(headers["X-MBX-APIKEY"], "key123")
        q = query_of(url)
        signature = q.pop("signature")
        self.assertEqual(q["timestamp"], "1700000000000")
        unsigned = url.split("?", 1)[1].rsplit("&signature=", 1)[0]
        self.assertEqual(signature, sign(SECRET, unsigned))

    def test_public_requests_are_not_signed(self):
        c, session = client(FakeResponse({}))
        c.ping()
        self.assertNotIn("signature", session.calls[0][1])
        self.assertEqual(session.calls[0][2], {})


class EndpointTests(unittest.TestCase):
    def test_base_url_follows_testnet_flag(self):
        self.assertEqual(BinanceFutures(testnet=True).base_url, TESTNET_URL)
        self.assertEqual(BinanceFutures(testnet=False).base_url, LIVE_URL)

    def test_dry_run_never_sends_write_requests(self):
        c, session = client(dry_run=True)
        c.set_leverage("BTCUSDT", 3)
        c.set_margin_type("BTCUSDT")
        c.market_order("BTCUSDT", "BUY", Decimal("0.01"))
        c.algo_order("BTCUSDT", "SELL", "STOP_MARKET", Decimal("90000"))
        c.cancel_algo_order("BTCUSDT", 1)
        self.assertEqual(session.calls, [])

    def test_algo_order_uses_algo_endpoint_with_close_position(self):
        c, session = client(FakeResponse({"algoId": 7}))
        c.algo_order("BTCUSDT", "SELL", "STOP_MARKET", Decimal("81000.50"), client_id="ta-1")
        method, url, _ = session.calls[0]
        self.assertEqual((method, urlparse(url).path), ("POST", "/fapi/v1/algoOrder"))
        q = query_of(url)
        self.assertEqual((q["algoType"], q["type"], q["triggerPrice"], q["closePosition"]),
                         ("CONDITIONAL", "STOP_MARKET", "81000.5", "true"))
        self.assertNotIn("quantity", q)

    def test_market_order_params(self):
        c, session = client(FakeResponse({"avgPrice": "1"}))
        c.market_order("ETHUSDT", "SELL", Decimal("2.50"), reduce_only=True)
        q = query_of(session.calls[0][1])
        self.assertEqual((q["type"], q["quantity"], q["reduceOnly"]), ("MARKET", "2.5", "true"))

    def test_margin_type_already_set_is_not_an_error(self):
        c, _ = client(FakeResponse({"code": -4046, "msg": "No need to change margin type."}, status=400))
        self.assertEqual(c.set_margin_type("BTCUSDT")["msg"], "margin type already set")

    def test_klines_are_parsed_into_candles(self):
        row = [1700000000000, "100", "110", "90", "105", "12.5", 1700003599999]
        c, _ = client(FakeResponse([row]))
        candle = c.klines("BTCUSDT", "1h", limit=1)[0]
        self.assertEqual((candle.open, candle.high, candle.low, candle.close), (100.0, 110.0, 90.0, 105.0))
        self.assertEqual(candle.close_time, 1700003599999)

    def test_positions_ignores_flat_symbols(self):
        rows = [{"symbol": "BTCUSDT", "positionAmt": "-0.5", "entryPrice": "80000"},
                {"symbol": "ETHUSDT", "positionAmt": "0.000", "entryPrice": "0"}]
        c, _ = client(FakeResponse(rows))
        self.assertEqual(c.positions(), {"BTCUSDT": {"qty": -0.5, "entry": 80000.0}})

    def test_exchange_filters_prefer_market_lot_size(self):
        info = {"filters": [
            {"filterType": "LOT_SIZE", "stepSize": "0.001", "minQty": "0.001"},
            {"filterType": "MARKET_LOT_SIZE", "stepSize": "0.01", "minQty": "0.01"},
            {"filterType": "PRICE_FILTER", "tickSize": "0.1"},
            {"filterType": "MIN_NOTIONAL", "notional": "100"}]}
        f = parse_filters(info)
        self.assertEqual((f.step_size, f.min_qty, f.tick_size, f.min_notional),
                         (Decimal("0.01"), Decimal("0.01"), Decimal("0.1"), Decimal("100")))

    def test_fetch_history_pages_backwards_and_drops_open_candle(self):
        def row(t):
            return [t, "1", "1", "1", "1", "1", t + 99]
        c, session = client(FakeResponse([row(300), row(400)]), FakeResponse([row(100), row(200)]), FakeResponse([]))
        candles = fetch_history(c, "BTCUSDT", "1h", 10, now_ms=450)
        self.assertEqual([x.open_time for x in candles], [100, 200, 300])
        self.assertEqual(query_of(session.calls[1][1])["endTime"], "299")


class ErrorHandlingTests(unittest.TestCase):
    def test_api_error_is_raised_with_code(self):
        c, _ = client(FakeResponse({"code": -2019, "msg": "Margin is insufficient."}, status=400))
        with self.assertRaises(BinanceAPIError) as ctx:
            c.market_order("BTCUSDT", "BUY", Decimal("1"))
        self.assertEqual(ctx.exception.code, -2019)

    def test_non_json_response_is_an_api_error(self):
        c, _ = client(FakeResponse(ValueError, status=502))
        with self.assertRaises(BinanceAPIError):
            c.ping()

    def test_connection_errors_hide_url_and_signature(self):
        exc = requests.ConnectionError("Max retries exceeded with url: /fapi/v1/order?signature=deadbeef")
        c, _ = client(exc)
        with self.assertRaises(BinanceConnectionError) as ctx:
            c.balance()
        self.assertNotIn("deadbeef", str(ctx.exception))
        self.assertNotIn("signature", str(ctx.exception))

    def test_secret_is_never_exposed_in_repr(self):
        c, _ = client()
        self.assertNotIn(SECRET, repr(c))
        self.assertNotIn("key123", repr(c))

    def test_signed_call_without_credentials_fails_early(self):
        with self.assertRaises(RuntimeError):
            BinanceFutures(session=FakeSession()).balance()


if __name__ == "__main__":
    unittest.main()
