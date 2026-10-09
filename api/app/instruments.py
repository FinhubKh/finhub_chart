"""Tradable symbols. OHLC lives on R2 under {symbol.lower()}/{SYMBOL}_{TF}.csv."""

from __future__ import annotations

DEFAULT_PAIR = "XAUUSD"

INSTRUMENTS: list[dict[str, str]] = [
    {
        "symbol": "XAUUSD",
        "name": "Gold",
        "dukascopy": "xauusd",
        "asset_class": "metal",
    },
    {
        "symbol": "XAGUSD",
        "name": "Silver",
        "dukascopy": "xagusd",
        "asset_class": "metal",
    },
    {
        "symbol": "EURUSD",
        "name": "Euro / US Dollar",
        "dukascopy": "eurusd",
        "asset_class": "forex",
    },
    {
        "symbol": "GBPUSD",
        "name": "Pound / US Dollar",
        "dukascopy": "gbpusd",
        "asset_class": "forex",
    },
    {
        "symbol": "BTCUSD",
        "name": "Bitcoin",
        "dukascopy": "btcusd",
        "asset_class": "crypto",
    },
    {
        "symbol": "NASDAQ",
        "name": "NASDAQ 100",
        "dukascopy": "usatechidxusd",
        "asset_class": "index",
    },
    {
        "symbol": "US30",
        "name": "Dow Jones 30",
        "dukascopy": "usa30idxusd",
        "asset_class": "index",
    },
    {
        "symbol": "SPX500",
        "name": "S&P 500",
        "dukascopy": "usa500idxusd",
        "asset_class": "index",
    },
]

_BY_SYMBOL = {row["symbol"]: row for row in INSTRUMENTS}

ALIASES = {
    "GOLD": "XAUUSD",
    "SILVER": "XAGUSD",
    "NAS100": "NASDAQ",
    "NDX": "NASDAQ",
    "USTEC": "NASDAQ",
    "US100": "NASDAQ",
    "DJ30": "US30",
    "DJIA": "US30",
    "DOW": "US30",
    "US500": "SPX500",
    "SPX": "SPX500",
    "SP500": "SPX500",
    "US500IDX": "SPX500",
}


def instrument_symbols() -> list[str]:
    return [row["symbol"] for row in INSTRUMENTS]


def normalize_pair(pair: str | None) -> str:
    raw = (pair or DEFAULT_PAIR).strip().upper()
    symbol = ALIASES.get(raw, raw)
    if symbol not in _BY_SYMBOL:
        raise ValueError(f"Unsupported pair: {pair}. Use one of {instrument_symbols()}")
    return symbol


def instrument_meta(pair: str | None) -> dict[str, str]:
    return _BY_SYMBOL[normalize_pair(pair)]


def pair_folder(pair: str | None) -> str:
    return normalize_pair(pair).lower()
