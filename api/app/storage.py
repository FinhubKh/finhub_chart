from __future__ import annotations

import concurrent.futures
import io
import os
import tempfile
import threading
from functools import lru_cache
from pathlib import Path

import pandas as pd
from botocore.client import Config
from botocore.exceptions import ClientError

from .config import DATA_DIR, ROOT, TIMEFRAME_FILES, TIMEFRAMES

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

# Full-frame cache (heavy). Used for history scroll / replay windows.
_df_cache: dict[str, tuple[str, pd.DataFrame]] = {}  # tf -> (etag, df)
# Lightweight bounds cache: tf -> (etag, meta dict)
_bounds_cache: dict[str, tuple[str, dict]] = {}
# Recent-tail cache: tf -> (etag, limit, df)
_tail_cache: dict[str, tuple[str, int, pd.DataFrame]] = {}

_CSV_HEADER = "datetime,open,high,low,close,volume\n"
# Typical FinHub OHLC row ~70–90 bytes; pad for safety when estimating tails.
_AVG_ROW_BYTES = 96
_MIN_TAIL_BYTES = 64 * 1024
_MAX_TAIL_BYTES = 8 * 1024 * 1024


def _lock_for(name: str) -> threading.Lock:
    with _locks_guard:
        if name not in _locks:
            _locks[name] = threading.Lock()
        return _locks[name]


def load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def finhub_uses_r2() -> bool:
    load_dotenv()
    return (os.environ.get("FINHUB_DATA_SOURCE") or "local").strip().lower() == "r2"


def r2_configured() -> bool:
    load_dotenv()
    return bool(
        os.environ.get("R2_ACCOUNT_ID")
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
        and os.environ.get("R2_BUCKET")
    )


@lru_cache(maxsize=1)
def _s3():
    import boto3

    load_dotenv()
    account = os.environ["R2_ACCOUNT_ID"].strip()
    endpoint = (
        os.environ.get("R2_ENDPOINT") or f"https://{account}.r2.cloudflarestorage.com"
    ).strip()
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _object_key(filename: str) -> str:
    load_dotenv()
    prefix = (os.environ.get("R2_PREFIX") or "xauusd").strip().strip("/")
    return f"{prefix}/{filename}" if prefix else filename


