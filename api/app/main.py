from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .backtester import result_to_dict, run_backtest
from .config import DATA_SOURCES, TIMEFRAMES
from .data_loader import candles_payload, load_ohlc, timeframe_status
from .strategies import create_strategy, list_strategies

app = FastAPI(title="Finhubkh XAUUSD Terminal", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    source: str = Field("local", examples=["local", "free"])


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/timeframes")
def get_timeframes(
    source: str = Query("local", description="local (FinHub CSV) or free (Dukascopy)"),
):
    try:
        return {
            "timeframes": TIMEFRAMES,
            "sources": list(DATA_SOURCES),
            "source": source,
            "files": timeframe_status(source),
        }
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
        description="Optional cap. Omit to load the entire CSV history.",
    ),
    source: str = Query(
        "local",
        description="local = FinHub data/xauusd · free = Dukascopy API (cached)",
    ),
):
    try:
        return candles_payload(tf, start=start, end=end, limit=limit, source=source)
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
            source=body.source,
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
