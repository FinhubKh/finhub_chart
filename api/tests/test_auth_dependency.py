from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth_firebase import require_user, AuthedUser


def test_missing_bearer_returns_401(monkeypatch):
    app = FastAPI()

    @app.get("/x")
    def x(user: AuthedUser = __import__("fastapi").Depends(require_user)):
        return {"uid": user.uid}

    client = TestClient(app)
    assert client.get("/x").status_code == 401


def test_valid_token_injects_user(monkeypatch):
    from app import auth_firebase

    def fake_verify(token: str):
        assert token == "good"
        return AuthedUser(uid="uid-1", email="a@b.com")

    monkeypatch.setattr(auth_firebase, "verify_id_token", fake_verify)

    app = FastAPI()

    @app.get("/x")
    def x(user: AuthedUser = __import__("fastapi").Depends(require_user)):
        return {"uid": user.uid, "email": user.email}

    client = TestClient(app)
    r = client.get("/x", headers={"Authorization": "Bearer good"})
    assert r.status_code == 200
    assert r.json() == {"uid": "uid-1", "email": "a@b.com"}
