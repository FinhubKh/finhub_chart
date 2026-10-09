from app.db import database_url


def test_database_url_reads_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@/db?host=/cloudsql/x")
    assert database_url() == "postgresql://u:p@/db?host=/cloudsql/x"


def test_database_url_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert database_url() is None
