from __future__ import annotations

import contextlib

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import user_routes
from app.auth_firebase import AuthedUser, require_user

STRATEGIES = [
    {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "uid-1",
        "name": "My SMA Cross",
        "pair": "XAUUSD",
        "tf": "1H",
        "notes": None,
        "engine": "sma_cross",
        "engine_params": {"fast": 20, "slow": 50},
        "created_at": "2024-01-01T00:00:00+00:00",
        "updated_at": "2024-01-01T00:00:00+00:00",
    },
    {
        "id": "22222222-2222-2222-2222-222222222222",
        "user_id": "uid-2",
        "name": "Someone Else's Strategy",
        "pair": "XAUUSD",
        "tf": "4H",
        "notes": None,
        "engine": "rsi_mean_reversion",
        "engine_params": {},
        "created_at": "2024-01-02T00:00:00+00:00",
        "updated_at": "2024-01-02T00:00:00+00:00",
    },
]


class FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class FakeConn:
    """Minimal stand-in for a psycopg Connection, matching `conn.execute(sql, params)` usage."""

    def __init__(self, strategies):
        self.strategies = strategies
        self.calls: list[tuple[str, object]] = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        normalized = " ".join(sql.split()).lower()

        if normalized.startswith("insert into public.profiles"):
            return FakeCursor([])

        if normalized.startswith("select") and "from public.strategies" in normalized:
            uid = params[0]
            rows = [row for row in self.strategies if row["user_id"] == uid]
            return FakeCursor(rows)

        raise AssertionError(f"Unexpected query in FakeConn.execute: {sql!r}")


def _build_client(fake_conn: FakeConn, monkeypatch, uid: str = "uid-1") -> TestClient:
    monkeypatch.setattr(user_routes, "connect", lambda: contextlib.nullcontext(fake_conn))

    app = FastAPI()
    app.include_router(user_routes.router)
    app.dependency_overrides[require_user] = lambda: AuthedUser(uid=uid, email="a@b.com")

    return TestClient(app)


def test_list_strategies_scoped_to_user(monkeypatch):
    fake_conn = FakeConn(list(STRATEGIES))
    client = _build_client(fake_conn, monkeypatch, uid="uid-1")

    resp = client.get("/api/user/strategies")

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["strategies"], list)
    assert len(data["strategies"]) == 1
    assert data["strategies"][0]["user_id"] == "uid-1"
    assert data["strategies"][0]["id"] == "11111111-1111-1111-1111-111111111111"
    assert all(row["user_id"] == "uid-1" for row in data["strategies"])

    # ensure_profile ran before the scoped select, using the authenticated uid.
    assert fake_conn.calls[0][1] == ("uid-1", "a@b.com")
