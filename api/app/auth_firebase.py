from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)
_firebase_ready = False


@dataclass(frozen=True)
class AuthedUser:
    uid: str
    email: str | None


def _ensure_firebase() -> None:
    global _firebase_ready
    if _firebase_ready:
        return
    import firebase_admin
    from firebase_admin import credentials

    if not firebase_admin._apps:
        # On Cloud Run / GCP: Application Default Credentials
        # Locally: set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON
        project_id = (os.environ.get("FIREBASE_PROJECT_ID") or "").strip() or None
        firebase_admin.initialize_app(
            credentials.ApplicationDefault(),
            options={"projectId": project_id} if project_id else None,
        )
    _firebase_ready = True


def verify_id_token(token: str) -> AuthedUser:
    _ensure_firebase()
    from firebase_admin import auth as fb_auth

    try:
        decoded = fb_auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from e
    uid = decoded.get("uid") or decoded.get("sub")
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid token claims")
    return AuthedUser(uid=str(uid), email=decoded.get("email"))


def require_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AuthedUser:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return verify_id_token(creds.credentials)
