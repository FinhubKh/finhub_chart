from pathlib import Path
import os

from .instruments import DEFAULT_PAIR, normalize_pair, pair_folder

# Repo root locally; in Docker set APP_ROOT=/app
ROOT = Path(os.environ.get("APP_ROOT") or Path(__file__).resolve().parents[2])

TIMEFRAMES = ["1M", "5M", "15M", "1H", "4H", "1D", "1W", "1MN"]


def data_dir(pair: str | None = None) -> Path:
    return ROOT / "data" / pair_folder(pair)


def timeframe_files(pair: str | None = None) -> dict[str, str]:
    symbol = normalize_pair(pair)
    return {tf: f"{symbol}_{tf}.csv" for tf in TIMEFRAMES}


# Back-compat for callers that still import these names (XAUUSD).
DATA_DIR = data_dir(DEFAULT_PAIR)
TIMEFRAME_FILES = timeframe_files(DEFAULT_PAIR)
