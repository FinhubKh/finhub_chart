from __future__ import annotations

import subprocess
import threading
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

from .config import (
    FREE_DATA_DIR,
    FREE_HISTORY_YEARS,
    ROOT,
    TF_TO_DUKASCOPY,
    TIMEFRAME_FILES,
    TIMEFRAMES,
)

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(tf: str) -> threading.Lock:
    with _locks_guard:
        if tf not in _locks:
            _locks[tf] = threading.Lock()
        return _locks[tf]


def _free_path(tf: str) -> Path:
    key = tf.upper()
    return FREE_DATA_DIR / TIMEFRAME_FILES[key]


def _history_from(tf: str) -> str:
    years = FREE_HISTORY_YEARS.get(tf.upper(), 10)
    return (date.today() - timedelta(days=365 * years)).isoformat()


def _run_dukascopy(duka_tf: str, out_dir: Path, from_date: str, to_date: str) -> None:
    script = ROOT / "scripts" / "fetch_dukascopy_tf.mjs"
    if not script.exists():
        raise FileNotFoundError(f"Missing Dukascopy fetch script: {script}")

    cmd = [
        "node",
        str(script),
        "--tf",
        duka_tf,
        "--out",
        str(out_dir),
        "--from",
        from_date,
        "--to",
        to_date,
    ]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=60 * 30,
            check=False,
        )
    except FileNotFoundError as e:
        raise RuntimeError(
            "Node.js is required for Free API (Dukascopy). Install Node and run `npm install`."
        ) from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"Dukascopy download timed out for {duka_tf}") from e

    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "").strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"Dukascopy fetch failed ({duka_tf}): {detail}")


def _resample_weekly_from_daily(daily_path: Path, weekly_path: Path) -> None:
    df = pd.read_csv(daily_path)
    if "volume" not in df.columns:
        df["volume"] = 0.0
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    df = df.sort_values("datetime").set_index("datetime")
    weekly = df.resample("W-FRI").agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    )
    weekly = weekly.dropna(subset=["open", "high", "low", "close"]).reset_index()
    weekly_path.parent.mkdir(parents=True, exist_ok=True)
    weekly.to_csv(weekly_path, index=False)


def ensure_free_csv(tf: str, *, force: bool = False) -> Path:
    """
    Ensure a free-API CSV exists under FREE_DATA_DIR (Dukascopy + disk cache).
    Returns the path to the CSV. Thread-safe per timeframe.
    """
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")

    path = _free_path(key)
    with _lock_for(key):
        if path.exists() and path.stat().st_size > 0 and not force:
            return path

        FREE_DATA_DIR.mkdir(parents=True, exist_ok=True)
        from_date = _history_from(key)
        to_date = date.today().isoformat()

        if key == "1W":
            daily = ensure_free_csv("1D", force=force)
            _resample_weekly_from_daily(daily, path)
            return path

        duka = TF_TO_DUKASCOPY.get(key)
        if not duka:
            raise ValueError(f"No Dukascopy mapping for {key}")

        _run_dukascopy(duka, FREE_DATA_DIR, from_date, to_date)
        if not path.exists() or path.stat().st_size == 0:
            raise FileNotFoundError(f"Free API download did not produce {path.name}")
        return path


def free_timeframe_status() -> list[dict]:
    """All TFs are available via free API; report cache meta when present."""
    items: list[dict] = []
    for tf, filename in TIMEFRAME_FILES.items():
        path = FREE_DATA_DIR / filename
        exists = True  # fetchable on demand
        rows = 0
        start = None
        end = None
        size_bytes = 0
        cached = path.exists() and path.stat().st_size > 0
        if cached:
            size_bytes = path.stat().st_size
            try:
                # Lazy import avoids circular import with data_loader
                from .data_loader import _csv_edge_meta

                rows, start, end = _csv_edge_meta(path)
            except Exception:
                pass
        items.append(
            {
                "tf": tf,
                "filename": filename,
                "exists": exists,
                "cached": cached,
                "rows": rows,
                "start": start,
                "end": end,
                "size_bytes": size_bytes,
                "source": "free",
            }
        )
    return items
