import argparse
import logging
import os
import sys

from .backtest import load_csv, run_backtest
from .binance_client import BinanceAPIError, BinanceConnectionError, BinanceFutures, fetch_history
from .config import ConfigError, load_config
from .risk import RiskManager
from .runner import Agent, ExchangeExecutor, Journal, PaperExecutor, preflight

LIVE_CONFIRMATION = "I_UNDERSTAND_THE_RISK"


def build_client(mode: str) -> BinanceFutures:
    if mode == "dry-run":
        return BinanceFutures(testnet=False, dry_run=True)
    prefix = "BINANCE_TESTNET" if mode == "testnet" else "BINANCE"
    key, secret = os.environ.get(f"{prefix}_API_KEY"), os.environ.get(f"{prefix}_API_SECRET")
    if not key or not secret:
        sys.exit(f"Set {prefix}_API_KEY and {prefix}_API_SECRET in the environment.")
    if mode == "live" and os.environ.get("BINANCE_LIVE_CONFIRM") != LIVE_CONFIRMATION:
        sys.exit(f"Live trading uses REAL money. Set BINANCE_LIVE_CONFIRM={LIVE_CONFIRMATION} to proceed.")
    return BinanceFutures(key, secret, testnet=(mode == "testnet"))


def cmd_check(args, cfg):
    client = build_client(args.mode)
    client.ping()
    print(f"[ok] reachable: {client.base_url}")
    for symbol in cfg.symbols:
        f = client.symbol_filters(symbol)
        print(f"[ok] {symbol}: step={f.step_size} minQty={f.min_qty} tick={f.tick_size} minNotional={f.min_notional}")
    if args.mode != "dry-run":
        bal = client.balance()
        print(f"[ok] USDT balance={bal['balance']:.2f} available={bal['available']:.2f}")
        print(f"[ok] open positions: {client.positions() or 'none'}")
    problems = preflight(client, args.mode)
    for p in problems:
        print(f"[PROBLEM] {p}")
    return 1 if problems else 0


def cmd_backtest(args, cfg):
    if args.csv:
        candles = load_csv(args.csv)
    else:
        candles = fetch_history(BinanceFutures(testnet=False), args.symbol, args.interval, args.candles)
    if len(candles) < cfg.ema_trend + 50:
        sys.exit(f"Need at least {cfg.ema_trend + 50} candles, got {len(candles)}.")
    result = run_backtest(candles, cfg, equity=args.equity)
    print(f"{args.symbol} {args.interval}: {len(candles)} candles")
    for key, value in result.summary().items():
        print(f"  {key:>18}: {value}")
    print("Past results do not predict future results; fees and slippage are estimates.")
    return 0


def cmd_run(args, cfg):
    client = build_client(args.mode)
    journal = Journal(cfg.journal_path)
    risk = RiskManager(cfg)
    if risk.halted_reason:
        print(f"Agent is halted: {risk.halted_reason}")
        print("Review the journal, then run 'python -m agent reset-halt' to resume.")
        return 1
    problems = preflight(client, args.mode)
    if problems:
        for p in problems:
            print(f"[PROBLEM] {p}")
        return 1
    executor = PaperExecutor(cfg, journal) if args.mode == "dry-run" else ExchangeExecutor(client, cfg, journal)
    agent = Agent(cfg, client, executor, risk, journal, args.mode)
    if args.once:
        agent.run_once()
    else:
        print(f"Running in {args.mode} mode. Ctrl+C to stop; create the file '{cfg.kill_switch_path}' to block new entries.")
        agent.run_forever()
    return 0


def cmd_reset_halt(args, cfg):
    RiskManager(cfg).reset_halt()
    print("Halt cleared.")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="agent", description="Binance USD-M futures trading agent")
    parser.add_argument("--config", help="path to a JSON config file")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("check", help="read-only connectivity and account checks")
    p.add_argument("--mode", choices=["dry-run", "testnet", "live"], default="testnet")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("backtest", help="replay the strategy on historical candles")
    p.add_argument("--symbol", default="BTCUSDT")
    p.add_argument("--interval", default="1h")
    p.add_argument("--candles", type=int, default=4000)
    p.add_argument("--csv", help="load candles from CSV instead of Binance")
    p.add_argument("--equity", type=float, default=1000.0)
    p.set_defaults(func=cmd_backtest)

    p = sub.add_parser("run", help="run the agent")
    p.add_argument("--mode", choices=["dry-run", "testnet", "live"], default="dry-run")
    p.add_argument("--once", action="store_true", help="run a single cycle and exit")
    p.set_defaults(func=cmd_run)

    p = sub.add_parser("reset-halt", help="clear a persisted risk halt")
    p.set_defaults(func=cmd_reset_halt)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        cfg = load_config(args.config)
        return args.func(args, cfg)
    except ConfigError as exc:
        sys.exit(f"Config error: {exc}")
    except (BinanceAPIError, BinanceConnectionError) as exc:
        sys.exit(f"Binance error: {exc}")


if __name__ == "__main__":
    sys.exit(main())
