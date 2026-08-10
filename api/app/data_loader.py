from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import pandas as pd

from .config import DATA_DIR, TIMEFRAME_FILES, TIMEFRAMES


def file_for_tf(tf: str) -> Path:
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")
    return DATA_DIR / TIMEFRAME_FILES[key]


def _csv_edge_meta(path: Path) -> tuple[int, str | None, str | None]:
    """First/last datetime without loading the full CSV into pandas."""
    try:
        with path.open("rb") as f:
            header = f.readline()
            if not header:
                return 0, None, None
            first = f.readline()
            if not first:
                return 0, None, None
            f.seek(0, 2)
            size = f.tell()
            chunk = min(65536, size)
            f.seek(max(0, size - chunk))
            tail = f.read().splitlines()
            last = first
            for line in reversed(tail):
                if line and line != header.rstrip(b"\r\n"):
                    last = line
                    break

        def _dt(line: bytes) -> str | None:
            try:
                return line.decode("utf-8", errors="ignore").split(",", 1)[0].strip() or None
            except Exception:
                return None

        rows = 0
        if size < 2_000_000:
            with path.open("rb") as f:
                rows = max(0, f.read().count(b"\n") - 1)
        return rows, _dt(first), _dt(last)
    except Exception:
        return 0, None, None


def timeframe_status() -> list[dict]:
    from .storage import finhub_uses_r2, r2_timeframe_status

    if finhub_uses_r2():
        return r2_timeframe_status()

    items: list[dict] = []
    for tf, filename in TIMEFRAME_FILES.items():
        path = DATA_DIR / filename
        exists = path.exists()
        rows = 0
        start = None
        end = None
        size_bytes = 0
        if exists:
            size_bytes = path.stat().st_size
            rows, start, end = _csv_edge_meta(path)
        items.append(
            {
                "tf": tf,
                "filename": filename,
                "exists": exists,
                "cached": exists,
                "rows": rows,
                "start": start,
                "end": end,
                "size_bytes": size_bytes,
                "source": "local",
            }
        )
    return items


@lru_cache(maxsize=32)
def _load_csv_cached(path_str: str, mtime: float) -> pd.DataFrame:
    df = pd.read_csv(path_str)
    required = {"datetime", "open", "high", "low", "close"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {sorted(missing)}")
    if "volume" not in df.columns:
        df["volume"] = 0.0
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    df = df.sort_values("datetime").drop_duplicates(subset=["datetime"], keep="last")
    df = df.reset_index(drop=True)
    return df


def _load_df(tf: str) -> pd.DataFrame:
    from .storage import load_finhub_dataframe

    return load_finhub_dataframe(tf).copy()


def load_ohlc(
    tf: str,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    df = _load_df(tf)
    if start:
        df = df[df["datetime"] >= pd.to_datetime(start, utc=True)]
    if end:
        df = df[df["datetime"] <= pd.to_datetime(end, utc=True)]
    if limit is not None and limit > 0 and len(df) > limit:
        df = df.iloc[-limit:]
    return df.reset_index(drop=True)


def candles_payload(
    tf: str,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = None,
) -> dict:
    """Return OHLC candles. `total_available` is always the untruncated filtered length."""
    df = _load_df(tf)
    if start:
        df = df[df["datetime"] >= pd.to_datetime(start, utc=True)]
    if end:
        df = df[df["datetime"] <= pd.to_datetime(end, utc=True)]
    total_available = len(df)
    if limit is not None and limit > 0 and total_available > limit:
        df = df.iloc[-limit:]
    df = df.reset_index(drop=True)

    if df.empty:
        return {
            "tf": tf.upper(),
            "count": 0,
            "candles": [],
            "total_available": 0,
        }

    times = (df["datetime"].astype("int64") // 1_000_000_000).to_numpy()
    opens = df["open"].to_numpy(dtype=float)
    highs = df["high"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    volumes = df["volume"].to_numpy(dtype=float)

    candles = [
        {
            "time": int(times[i]),
            "open": float(opens[i]),
            "high": float(highs[i]),
            "low": float(lows[i]),
            "close": float(closes[i]),
            "volume": float(volumes[i]),
        }
        for i in range(len(df))
    ]
    return {
        "tf": tf.upper(),
        "count": len(candles),
        "candles": candles,
        "total_available": total_available,
    }
