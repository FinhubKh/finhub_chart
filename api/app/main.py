from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field

from .backtester import result_to_dict, run_backtest
from .config import TIMEFRAMES
from .data_loader import candles_payload, candles_range, load_ohlc, timeframe_status
from .db import close_pool, init_pool
from .instruments import DEFAULT_PAIR, INSTRUMENTS, instrument_symbols, normalize_pair
from .strategies import create_strategy, list_strategies
from .user_routes import router as user_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_pool()
    yield
    close_pool()


app = FastAPI(title="Finhubkh Chart Terminal", version="1.1.0", lifespan=lifespan)

_cors = [
    o.strip()
    for o in (os.environ.get("CORS_ORIGINS") or "*").split(",")
    if o.strip()
]

app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(user_router)


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
    pair: str = DEFAULT_PAIR


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/instruments")
def get_instruments():
    return {
        "default": DEFAULT_PAIR,
        "instruments": INSTRUMENTS,
        "symbols": instrument_symbols(),
    }


@app.get("/api/timeframes")
def get_timeframes(pair: str = Query(DEFAULT_PAIR)):
    try:
        symbol = normalize_pair(pair)
        return {"pair": symbol, "timeframes": TIMEFRAMES, "files": timeframe_status(symbol)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/strategies")
def get_strategies():
    return {"strategies": list_strategies()}


@app.get("/api/range")
def get_range(
    tf: str = Query(..., description="Timeframe e.g. 1H"),
    pair: str = Query(DEFAULT_PAIR),
):
    """Full history bounds for replay period picking."""
    try:
        symbol = normalize_pair(pair)
        return candles_range(tf, symbol)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e


@app.get("/api/candles")
def get_candles(
    tf: str = Query(..., description="Timeframe e.g. 15M"),
    start: str | None = None,
    end: str | None = None,
    before: str | None = Query(
        None,
        description="ISO/unix-parseable time: return bars strictly older than this (scroll-left).",
    ),
    limit: int | None = Query(
        None,
        ge=1,
        le=5_000_000,
        description="Trailing cap, or chunk size when `before` is set.",
    ),
    lookback: int = Query(
        0,
        ge=0,
        le=5_000,
        description="Extra bars before `start` (for indicators during replay).",
    ),
    pair: str = Query(DEFAULT_PAIR),
):
    try:
        symbol = normalize_pair(pair)
        return candles_payload(
            tf,
            start=start,
            end=end,
            limit=limit,
            lookback=lookback,
            before=before,
            pair=symbol,
        )
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
            pair=normalize_pair(body.pair),
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
