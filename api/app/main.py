from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .backtester import result_to_dict, run_backtest
from .config import TIMEFRAMES
from .data_loader import candles_payload, load_ohlc, timeframe_status
from .strategies import create_strategy, list_strategies

app = FastAPI(title="Finhubkh XAUUSD Terminal", version="1.0.0")

_cors = [
    o.strip()
    for o in (os.environ.get("CORS_ORIGINS") or "*").split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BacktestRequest(BaseModel):
    strategy: str = Field(..., examples=["sma_cross"])
    tf: str = Field(..., examples=["1H"])
    start: str | None = None
    end: str | None = None
    params: dict = Field(default_factory=dict)
    initial_capital: float = 10_000.0
    position_size: float = 1.0
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    limit: int | None = 20_000


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/timeframes")
def get_timeframes():
    try:
        return {"timeframes": TIMEFRAMES, "files": timeframe_status()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/strategies")
def get_strategies():
    return {"strategies": list_strategies()}


@app.get("/api/candles")
def get_candles(
    tf: str = Query(..., description="Timeframe e.g. 15M"),
    start: str | None = None,
    end: str | None = None,
    limit: int | None = Query(
        None,
        ge=1,
        le=5_000_000,
        description="Optional cap. Omit to load the entire history.",
    ),
):
    try:
        return candles_payload(tf, start=start, end=end, limit=limit)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.post("/api/backtest")
def post_backtest(body: BacktestRequest):
    try:
        df = load_ohlc(
            body.tf,
            start=body.start,
            end=body.end,
            limit=body.limit,
        )
        strategy = create_strategy(body.strategy, body.params)
        result = run_backtest(
            df,
            strategy,
            tf=body.tf.upper(),
            initial_capital=body.initial_capital,
            position_size=body.position_size,
            stop_loss_pct=body.stop_loss_pct,
            take_profit_pct=body.take_profit_pct,
        )
        return result_to_dict(result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
