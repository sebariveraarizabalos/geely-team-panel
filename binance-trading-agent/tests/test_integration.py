import json
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import requests

from agent.binance_client import BinanceFutures, sign
from agent.config import Config
from agent.risk import RiskManager, fmt_decimal, position_size
from agent.runner import Agent, ExchangeExecutor, Journal, PaperExecutor, preflight
from agent.strategy import compute_features, generate_signal, signal_at
from tests.helpers import HOUR, make_candles, trending

KEY, SECRET = "test-key", "test-secret"
NOW_S = 1_800_000_000
NOW_MS = NOW_S * 1000
PUBLIC = {"/fapi/v1/ping", "/fapi/v1/time", "/fapi/v1/klines", "/fapi/v1/exchangeInfo"}
FILTERS = [
    {"filterType": "LOT_SIZE", "stepSize": "0.001", "minQty": "0.001"},
    {"filterType": "PRICE_FILTER", "tickSize": "0.1"},
    {"filterType": "MIN_NOTIONAL", "notional": "5"},
]


def signal_candles(cfg):
    closes = trending(700, 0.001, amp=0.05)
    full = make_candles(closes)
    features = compute_features(full, cfg)
    index = next(i for i in range(250, 700) if signal_at(features, i, cfg))
    n = index + 1
    last_close = NOW_MS - 30_000
    candles = make_candles(closes[:n], start=last_close + 1 - n * HOUR)
    return candles, last_close


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self):
        srv = self.server
        url = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        if url.path not in PUBLIC:
            raw = url.query
            unsigned, _, signature = raw.rpartition("&signature=")
            if signature != sign(SECRET, unsigned) or self.headers.get("X-MBX-APIKEY") != KEY:
                srv.bad_requests += 1
                return self._reply(400, {"code": -1022, "msg": "Signature for this request is not valid."})
        srv.recorded.append((self.command, url.path, params))
        path = url.path
        if path == "/fapi/v1/ping":
            return self._reply(200, {})
        if path == "/fapi/v1/time":
            return self._reply(200, {"serverTime": int(time.time() * 1000)})
        if path == "/fapi/v1/klines":
            rows = [[c.open_time, str(c.open), str(c.high), str(c.low), str(c.close), "1", c.close_time]
                    for c in srv.candles]
            return self._reply(200, rows)
        if path == "/fapi/v1/exchangeInfo":
            return self._reply(200, {"symbols": [{"symbol": "BTCUSDT", "filters": FILTERS}]})
        if path == "/fapi/v2/balance":
            return self._reply(200, [{"asset": "USDT", "balance": "1000", "availableBalance": "1000",
                                      "crossUnPnl": "0"}])
        if path == "/fapi/v2/positionRisk":
            return self._reply(200, [])
        if path == "/fapi/v1/openAlgoOrders":
            return self._reply(200, [])
        if path == "/fapi/v1/positionSide/dual":
            return self._reply(200, {"dualSidePosition": srv.hedge_mode})
        if path == "/fapi/v1/order":
            return self._reply(200, {"avgPrice": str(srv.candles[-1].close), "status": "FILLED"})
        if path == "/fapi/v1/algoOrder":
            return self._reply(200, {"algoId": len(srv.recorded)})
        return self._reply(200, {})

    do_GET = do_POST = do_DELETE = _handle


class LocalExchangeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.cfg = Config(symbols=["BTCUSDT"], state_path=str(Path(self.tmp.name) / "state.json"),
                          journal_path=str(Path(self.tmp.name) / "journal.jsonl"),
                          kill_switch_path=str(Path(self.tmp.name) / "KILL"))
        self.candles, self.last_close = signal_candles(self.cfg)
        live = self.candles[-1]
        in_progress = type(live)(live.close_time + 1, live.close, live.close, live.close, live.close, 1.0,
                                 NOW_MS + 3_000_000)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.recorded, self.server.bad_requests, self.server.hedge_mode = [], 0, False
        self.server.candles = self.candles + [in_progress]
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def client(self, **kw):
        session = requests.Session()
        session.trust_env = False
        client = BinanceFutures(KEY, SECRET, session=session, **kw)
        client.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        return client

    def agent(self, client, executor_cls, mode):
        journal = Journal(self.cfg.journal_path)
        executor = PaperExecutor(self.cfg, journal) if executor_cls is PaperExecutor \
            else ExchangeExecutor(client, self.cfg, journal)
        risk = RiskManager(self.cfg, today=lambda: "2026-10-09")
        return Agent(self.cfg, client, executor, risk, journal, mode, now=lambda: NOW_S, sleep=lambda s: None), executor

    def writes(self):
        return [(m, p, q) for m, p, q in self.server.recorded if m in ("POST", "DELETE")]

    def test_testnet_entry_sends_correctly_signed_orders_in_safe_order(self):
        client = self.client(testnet=True)
        agent, _ = self.agent(client, ExchangeExecutor, "testnet")
        agent.run_once()

        self.assertEqual(self.server.bad_requests, 0)
        self.assertEqual([(m, p) for m, p, _ in self.writes()], [
            ("POST", "/fapi/v1/marginType"), ("POST", "/fapi/v1/leverage"), ("POST", "/fapi/v1/order"),
            ("POST", "/fapi/v1/algoOrder"), ("POST", "/fapi/v1/algoOrder"),
        ])
        signal = generate_signal(self.candles, self.cfg)
        expected_qty = position_size(1000.0, self.cfg.risk_per_trade_pct, signal.entry, signal.stop,
                                     client.symbol_filters("BTCUSDT"), self.cfg.max_leverage)
        _, _, entry = self.writes()[2]
        self.assertEqual(entry["quantity"], fmt_decimal(expected_qty))
        self.assertEqual((entry["side"], entry["type"]), ("BUY" if signal.side == "LONG" else "SELL", "MARKET"))
        stop_order, target_order = self.writes()[3][2], self.writes()[4][2]
        self.assertEqual((stop_order["type"], stop_order["closePosition"]), ("STOP_MARKET", "true"))
        self.assertEqual(target_order["type"], "TAKE_PROFIT_MARKET")
        self.assertEqual(stop_order["side"], "SELL" if signal.side == "LONG" else "BUY")
        events = [json.loads(line)["event"] for line in Path(self.cfg.journal_path).read_text().splitlines()]
        self.assertIn("entry", events)

    def test_dry_run_trades_on_paper_and_sends_no_write_requests(self):
        client = self.client(testnet=False, dry_run=True)
        agent, executor = self.agent(client, PaperExecutor, "dry-run")
        agent.run_once()
        self.assertEqual(self.writes(), [])
        self.assertIn("BTCUSDT", executor.account.positions)
        self.assertEqual(self.server.bad_requests, 0)

    def test_preflight_passes_on_one_way_mode(self):
        self.assertEqual(preflight(self.client(testnet=True), "testnet"), [])

    def test_preflight_rejects_hedge_mode(self):
        self.server.hedge_mode = True
        problems = preflight(self.client(testnet=True), "testnet")
        self.assertTrue(any("Hedge Mode" in p for p in problems))


if __name__ == "__main__":
    unittest.main()
