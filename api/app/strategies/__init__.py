from .base import Strategy
from .rsi_mean_reversion import RsiMeanReversionStrategy
from .sma_cross import SmaCrossStrategy

STRATEGIES: dict[str, type[Strategy]] = {
    SmaCrossStrategy.name: SmaCrossStrategy,
    RsiMeanReversionStrategy.name: RsiMeanReversionStrategy,
}


def list_strategies() -> list[dict]:
    return [
        {
            "id": "sma_cross",
            "name": "SMA Crossover",
            "defaults": {"fast": 20, "slow": 50},
        },
        {
            "id": "rsi_mean_reversion",
            "name": "RSI Mean Reversion",
            "defaults": {"period": 14, "oversold": 30, "overbought": 70},
        },
    ]


def create_strategy(strategy_id: str, params: dict | None = None) -> Strategy:
    cls = STRATEGIES.get(strategy_id)
    if cls is None:
        raise ValueError(f"Unknown strategy: {strategy_id}")
    return cls(**(params or {}))
