from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data" / "xauusd"
# Dukascopy free-API cache (separate from FinHub curated local CSVs)
FREE_DATA_DIR = ROOT / "data" / "xauusd_free"

TIMEFRAME_FILES = {
    "1M": "XAUUSD_1M.csv",
    "5M": "XAUUSD_5M.csv",
    "15M": "XAUUSD_15M.csv",
    "1H": "XAUUSD_1H.csv",
    "4H": "XAUUSD_4H.csv",
    "1D": "XAUUSD_1D.csv",
    "1W": "XAUUSD_1W.csv",
    "1MN": "XAUUSD_1MN.csv",
}

# Our TF labels → dukascopy-node timeframe ids (1W is resampled from daily)
TF_TO_DUKASCOPY = {
    "1M": "m1",
    "5M": "m5",
    "15M": "m15",
    "1H": "h1",
    "4H": "h4",
    "1D": "d1",
    "1MN": "mn1",
}

# How far back to pull on first free-API fetch (1M capped — full decade is huge)
FREE_HISTORY_YEARS = {
    "1M": 2,
    "5M": 5,
    "15M": 8,
    "1H": 10,
    "4H": 10,
    "1D": 10,
    "1W": 10,
    "1MN": 10,
}

TIMEFRAMES = list(TIMEFRAME_FILES.keys())
DATA_SOURCES = ("local", "free")

