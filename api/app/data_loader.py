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


def candles_range(tf: str) -> dict:
    """Full dataset bounds for a timeframe (cheap on R2 — no full CSV load)."""
    from .storage import finhub_bounds

    return finhub_bounds(tf)


def candles_payload(
    tf: str,
    start: str | None = None,
    end: str | None = None,
    limit: int | None = None,
    lookback: int = 0,
    before: str | None = None,
) -> dict:
    """Return OHLC candles.

    Modes:
    - No start/end/before: trailing `limit` (recent window).
    - `before` (+ optional `limit`): up to N bars strictly older than `before`
      (scroll-left history pagination).
    - `start`/`end`: explicit window (+ optional `lookback` before `start`).
    """
    # —— Fast path: recent window only (chart first paint) ——
    # Avoid downloading the entire R2 CSV when the UI only needs the last N bars.
    if before is None and start is None and end is None and limit is not None and limit > 0:
        from .storage import load_finhub_tail

        df, total_available, has_more = load_finhub_tail(tf, int(limit))
        if df.empty:
            return {
                "tf": tf.upper(),
                "count": 0,
                "candles": [],
                "total_available": 0,
                "replay_from_index": 0,
                "has_more": False,
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
            "total_available": int(total_available),
            "replay_from_index": 0,
            "has_more": bool(has_more),
        }

    # —— Scroll-left pagination: N bars ending just before `before` ——
    if before is not None and start is None and end is None:
        from .storage import load_finhub_before

        lim = int(limit) if limit is not None and limit > 0 else 4_000
        df, total_available, has_more = load_finhub_before(tf, before, lim)
        if df.empty:
            return {
                "tf": tf.upper(),
                "count": 0,
                "candles": [],
                "total_available": int(total_available),
                "replay_from_index": 0,
                "has_more": False,
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
            "total_available": int(total_available),
            "replay_from_index": 0,
            "has_more": bool(has_more),
        }

    # Explicit start/end (replay) still needs the full frame
    df_full = _load_df(tf)
    if df_full.empty:
        return {
            "tf": tf.upper(),
            "count": 0,
            "candles": [],
            "total_available": 0,
            "replay_from_index": 0,
            "has_more": False,
        }

    begin = 0
    end_pos = len(df_full) - 1
    replay_from_index = 0

    if start:
        start_ts = pd.to_datetime(start, utc=True)
        ge = df_full["datetime"] >= start_ts
        if not bool(ge.any()):
            return {
                "tf": tf.upper(),
                "count": 0,
                "candles": [],
                "total_available": 0,
                "replay_from_index": 0,
                "has_more": False,
            }
        pos = int(ge.to_numpy().nonzero()[0][0])
        look = max(0, int(lookback or 0))
        begin = max(0, pos - look)
        replay_from_index = pos - begin

    if end:
        end_ts = pd.to_datetime(end, utc=True)
        le = df_full["datetime"] <= end_ts
        if not bool(le.any()):
            return {
                "tf": tf.upper(),
                "count": 0,
                "candles": [],
                "total_available": 0,
                "replay_from_index": 0,
                "has_more": False,
            }
        end_pos = int(le.to_numpy().nonzero()[0][-1])

    if begin > end_pos:
        return {
            "tf": tf.upper(),
            "count": 0,
            "candles": [],
            "total_available": 0,
            "replay_from_index": 0,
            "has_more": False,
        }

    df = df_full.iloc[begin : end_pos + 1]
    total_available = len(df)

    # Chart "recent window" mode: no start/end, just trailing limit
    if start is None and end is None and limit is not None and limit > 0:
        if total_available > limit:
            df = df.iloc[-limit:]
            total_available = len(df_full)  # true history size
            replay_from_index = 0
            df = df.reset_index(drop=True)
        else:
            df = df.reset_index(drop=True)
    else:
        # Explicit period (replay): refuse huge windows instead of silently truncating
        max_window = 100_000
        if total_available > max_window:
            raise ValueError(
                f"Period has {total_available:,} bars (max {max_window:,}). "
                "Narrow From/To or use a higher timeframe."
            )
        df = df.reset_index(drop=True)

    if df.empty:
        return {
            "tf": tf.upper(),
            "count": 0,
            "candles": [],
            "total_available": 0,
            "replay_from_index": 0,
            "has_more": False,
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
    # Trailing window: more history exists left of the slice
    has_more = bool(
        start is None
        and end is None
        and limit is not None
        and limit > 0
        and total_available > len(candles)
    )
    return {
        "tf": tf.upper(),
        "count": len(candles),
        "candles": candles,
        "total_available": int(total_available),
        "replay_from_index": int(replay_from_index),
        "has_more": has_more,
    }
