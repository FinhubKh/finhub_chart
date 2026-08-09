#!/usr/bin/env python3
"""Resample XAUUSD daily CSV into weekly bars (W-FRI close convention)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "xauusd"
DAILY = DATA / "XAUUSD_1D.csv"
WEEKLY = DATA / "XAUUSD_1W.csv"


def main() -> None:
    if not DAILY.exists():
        raise SystemExit(f"Missing daily file: {DAILY}. Run download first.")

    df = pd.read_csv(DAILY)
    if df.empty:
        raise SystemExit("Daily CSV is empty.")

    df["datetime"] = pd.to_datetime(df["datetime"], utc=True)
    df = df.set_index("datetime").sort_index()

    weekly = (
        df.resample("W-FRI")
        .agg(
            {
                "open": "first",
                "high": "max",
                "low": "min",
                "close": "last",
                "volume": "sum",
            }
        )
        .dropna(subset=["open", "high", "low", "close"])
    )

    weekly = weekly.reset_index()
    weekly["datetime"] = weekly["datetime"].dt.strftime("%Y-%m-%d %H:%M:%S")
    DATA.mkdir(parents=True, exist_ok=True)
    weekly.to_csv(WEEKLY, index=False)
    print(f"Wrote {len(weekly):,} weekly bars → {WEEKLY}")


if __name__ == "__main__":
    main()
