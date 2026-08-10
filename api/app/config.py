from pathlib import Path
import os

# Repo root locally; in Docker set APP_ROOT=/app
ROOT = Path(os.environ.get("APP_ROOT") or Path(__file__).resolve().parents[2])
DATA_DIR = ROOT / "data" / "xauusd"

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

TIMEFRAMES = list(TIMEFRAME_FILES.keys())
