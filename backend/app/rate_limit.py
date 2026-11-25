"""Minimal in-memory rate limiting for abuse control.

This is process-local and best-effort; use a shared limiter (Redis, gateway)
for multi-worker deployments.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.config import _env_int


RATE_LIMIT_PER_MINUTE = _env_int("RATE_LIMIT_PER_MINUTE", 120, min_value=1)
RATE_LIMIT_BURST = _env_int("RATE_LIMIT_BURST", 30, min_value=1)

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Trust X-Forwarded-For only as a best-effort key; for production behind a
    # trusted proxy, configure a proper forwarded-header middleware.
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request) -> None:
    now = time.monotonic()
    window = 60.0
    ip = _client_ip(request)
    key = f"{ip}:{request.url.path}"
    with _lock:
        q = _hits[key]
        cutoff = now - window
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please retry later.")
        # small burst guard over 10 seconds
        recent = sum(1 for t in q if t >= now - 10.0)
        if recent >= RATE_LIMIT_BURST:
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
        q.append(now)
        # opportunistic cleanup
        if len(_hits) > 5000:
            stale = [k for k, dq in _hits.items() if not dq or dq[-1] < cutoff]
            for k in stale:
                _hits.pop(k, None)
