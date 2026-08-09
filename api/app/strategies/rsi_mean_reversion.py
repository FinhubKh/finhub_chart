from __future__ import annotations

import pandas as pd

from .base import Bar, Signal, Strategy


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


class RsiMeanReversionStrategy(Strategy):
    name = "rsi_mean_reversion"

    def __init__(
        self,
        period: int = 14,
        oversold: float = 30,
        overbought: float = 70,
        **kwargs,
    ):
        super().__init__(
            period=period, oversold=oversold, overbought=overbought, **kwargs
        )
        self.period = int(period)
        self.oversold = float(oversold)
        self.overbought = float(overbought)
        self._position: Signal = "flat"

    def reset(self) -> None:
        self._position = "flat"

    def on_bar(self, bar: Bar, history: pd.DataFrame) -> Signal:
        need = self.period + 5
        if len(history) < need:
            return "flat"
        values = rsi(history["close"].iloc[-(need + 20) :], self.period)
        cur = values.iloc[-1]
        if pd.isna(cur):
            return "flat"
        if cur < self.oversold:
            self._position = "buy"
        elif cur > self.overbought:
            self._position = "sell"
        return self._position
