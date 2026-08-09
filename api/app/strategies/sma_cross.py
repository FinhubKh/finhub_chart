from __future__ import annotations

import pandas as pd

from .base import Bar, Signal, Strategy


class SmaCrossStrategy(Strategy):
    name = "sma_cross"

    def __init__(self, fast: int = 20, slow: int = 50, **kwargs):
        super().__init__(fast=fast, slow=slow, **kwargs)
        self.fast = int(fast)
        self.slow = int(slow)

    def on_bar(self, bar: Bar, history: pd.DataFrame) -> Signal:
        n = len(history)
        if n < self.slow + 1:
            return "flat"
        closes = history["close"]
        # Only need the last slow+1 closes for current/previous SMA values
        window = closes.iloc[-(self.slow + 1) :]
        fast = window.rolling(self.fast).mean()
        slow = window.rolling(self.slow).mean()
        prev_fast, prev_slow = fast.iloc[-2], slow.iloc[-2]
        cur_fast, cur_slow = fast.iloc[-1], slow.iloc[-1]
        if pd.isna(prev_fast) or pd.isna(prev_slow) or pd.isna(cur_fast) or pd.isna(cur_slow):
            return "flat"
        if prev_fast <= prev_slow and cur_fast > cur_slow:
            return "buy"
        if prev_fast >= prev_slow and cur_fast < cur_slow:
            return "sell"
        return "flat"
