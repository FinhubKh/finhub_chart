from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

import numpy as np
import pandas as pd

from .strategies.base import Bar, Strategy

Side = Literal["long", "short"]


@dataclass
class Trade:
    entry_time: str
    exit_time: str
    side: Side
    entry_price: float
    exit_price: float
    pnl: float
    pnl_pct: float
    bars_held: int


@dataclass
class BacktestResult:
    strategy: str
    tf: str
    params: dict
    initial_capital: float
    final_equity: float
    net_pnl: float
    return_pct: float
    total_trades: int
    win_rate: float
    profit_factor: float
    max_drawdown_pct: float
    trades: list[Trade]
    equity_curve: list[dict]
    markers: list[dict]


def _max_drawdown_pct(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return 0.0
    peaks = np.maximum.accumulate(equity)
    dd = (equity - peaks) / peaks
    return float(abs(dd.min()) * 100) if len(dd) else 0.0


def run_backtest(
    df: pd.DataFrame,
    strategy: Strategy,
    *,
    tf: str,
    initial_capital: float = 10_000.0,
    position_size: float = 1.0,
    stop_loss_pct: float | None = None,
    take_profit_pct: float | None = None,
) -> BacktestResult:
    if df.empty:
        raise ValueError("No bars available for backtest range.")

    strategy.reset()
    cash = float(initial_capital)
    position: Side | None = None
    entry_price = 0.0
    entry_idx = 0
    entry_time = None
    units = 0.0

    trades: list[Trade] = []
    equity_curve: list[dict] = []
    markers: list[dict] = []
    work = df.reset_index(drop=True)

    for i in range(len(work)):
        row = work.iloc[i]
        bar = Bar(
            time=row["datetime"],
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=float(row.get("volume", 0.0) or 0.0),
        )
        history = work.iloc[: i + 1]

        # Manage open position exits on this bar (SL/TP using high/low)
        if position is not None:
            exit_price = None
            if position == "long":
                if stop_loss_pct is not None and bar.low <= entry_price * (
                    1 - stop_loss_pct / 100
                ):
                    exit_price = entry_price * (1 - stop_loss_pct / 100)
                elif take_profit_pct is not None and bar.high >= entry_price * (
                    1 + take_profit_pct / 100
                ):
                    exit_price = entry_price * (1 + take_profit_pct / 100)
            else:
                if stop_loss_pct is not None and bar.high >= entry_price * (
                    1 + stop_loss_pct / 100
                ):
                    exit_price = entry_price * (1 + stop_loss_pct / 100)
                elif take_profit_pct is not None and bar.low <= entry_price * (
                    1 - take_profit_pct / 100
                ):
                    exit_price = entry_price * (1 - take_profit_pct / 100)

            if exit_price is not None:
                pnl = (
                    (exit_price - entry_price) * units
                    if position == "long"
                    else (entry_price - exit_price) * units
                )
                cash += pnl
                trades.append(
                    Trade(
                        entry_time=str(entry_time),
                        exit_time=str(bar.time),
                        side=position,
                        entry_price=entry_price,
                        exit_price=float(exit_price),
                        pnl=float(pnl),
                        pnl_pct=float(pnl / initial_capital * 100),
                        bars_held=i - entry_idx,
                    )
                )
                markers.append(
                    {
                        "time": int(pd.Timestamp(bar.time).timestamp()),
                        "position": "aboveBar" if position == "long" else "belowBar",
                        "color": "#ef5350" if pnl < 0 else "#26a69a",
                        "shape": "circle",
                        "text": "SL/TP",
                    }
                )
                position = None
                units = 0.0

        signal = strategy.on_bar(bar, history)

        # buy/sell change target side; flat = hold current position
        desired: Side | None
        if signal == "buy":
            desired = "long"
        elif signal == "sell":
            desired = "short"
        else:
            desired = position

        # Close / flip
        if position is not None and desired != position:
            exit_price = bar.close
            pnl = (
                (exit_price - entry_price) * units
                if position == "long"
                else (entry_price - exit_price) * units
            )
            cash += pnl
            trades.append(
                Trade(
                    entry_time=str(entry_time),
                    exit_time=str(bar.time),
                    side=position,
                    entry_price=entry_price,
                    exit_price=float(exit_price),
                    pnl=float(pnl),
                    pnl_pct=float(pnl / initial_capital * 100),
                    bars_held=i - entry_idx,
                )
            )
            markers.append(
                {
                    "time": int(pd.Timestamp(bar.time).timestamp()),
                    "position": "aboveBar" if position == "long" else "belowBar",
                    "color": "#ef5350" if pnl < 0 else "#26a69a",
                    "shape": "circle",
                    "text": "X",
                }
            )
            position = None
            units = 0.0

        if desired is not None and position is None:
            position = desired
            entry_price = bar.close
            entry_idx = i
            entry_time = bar.time
            # Notional position size in ounces-equivalent units
            units = (initial_capital * position_size) / entry_price
            markers.append(
                {
                    "time": int(pd.Timestamp(bar.time).timestamp()),
                    "position": "belowBar" if position == "long" else "aboveBar",
                    "color": "#26a69a" if position == "long" else "#ef5350",
                    "shape": "arrowUp" if position == "long" else "arrowDown",
                    "text": "L" if position == "long" else "S",
                }
            )

        mark = cash
        if position == "long":
            mark += (bar.close - entry_price) * units
        elif position == "short":
            mark += (entry_price - bar.close) * units
        equity_curve.append(
            {
                "time": int(pd.Timestamp(bar.time).timestamp()),
                "equity": float(mark),
            }
        )

    # Force close at end
    if position is not None:
        last = df.iloc[-1]
        exit_price = float(last.close)
        pnl = (
            (exit_price - entry_price) * units
            if position == "long"
            else (entry_price - exit_price) * units
        )
        cash += pnl
        trades.append(
            Trade(
                entry_time=str(entry_time),
                exit_time=str(last.datetime),
                side=position,
                entry_price=entry_price,
                exit_price=exit_price,
                pnl=float(pnl),
                pnl_pct=float(pnl / initial_capital * 100),
                bars_held=len(df) - 1 - entry_idx,
            )
        )

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_profit = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))
    profit_factor = (
        float(gross_profit / gross_loss) if gross_loss > 0 else float("inf") if gross_profit > 0 else 0.0
    )
    eq = np.array([p["equity"] for p in equity_curve], dtype=float)
    final_equity = float(eq[-1]) if len(eq) else float(initial_capital)

    return BacktestResult(
        strategy=strategy.name,
        tf=tf,
        params=strategy.params,
        initial_capital=float(initial_capital),
        final_equity=final_equity,
        net_pnl=final_equity - initial_capital,
        return_pct=(final_equity / initial_capital - 1) * 100,
        total_trades=len(trades),
        win_rate=(len(wins) / len(trades) * 100) if trades else 0.0,
        profit_factor=profit_factor if profit_factor != float("inf") else 999.0,
        max_drawdown_pct=_max_drawdown_pct(eq),
        trades=trades,
        equity_curve=equity_curve[:: max(1, len(equity_curve) // 2000)],
        markers=markers,
    )


def result_to_dict(result: BacktestResult) -> dict:
    payload = asdict(result)
    return payload
