from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal

import pandas as pd

Signal = Literal["buy", "sell", "flat"]


@dataclass
class Bar:
    time: pd.Timestamp
    open: float
    high: float
    low: float
    close: float
    volume: float


class Strategy(ABC):
    name: str = "base"
    params: dict

    def __init__(self, **params):
        self.params = params

    def reset(self) -> None:
        """Optional state reset before a run."""

    @abstractmethod
    def on_bar(self, bar: Bar, history: pd.DataFrame) -> Signal:
        """Return desired position signal after this bar closes."""
