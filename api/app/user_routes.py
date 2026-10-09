from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from .auth_firebase import AuthedUser, require_user
from .db import connect

router = APIRouter(prefix="/api/user", tags=["user"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def ensure_profile(conn: Any, user: AuthedUser) -> None:
    """Upsert the authenticated user's profile row (idempotent)."""
    conn.execute(
        """
        insert into public.profiles (id, email)
        values (%s, %s)
        on conflict (id) do update set email = excluded.email
        """,
        (user.uid, user.email),
    )


def _not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def _require_owned_strategy(conn: Any, strategy_id: UUID, user: AuthedUser) -> None:
    cur = conn.execute(
        "select id from public.strategies where id = %s and user_id = %s",
        (str(strategy_id), user.uid),
    )
    if cur.fetchone() is None:
        raise _not_found("Strategy not found")


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


class StrategyCreate(BaseModel):
    name: str
    pair: str = "XAUUSD"
    tf: str = "1H"
    notes: str | None = None
    engine: str | None = None
    engine_params: dict[str, Any] = Field(default_factory=dict)


class StrategyUpdate(BaseModel):
    name: str | None = None
    pair: str | None = None
    tf: str | None = None
    notes: str | None = None
    engine: str | None = None
    engine_params: dict[str, Any] | None = None


@router.get("/strategies")
def list_user_strategies(user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        ensure_profile(conn, user)
        cur = conn.execute(
            "select * from public.strategies where user_id = %s order by updated_at desc",
            (user.uid,),
        )
        rows = cur.fetchall()
    return {"strategies": rows}


@router.post("/strategies")
def create_user_strategy(body: StrategyCreate, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        ensure_profile(conn, user)
        cur = conn.execute(
            """
            insert into public.strategies (user_id, name, pair, tf, notes, engine, engine_params)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning *
            """,
            (
                user.uid,
                body.name.strip(),
                body.pair,
                body.tf,
                body.notes,
                body.engine,
                Json(body.engine_params),
            ),
        )
        row = cur.fetchone()
    return {"strategy": row}


@router.patch("/strategies/{strategy_id}")
def update_user_strategy(
    strategy_id: UUID,
    body: StrategyUpdate,
    user: AuthedUser = Depends(require_user),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        with connect() as conn:
            cur = conn.execute(
                "select * from public.strategies where id = %s and user_id = %s",
                (str(strategy_id), user.uid),
            )
            row = cur.fetchone()
        if row is None:
            raise _not_found("Strategy not found")
        return {"strategy": row}

    set_clauses: list[str] = []
    params: list[Any] = []
    for key, value in updates.items():
        if key == "engine_params":
            value = Json(value)
        set_clauses.append(f"{key} = %s")
        params.append(value)
    params.extend([str(strategy_id), user.uid])

    with connect() as conn:
        cur = conn.execute(
            f"""
            update public.strategies
            set {', '.join(set_clauses)}
            where id = %s and user_id = %s
            returning *
            """,
            params,
        )
        row = cur.fetchone()
    if row is None:
        raise _not_found("Strategy not found")
    return {"strategy": row}


@router.delete("/strategies/{strategy_id}")
def delete_user_strategy(strategy_id: UUID, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        cur = conn.execute(
            "delete from public.strategies where id = %s and user_id = %s returning id",
            (str(strategy_id), user.uid),
        )
        row = cur.fetchone()
    if row is None:
        raise _not_found("Strategy not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Drawings
# ---------------------------------------------------------------------------


class DrawingsPayload(BaseModel):
    drawings: list[Any] = Field(default_factory=list)


@router.get("/strategies/{strategy_id}/drawings")
def get_strategy_drawings(strategy_id: UUID, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        cur = conn.execute(
            "select payload from public.strategy_drawings where strategy_id = %s and user_id = %s",
            (str(strategy_id), user.uid),
        )
        row = cur.fetchone()
    payload = row["payload"] if row else []
    return {"drawings": payload}


@router.put("/strategies/{strategy_id}/drawings")
def put_strategy_drawings(
    strategy_id: UUID,
    body: DrawingsPayload,
    user: AuthedUser = Depends(require_user),
):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        conn.execute(
            """
            insert into public.strategy_drawings (strategy_id, user_id, payload)
            values (%s, %s, %s)
            on conflict (strategy_id) do update
                set payload = excluded.payload, user_id = excluded.user_id
            """,
            (str(strategy_id), user.uid, Json(body.drawings)),
        )
        # Touch the parent strategy so list views sort by latest activity.
        conn.execute(
            "update public.strategies set updated_at = now() where id = %s and user_id = %s",
            (str(strategy_id), user.uid),
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Pine scripts
# ---------------------------------------------------------------------------


class PineScriptCreate(BaseModel):
    name: str
    source: str = ""


class PineScriptUpdate(BaseModel):
    name: str | None = None
    source: str | None = None


@router.get("/pine-scripts")
def list_pine_scripts(user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        ensure_profile(conn, user)
        cur = conn.execute(
            "select * from public.pine_scripts where user_id = %s order by updated_at desc",
            (user.uid,),
        )
        rows = cur.fetchall()
    return {"scripts": rows}


@router.post("/pine-scripts")
def create_pine_script(body: PineScriptCreate, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        ensure_profile(conn, user)
        cur = conn.execute(
            """
            insert into public.pine_scripts (user_id, name, source)
            values (%s, %s, %s)
            returning *
            """,
            (user.uid, body.name.strip() or "Untitled script", body.source),
        )
        row = cur.fetchone()
    return {"script": row}


@router.patch("/pine-scripts/{script_id}")
def update_pine_script(
    script_id: UUID,
    body: PineScriptUpdate,
    user: AuthedUser = Depends(require_user),
):
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    set_clauses = [f"{key} = %s" for key in updates]
    params: list[Any] = list(updates.values()) + [str(script_id), user.uid]

    with connect() as conn:
        cur = conn.execute(
            f"""
            update public.pine_scripts
            set {', '.join(set_clauses)}
            where id = %s and user_id = %s
            returning *
            """,
            params,
        )
        row = cur.fetchone()
    if row is None:
        raise _not_found("Pine script not found")
    return {"script": row}


@router.delete("/pine-scripts/{script_id}")
def delete_pine_script(script_id: UUID, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        cur = conn.execute(
            "delete from public.pine_scripts where id = %s and user_id = %s returning id",
            (str(script_id), user.uid),
        )
        row = cur.fetchone()
    if row is None:
        raise _not_found("Pine script not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Strategy <-> Pine overlays
# ---------------------------------------------------------------------------


class OverlayCreate(BaseModel):
    script_id: UUID


@router.get("/strategies/{strategy_id}/pine-overlays")
def list_strategy_overlays(strategy_id: UUID, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        cur = conn.execute(
            """
            select script_id from public.strategy_pine_overlays
            where strategy_id = %s and user_id = %s
            """,
            (str(strategy_id), user.uid),
        )
        rows = cur.fetchall()
    return {"script_ids": [row["script_id"] for row in rows]}


def _upsert_overlay(strategy_id: UUID, body: OverlayCreate, user: AuthedUser) -> dict[str, Any]:
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        conn.execute(
            """
            insert into public.strategy_pine_overlays (strategy_id, script_id, user_id)
            values (%s, %s, %s)
            on conflict (strategy_id, script_id) do nothing
            """,
            (str(strategy_id), str(body.script_id), user.uid),
        )
    return {"ok": True}


@router.post("/strategies/{strategy_id}/pine-overlays")
def add_strategy_overlay(
    strategy_id: UUID,
    body: OverlayCreate,
    user: AuthedUser = Depends(require_user),
):
    return _upsert_overlay(strategy_id, body, user)


@router.put("/strategies/{strategy_id}/pine-overlays")
def upsert_strategy_overlay(
    strategy_id: UUID,
    body: OverlayCreate,
    user: AuthedUser = Depends(require_user),
):
    return _upsert_overlay(strategy_id, body, user)


@router.delete("/strategies/{strategy_id}/pine-overlays/{script_id}")
def remove_strategy_overlay(
    strategy_id: UUID,
    script_id: UUID,
    user: AuthedUser = Depends(require_user),
):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        conn.execute(
            """
            delete from public.strategy_pine_overlays
            where strategy_id = %s and script_id = %s and user_id = %s
            """,
            (str(strategy_id), str(script_id), user.uid),
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Backtest runs
# ---------------------------------------------------------------------------


class BacktestRunCreate(BaseModel):
    engine: str
    params: dict[str, Any] = Field(default_factory=dict)
    tf: str
    start_at: str | None = None
    end_at: str | None = None
    result: dict[str, Any] = Field(default_factory=dict)


@router.get("/strategies/{strategy_id}/backtest-runs")
def list_backtest_runs(strategy_id: UUID, user: AuthedUser = Depends(require_user)):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        cur = conn.execute(
            """
            select * from public.backtest_runs
            where strategy_id = %s and user_id = %s
            order by created_at desc
            limit 20
            """,
            (str(strategy_id), user.uid),
        )
        rows = cur.fetchall()
    return {"runs": rows}


@router.post("/strategies/{strategy_id}/backtest-runs")
def create_backtest_run(
    strategy_id: UUID,
    body: BacktestRunCreate,
    user: AuthedUser = Depends(require_user),
):
    with connect() as conn:
        _require_owned_strategy(conn, strategy_id, user)
        cur = conn.execute(
            """
            insert into public.backtest_runs
                (strategy_id, user_id, engine, params, tf, start_at, end_at, result)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            returning *
            """,
            (
                str(strategy_id),
                user.uid,
                body.engine,
                Json(body.params),
                body.tf,
                body.start_at,
                body.end_at,
                Json(body.result),
            ),
        )
        row = cur.fetchone()
    return {"run": row}
