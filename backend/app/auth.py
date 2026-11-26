"""Simple API-key auth for expensive/mutating endpoints.

If API_KEY/API_KEYS are configured, requests must provide one via:
  - Authorization: Bearer <key>
  - X-API-Key: <key>

A valid HMAC-signed user access token (Bearer <jwt>) is accepted as well.

If REQUIRE_AUTH=true and no key is configured, requests are rejected as
misconfigured to avoid accidentally exposing unprotected endpoints. With
REQUIRE_AUTH=false, requests are allowed through when no keys are configured.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException, Request

from app.config import API_KEY, REQUIRE_AUTH
from app.services.user_store import verify_access_token


def _load_configured_keys() -> list[str]:
    """Read configured keys once at import (M1)."""
    keys: list[str] = []
    if API_KEY:
        keys.append(API_KEY)
    extra = os.getenv("API_KEYS", "").strip()
    if extra:
        keys.extend([k.strip() for k in extra.split(",") if k.strip()])
    # dedupe, preserve order
    seen: set[str] = set()
    out: list[str] = []
    for k in keys:
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


_CONFIGURED_KEYS = _load_configured_keys()


def _configured_keys() -> list[str]:
    """Return the import-time key set (kept as a seam for tests)."""
    return list(_CONFIGURED_KEYS)


def _eq(a: str, b: str) -> bool:
    """Constant-time comparison that also accepts non-ASCII values (M63)."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    keys = _configured_keys()

    provided_api = x_api_key.strip() if x_api_key else None
    provided_bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        provided_bearer = authorization[7:].strip()

    if not keys:
        # H1: when no API keys are configured, a valid user token still
        # authenticates the caller; REQUIRE_AUTH only rejects anonymous access.
        if provided_bearer and verify_access_token(provided_bearer):
            return
        if REQUIRE_AUTH:
            raise HTTPException(status_code=401, detail="Authentication required")
        return

    # H2: check every credential channel instead of letting a stale X-API-Key
    # short-circuit a valid Bearer token.
    if provided_api and any(_eq(provided_api, key) for key in keys):
        return
    if provided_bearer and any(_eq(provided_bearer, key) for key in keys):
        return
    if provided_bearer and verify_access_token(provided_bearer):
        return
    raise HTTPException(status_code=401, detail="Invalid or expired credentials")


def get_current_user(request: Request) -> dict[str, Any]:
    """Require a valid logged-in user (JWT). Used for per-user content."""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        user = verify_access_token(auth[7:].strip())
        if user:
            return user
    raise HTTPException(status_code=401, detail="Authentication required")


def require_user(request: Request) -> dict[str, Any]:
    return get_current_user(request)
