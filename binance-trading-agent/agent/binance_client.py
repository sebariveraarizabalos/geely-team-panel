import hashlib
import hmac
import logging
import time
from decimal import Decimal
from urllib.parse import urlencode

import requests

from .models import Candle
from .risk import SymbolFilters, fmt_decimal

log = logging.getLogger("agent.binance")

LIVE_URL = "https://fapi.binance.com"
TESTNET_URL = "https://testnet.binancefuture.com"

BALANCE_PATH = "/fapi/v2/balance"
POSITIONS_PATH = "/fapi/v2/positionRisk"


class BinanceAPIError(Exception):
    def __init__(self, status, code, msg):
        super().__init__(f"Binance API error (HTTP {status}, code {code}): {msg}")
        self.status = status
        self.code = code
        self.msg = msg


class BinanceConnectionError(Exception):
    pass


def sign(secret: str, query: str) -> str:
    return hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()


def _is_error_code(code) -> bool:
    try:
        return int(code) < 0
    except (TypeError, ValueError):
        return False


def parse_filters(symbol_info: dict) -> SymbolFilters:
    by_type = {f["filterType"]: f for f in symbol_info["filters"]}
    lot = by_type["LOT_SIZE"]
    market_lot = by_type.get("MARKET_LOT_SIZE")
    if market_lot and Decimal(market_lot["stepSize"]) > 0:
        lot = market_lot
    min_notional = by_type.get("MIN_NOTIONAL", {}).get("notional", "0")
    return SymbolFilters(
        step_size=Decimal(lot["stepSize"]),
        min_qty=Decimal(lot["minQty"]),
        tick_size=Decimal(by_type["PRICE_FILTER"]["tickSize"]),
        min_notional=Decimal(min_notional),
    )


