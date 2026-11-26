"""Simple API-key auth for expensive/mutating endpoints.

If API_KEY is configured, requests must provide it via:
  - Authorization: Bearer <key>
  - X-API-Key: <key>

If REQUIRE_AUTH=true and no key is configured, requests are rejected as
misconfigured to avoid accidentally exposing unprotected endpoints.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException

from app.config import API_KEY, REQUIRE_AUTH
from app.services.user_store import verify_access_token


def _configured_keys() -> list[str]:
    keys = []
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


def require_api_key(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    keys = _configured_keys()
    provided_api = x_api_key.strip() if x_api_key else None
    provided_bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        provided_bearer = authorization[7:].strip()

    # API key takes precedence when present.
    if provided_api:
        for key in keys:
            if hmac.compare_digest(provided_api, key):
                return
        # Also allow a user token passed via X-API-Key by mistake? No, be strict.
        raise HTTPException(status_code=401, detail="Invalid API key")

    if provided_bearer:
        for key in keys:
            if hmac.compare_digest(provided_bearer, key):
                return
        if verify_access_token(provided_bearer):
            return
        if keys or REQUIRE_AUTH:
            raise HTTPException(status_code=401, detail="Invalid or expired credentials")
        return

    if keys or REQUIRE_AUTH:
        raise HTTPException(status_code=401, detail="Authentication required")
    return