def _normalize_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    required = {"datetime", "open", "high", "low", "close"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {sorted(missing)}")
    if "volume" not in df.columns:
        df["volume"] = 0.0
    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    df = df.sort_values("datetime").drop_duplicates(subset=["datetime"], keep="last")
    return df.reset_index(drop=True)


def _load_local_csv(tf: str) -> pd.DataFrame:
    key = tf.upper()
    path = DATA_DIR / TIMEFRAME_FILES[key]
    if not path.exists():
        raise FileNotFoundError(
            f"Missing FinHub data for {tf}: {path}. Run `npm run data` first."
        )
    return _normalize_ohlc(pd.read_csv(path))


def _r2_head(bucket: str, obj_key: str) -> dict:
    try:
        return _s3().head_object(Bucket=bucket, Key=obj_key)
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            raise FileNotFoundError(
                f"Missing R2 object s3://{bucket}/{obj_key}. "
                "Run `python3 scripts/upload_r2.py`."
            ) from e
        raise


def _r2_get_bytes(bucket: str, obj_key: str, start: int, end: int) -> bytes:
    """Inclusive byte range get."""
    if end < start:
        return b""
    resp = _s3().get_object(
        Bucket=bucket,
        Key=obj_key,
        Range=f"bytes={start}-{end}",
    )
    return resp["Body"].read()


def _parse_csv_bytes(raw: bytes) -> pd.DataFrame:
    if not raw:
        return pd.DataFrame(columns=["datetime", "open", "high", "low", "close", "volume"])
    text = raw.decode("utf-8", errors="ignore")
    if not text.lstrip().startswith("datetime"):
        text = _CSV_HEADER + text
    return _normalize_ohlc(pd.read_csv(io.StringIO(text)))


def _dt_from_csv_line(line: bytes) -> str | None:
    try:
        part = line.decode("utf-8", errors="ignore").split(",", 1)[0].strip()
        return part or None
    except Exception:
        return None


def _r2_bounds(bucket: str, obj_key: str, etag: str, size: int) -> dict:
    """First/last datetime + estimated row count without full download."""
    if size <= 0:
        return {
            "count": 0,
            "start": None,
            "end": None,
            "start_unix": None,
            "end_unix": None,
            "size_bytes": 0,
        }

    # Header + first row
    head_chunk = _r2_get_bytes(bucket, obj_key, 0, min(size - 1, 4095))
    lines = head_chunk.splitlines()
    first = None
    for line in lines[1:]:
        if line.strip():
            first = line
            break

    # Last complete row from file tail
    tail_len = min(65536, size)
    tail = _r2_get_bytes(bucket, obj_key, max(0, size - tail_len), size - 1)
    tail_lines = tail.splitlines()
    last = None
    for line in reversed(tail_lines):
        if line.strip() and not line.startswith(b"datetime"):
            last = line
            break

    start_s = _dt_from_csv_line(first) if first else None
    end_s = _dt_from_csv_line(last) if last else None

    start_unix = end_unix = None
    if start_s:
        try:
            start_unix = int(pd.to_datetime(start_s, utc=True).timestamp())
        except Exception:
            pass
    if end_s:
        try:
            end_unix = int(pd.to_datetime(end_s, utc=True).timestamp())
        except Exception:
            pass

    # Estimate rows from size (good enough for UI; exact count needs full scan)
    est = max(0, int((size - len(_CSV_HEADER)) / _AVG_ROW_BYTES))
    return {
        "count": est,
        "start": start_s,
        "end": end_s,
        "start_unix": start_unix,
        "end_unix": end_unix,
        "size_bytes": size,
    }


def r2_timeframe_bounds(tf: str) -> dict:
    """Cheap history bounds for replay picker (no full CSV load)."""
    if not r2_configured():
        raise RuntimeError("R2 credentials incomplete")
    key = tf.upper()
    filename = TIMEFRAME_FILES[key]
    bucket = os.environ["R2_BUCKET"].strip()
    obj_key = _object_key(filename)

    with _lock_for(f"bounds:{filename}"):
        head = _r2_head(bucket, obj_key)
        etag = str(head.get("ETag") or "").strip('"')
        size = int(head.get("ContentLength") or 0)
        cached = _bounds_cache.get(key)
        if cached and cached[0] == etag:
            return cached[1]
        meta = _r2_bounds(bucket, obj_key, etag, size)
        _bounds_cache[key] = (etag, meta)
        return meta


def _fetch_r2_tail(tf: str, limit: int) -> tuple[pd.DataFrame, int, bool]:
    """
    Download only the end of the CSV for a trailing window.
    Returns (df, total_available_estimate, has_more).
    """
    if not r2_configured():
        raise RuntimeError("R2 credentials incomplete")

    key = tf.upper()
    filename = TIMEFRAME_FILES[key]
    bucket = os.environ["R2_BUCKET"].strip()
    obj_key = _object_key(filename)
    need = max(1, int(limit))

    with _lock_for(f"tail:{filename}"):
        head = _r2_head(bucket, obj_key)
        etag = str(head.get("ETag") or "").strip('"')
        size = int(head.get("ContentLength") or 0)

        # Reuse full-frame cache if already warm
        full = _df_cache.get(key)
        if full and full[0] == etag:
            df = full[1]
            out = df.iloc[-need:] if len(df) > need else df
            return out.reset_index(drop=True), int(len(df)), bool(len(df) > need)

        cached = _tail_cache.get(key)
        if cached and cached[0] == etag and cached[1] >= need:
            out = cached[2].iloc[-need:] if len(cached[2]) > need else cached[2]
            est = max(need, int((size - len(_CSV_HEADER)) / _AVG_ROW_BYTES))
            return out.reset_index(drop=True), est, True

        # Grow tail until we have enough rows (usually one shot)
        want_rows = int(need * 1.25) + 50
        byte_budget = min(
            size,
            max(_MIN_TAIL_BYTES, want_rows * _AVG_ROW_BYTES * 2),
        )
        byte_budget = min(byte_budget, _MAX_TAIL_BYTES)

        df = pd.DataFrame()
        while True:
            start = max(0, size - byte_budget)
            raw = _r2_get_bytes(bucket, obj_key, start, size - 1)
            # Drop partial first line when not at file start
            if start > 0:
                nl = raw.find(b"\n")
                if nl >= 0:
                    raw = raw[nl + 1 :]
            df = _parse_csv_bytes(raw)
            if len(df) >= need or start == 0 or byte_budget >= size:
                break
            byte_budget = min(size, byte_budget * 2)

        out = df.iloc[-need:] if len(df) > need else df
        out = out.reset_index(drop=True)
        _tail_cache[key] = (etag, need, out)
        est = max(len(df), int((size - len(_CSV_HEADER)) / _AVG_ROW_BYTES))
        has_more = start > 0 or len(df) > need
        return out, est, has_more


def _fetch_r2_dataframe(tf: str) -> pd.DataFrame:
    """Full CSV download into memory/disk cache (history / replay)."""
    if not r2_configured():
        raise RuntimeError(
            "FINHUB_DATA_SOURCE=r2 but R2 credentials are incomplete in .env"
        )

    key = tf.upper()
    filename = TIMEFRAME_FILES[key]
    load_dotenv()
    bucket = os.environ["R2_BUCKET"].strip()
    obj_key = _object_key(filename)

    with _lock_for(filename):
        head = _r2_head(bucket, obj_key)
        etag = str(head.get("ETag") or "").strip('"')
        cached = _df_cache.get(key)
        if cached and cached[0] == etag:
            return cached[1]

        tmp_path = Path(tempfile.gettempdir()) / f"finhub_{etag}_{filename}"
        if tmp_path.exists():
            try:
                df = _normalize_ohlc(pd.read_csv(tmp_path))
                _df_cache[key] = (etag, df)
                return df
            except Exception:
                pass

        _s3().download_file(bucket, obj_key, str(tmp_path))
        df = _normalize_ohlc(pd.read_csv(tmp_path))
        _df_cache[key] = (etag, df)
        return df


def load_finhub_dataframe(tf: str) -> pd.DataFrame:
    """
    Load FinHub OHLC (full history).
    Prefer load_finhub_tail() for chart first paint.
    """
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")
    if finhub_uses_r2():
        return _fetch_r2_dataframe(key)
    return _load_local_csv(key)


def load_finhub_tail(tf: str, limit: int) -> tuple[pd.DataFrame, int, bool]:
    """Trailing window for chart first paint — avoids full CSV download on R2."""
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")
    need = max(1, int(limit))
    if finhub_uses_r2():
        return _fetch_r2_tail(key, need)
    df = _load_local_csv(key)
    out = df.iloc[-need:] if len(df) > need else df
    return out.reset_index(drop=True), int(len(df)), bool(len(df) > need)


def load_finhub_before(
    tf: str, before: str, limit: int
) -> tuple[pd.DataFrame, int, bool]:
    """
    Older bars strictly before `before` (ISO/parseable), without full CSV when possible.
    Walks backwards from the file end via R2 byte ranges.
    """
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")
    need = max(1, int(limit))
    before_ts = pd.to_datetime(before, utc=True)

    if not finhub_uses_r2():
        df = _load_local_csv(key)
        older = df[df["datetime"] < before_ts]
        out = older.iloc[-need:] if len(older) > need else older
        return out.reset_index(drop=True), int(len(df)), bool(len(older) > need)

    if not r2_configured():
        raise RuntimeError("R2 credentials incomplete")

    filename = TIMEFRAME_FILES[key]
    bucket = os.environ["R2_BUCKET"].strip()
    obj_key = _object_key(filename)

    with _lock_for(f"before:{filename}"):
        head = _r2_head(bucket, obj_key)
        etag = str(head.get("ETag") or "").strip('"')
        size = int(head.get("ContentLength") or 0)

        full = _df_cache.get(key)
        if full and full[0] == etag:
            df = full[1]
            older = df[df["datetime"] < before_ts]
            out = older.iloc[-need:] if len(older) > need else older
            return out.reset_index(drop=True), int(len(df)), bool(len(older) > need)

        byte_budget = min(size, max(_MIN_TAIL_BYTES, (need + 200) * _AVG_ROW_BYTES * 3))
        byte_budget = min(byte_budget, _MAX_TAIL_BYTES * 4)
        df = pd.DataFrame()
        start = max(0, size - byte_budget)
        while True:
            raw = _r2_get_bytes(bucket, obj_key, start, size - 1)
            if start > 0:
                nl = raw.find(b"\n")
                if nl >= 0:
                    raw = raw[nl + 1 :]
            df = _parse_csv_bytes(raw)
            older = df[df["datetime"] < before_ts] if not df.empty else df
            if len(older) >= need or start == 0 or byte_budget >= size:
                break
            byte_budget = min(size, byte_budget * 2)
            start = max(0, size - byte_budget)

        out = older.iloc[-need:] if len(older) > need else older
        est = max(len(df), int((size - len(_CSV_HEADER)) / _AVG_ROW_BYTES))
        has_more = bool(len(older) > need or start > 0)
        return out.reset_index(drop=True), est, has_more


def finhub_bounds(tf: str) -> dict:
    """History bounds without loading the full frame when on R2."""
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")

    if finhub_uses_r2():
        meta = r2_timeframe_bounds(key)
        return {
            "tf": key,
            "count": int(meta.get("count") or 0),
            "start": meta.get("start"),
            "end": meta.get("end"),
            "start_unix": meta.get("start_unix"),
            "end_unix": meta.get("end_unix"),
        }

    df = _load_local_csv(key)
    if df.empty:
        return {
            "tf": key,
            "count": 0,
            "start": None,
            "end": None,
            "start_unix": None,
            "end_unix": None,
        }
    start_ts = df["datetime"].iloc[0]
    end_ts = df["datetime"].iloc[-1]
    return {
        "tf": key,
        "count": int(len(df)),
        "start": start_ts.isoformat(),
        "end": end_ts.isoformat(),
        "start_unix": int(start_ts.timestamp()),
        "end_unix": int(end_ts.timestamp()),
    }


def r2_timeframe_status() -> list[dict]:
    """Status from R2 object heads only — no local files."""
    load_dotenv()
    items: list[dict] = []
    if not r2_configured():
        for tf, filename in TIMEFRAME_FILES.items():
            items.append(
                {
                    "tf": tf,
                    "filename": filename,
                    "exists": False,
                    "cached": False,
                    "rows": 0,
                    "start": None,
                    "end": None,
                    "size_bytes": 0,
                    "source": "r2",
                }
            )
        return items

    bucket = os.environ["R2_BUCKET"].strip()
    s3 = _s3()

    def _check_tf(item: tuple[str, str]) -> dict:
        tf, filename = item
        obj_key = _object_key(filename)
        exists = False
        size_bytes = 0
        in_memory = tf in _df_cache or tf in _tail_cache
        try:
            head = s3.head_object(Bucket=bucket, Key=obj_key)
            exists = True
            size_bytes = int(head.get("ContentLength") or 0)
        except ClientError:
            pass

        return {
            "tf": tf,
            "filename": filename,
            "exists": exists,
            "cached": in_memory,
            "rows": 0,
            "start": None,
            "end": None,
            "size_bytes": size_bytes,
            "source": "r2",
        }

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        items = list(executor.map(_check_tf, TIMEFRAME_FILES.items()))

    return items
