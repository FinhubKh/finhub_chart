from __future__ import annotations

import io
import os
import threading
import tempfile
import concurrent.futures
from functools import lru_cache

import pandas as pd
from botocore.client import Config
from botocore.exceptions import ClientError

from .config import DATA_DIR, ROOT, TIMEFRAME_FILES, TIMEFRAMES

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()

# In-memory only — never write R2 CSVs to disk
_df_cache: dict[str, tuple[str, pd.DataFrame]] = {}  # tf -> (etag, df)


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


def _fetch_r2_dataframe(tf: str) -> pd.DataFrame:
    """Stream CSV bytes from R2 into a DataFrame — no disk write."""
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
        try:
            head = _s3().head_object(Bucket=bucket, Key=obj_key)
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                raise FileNotFoundError(
                    f"Missing R2 object s3://{bucket}/{obj_key}. "
                    "Run `python3 scripts/upload_r2.py`."
                ) from e
            raise

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
                pass  # Fallback to download if corrupted

        _s3().download_file(bucket, obj_key, str(tmp_path))
        df = _normalize_ohlc(pd.read_csv(tmp_path))
        _df_cache[key] = (etag, df)
        return df


def load_finhub_dataframe(tf: str) -> pd.DataFrame:
    """
    Load FinHub OHLC.
    - FINHUB_DATA_SOURCE=r2  → stream from Cloudflare R2 (memory only)
    - FINHUB_DATA_SOURCE=local → read data/xauusd on disk
    """
    key = tf.upper()
    if key not in TIMEFRAME_FILES:
        raise ValueError(f"Unsupported timeframe: {tf}. Use one of {TIMEFRAMES}")
    if finhub_uses_r2():
        return _fetch_r2_dataframe(key)
    return _load_local_csv(key)


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
        in_memory = tf in _df_cache
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
