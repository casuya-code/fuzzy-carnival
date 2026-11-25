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
    if not keys:
        if REQUIRE_AUTH:
            raise HTTPException(status_code=503, detail="API authentication is required but not configured")
        return

    provided = None
    if x_api_key:
        provided = x_api_key.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        provided = authorization[7:].strip()

    if not provided:
        raise HTTPException(status_code=401, detail="Missing API key")

    for key in keys:
        if hmac.compare_digest(provided, key):
            return
    raise HTTPException(status_code=401, detail="Invalid API key")