class BinanceFutures:
    """USD-M Futures REST client. With dry_run=True no write request ever leaves the process."""

    def __init__(self, api_key=None, api_secret=None, *, testnet=True, dry_run=False,
                 session=None, recv_window=5000, timeout=10, now=time.time):
        self.base_url = TESTNET_URL if testnet else LIVE_URL
        self.testnet = testnet
        self.dry_run = dry_run
        self._api_key = api_key
        self._api_secret = api_secret
        self._session = session or requests.Session()
        self._recv_window = recv_window
        self._timeout = timeout
        self._now = now
        self._filters: dict = {}

    def __repr__(self) -> str:
        return f"BinanceFutures(base_url={self.base_url!r}, dry_run={self.dry_run})"

    def _request(self, method, path, params=None, signed=False):
        params = dict(params or {})
        headers = {}
        if signed:
            if not self._api_key or not self._api_secret:
                raise RuntimeError("API credentials are required for signed requests")
            params["recvWindow"] = self._recv_window
            params["timestamp"] = int(self._now() * 1000)
            query = urlencode(params)
            query += "&signature=" + sign(self._api_secret, query)
            headers["X-MBX-APIKEY"] = self._api_key
        else:
            query = urlencode(params)
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        try:
            resp = self._session.request(method, url, headers=headers, timeout=self._timeout)
        except requests.RequestException as exc:
            raise BinanceConnectionError(f"{method} {path}: {type(exc).__name__}") from None
        return self._parse(resp)

    @staticmethod
    def _parse(resp):
        try:
            data = resp.json()
        except ValueError:
            raise BinanceAPIError(resp.status_code, None, "non-JSON response") from None
        is_error = isinstance(data, dict) and _is_error_code(data.get("code"))
        if resp.status_code != 200 or is_error:
            code = data.get("code") if isinstance(data, dict) else None
            msg = data.get("msg") if isinstance(data, dict) else str(data)[:200]
            raise BinanceAPIError(resp.status_code, code, msg)
        return data

    def _write(self, method, path, params):
        if self.dry_run:
            log.info("DRY-RUN %s %s %s", method, path, params)
            return {"dryRun": True, "path": path, **params}
        return self._request(method, path, params, signed=True)

    def ping(self):
        return self._request("GET", "/fapi/v1/ping")

    def server_time_ms(self) -> int:
        return int(self._request("GET", "/fapi/v1/time")["serverTime"])

    def klines(self, symbol, interval, limit=500, end_time=None) -> list:
        params = {"symbol": symbol, "interval": interval, "limit": limit}
        if end_time is not None:
            params["endTime"] = int(end_time)
        rows = self._request("GET", "/fapi/v1/klines", params)
        return [
            Candle(int(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), int(r[6]))
            for r in rows
        ]

    def symbol_filters(self, symbol) -> SymbolFilters:
        if symbol not in self._filters:
            info = self._request("GET", "/fapi/v1/exchangeInfo")
            for s in info["symbols"]:
                self._filters[s["symbol"]] = parse_filters(s)
        if symbol not in self._filters:
            raise ValueError(f"unknown symbol {symbol}")
        return self._filters[symbol]

    def balance(self, asset="USDT") -> dict:
        for row in self._request("GET", BALANCE_PATH, signed=True):
            if row["asset"] == asset:
                return {
                    "balance": float(row["balance"]),
                    "available": float(row["availableBalance"]),
                    "unrealized": float(row.get("crossUnPnl", 0)),
                }
        raise ValueError(f"no {asset} balance found")

    def positions(self) -> dict:
        out = {}
        for row in self._request("GET", POSITIONS_PATH, signed=True):
            amount = float(row["positionAmt"])
            if amount != 0:
                out[row["symbol"]] = {"qty": amount, "entry": float(row["entryPrice"])}
        return out

    def is_hedge_mode(self) -> bool:
        data = self._request("GET", "/fapi/v1/positionSide/dual", signed=True)
        return str(data.get("dualSidePosition")).lower() == "true"

    def set_leverage(self, symbol, leverage):
        return self._write("POST", "/fapi/v1/leverage", {"symbol": symbol, "leverage": int(leverage)})

    def set_margin_type(self, symbol, margin_type="ISOLATED"):
        try:
            return self._write("POST", "/fapi/v1/marginType", {"symbol": symbol, "marginType": margin_type})
        except BinanceAPIError as exc:
            if str(exc.code) == "-4046":
                return {"msg": "margin type already set"}
            raise

    def market_order(self, symbol, side, qty, *, reduce_only=False, client_id=None):
        params = {
            "symbol": symbol,
            "side": side,
            "type": "MARKET",
            "quantity": fmt_decimal(qty),
            "newOrderRespType": "RESULT",
        }
        if reduce_only:
            params["reduceOnly"] = "true"
        if client_id:
            params["newClientOrderId"] = client_id
        return self._write("POST", "/fapi/v1/order", params)

    def algo_order(self, symbol, side, order_type, trigger_price, client_id=None):
        """Conditional close-position order (STOP_MARKET / TAKE_PROFIT_MARKET) via the Algo Service."""
        params = {
            "algoType": "CONDITIONAL",
            "symbol": symbol,
            "side": side,
            "type": order_type,
            "triggerPrice": fmt_decimal(trigger_price),
            "closePosition": "true",
            "workingType": "MARK_PRICE",
        }
        if client_id:
            params["clientAlgoId"] = client_id
        return self._write("POST", "/fapi/v1/algoOrder", params)

    def open_algo_orders(self, symbol) -> list:
        data = self._request("GET", "/fapi/v1/openAlgoOrders", {"symbol": symbol}, signed=True)
        return data if isinstance(data, list) else data.get("orders", [])

    def cancel_algo_order(self, symbol, algo_id):
        return self._write("DELETE", "/fapi/v1/algoOrder", {"symbol": symbol, "algoId": algo_id})


def fetch_history(client: BinanceFutures, symbol, interval, total, now_ms=None) -> list:
    now_ms = now_ms if now_ms is not None else int(time.time() * 1000)
    out: list = []
    end = None
    while len(out) < total:
        batch = client.klines(symbol, interval, limit=min(1500, total - len(out)), end_time=end)
        if not batch:
            break
        out = batch + out
        end = batch[0].open_time - 1
    return [c for c in out if c.close_time <= now_ms][-total:]
