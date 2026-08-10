#!/usr/bin/env python3
"""Upload local FinHub CSVs (data/xauusd) to Cloudflare R2.

Requires .env at repo root:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
  optional: R2_PREFIX (default xauusd), R2_ENDPOINT
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from botocore.client import Config
from botocore.exceptions import ClientError

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "xauusd"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def client():
    import boto3

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


def ensure_bucket(s3, bucket: str) -> None:
    try:
        s3.head_bucket(Bucket=bucket)
        print(f"bucket exists: {bucket}")
    except ClientError:
        s3.create_bucket(Bucket=bucket)
        print(f"bucket created: {bucket}")


def main() -> int:
    load_dotenv(ROOT / ".env")
    bucket = (os.environ.get("R2_BUCKET") or "").strip()
    if not bucket:
        print("Set R2_BUCKET in .env first", file=sys.stderr)
        return 1
    prefix = (os.environ.get("R2_PREFIX") or "xauusd").strip().strip("/")
    files = sorted(DATA_DIR.glob("XAUUSD_*.csv"))
    if not files:
        print(f"No CSVs in {DATA_DIR}", file=sys.stderr)
        return 1

    s3 = client()
    ensure_bucket(s3, bucket)

    for path in files:
        key = f"{prefix}/{path.name}" if prefix else path.name
        mb = path.stat().st_size / (1024 * 1024)
        print(f"upload {path.name} ({mb:.1f} MB) -> s3://{bucket}/{key}")
        s3.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": "text/csv"})

    resp = s3.list_objects_v2(Bucket=bucket, Prefix=f"{prefix}/" if prefix else "")
    print("objects:")
    for obj in resp.get("Contents", []):
        print(f"  {obj['Key']}  {obj['Size']}")
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
