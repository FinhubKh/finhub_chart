from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool: ConnectionPool | None = None


def database_url() -> str | None:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    return raw or None


def init_pool() -> ConnectionPool | None:
    global _pool
    url = database_url()
    if not url:
        _pool = None
        return None
    if _pool is None:
        _pool = ConnectionPool(url, min_size=1, max_size=5, kwargs={"row_factory": dict_row})
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connect() -> Iterator:
    pool = init_pool()
    if pool is None:
        raise RuntimeError("DATABASE_URL is not configured")
    with pool.connection() as conn:
        yield conn
