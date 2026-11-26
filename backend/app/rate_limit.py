"""Rate limiting for abuse control.

Uses Redis when REDIS_URL is configured; process-local memory is used only when
Redis was never selected. Client-supplied forwarding headers are ignored unless
TRUST_X_FORWARDED_FOR=true, and buckets are keyed by route template + method so
a caller cannot mint a fresh bucket by varying the raw path.
"""

from __future__ import annotations

import os
import threading
import time
from collections import OrderedDict, deque
from typing import Any

from fastapi import HTTPException, Request

from app.config import _env_bool, _env_int

RATE_LIMIT_PER_MINUTE = _env_int("RATE_LIMIT_PER_MINUTE", 120, min_value=1, max_value=100_000)
RATE_LIMIT_BURST = _env_int("RATE_LIMIT_BURST", 30, min_value=1, max_value=100_000)
REDIS_URL = os.getenv("REDIS_URL", "").strip()
# C1: only a trusted reverse proxy may supply the client IP.
_TRUST_XFF = _env_bool("TRUST_X_FORWARDED_FOR", False)

_REDIS_RETRY_COOLDOWN_SEC = 30.0
_MAX_HITS_KEYS = 10_000

_lock = threading.Lock()
_hits: OrderedDict[str, deque[float]] = OrderedDict()
_redis: Any = None
_redis_fail_until = 0.0


def _get_redis():
    """Return a live client or raise; retry only after the cooldown (H3)."""
    global _redis, _redis_fail_until
    now = time.monotonic()

    if _redis is not None:
        if now < _redis_fail_until:
            raise RuntimeError("Redis is in retry cooldown")
        return _redis
    if now < _redis_fail_until:
        raise RuntimeError("Redis is in retry cooldown")

    try:
        import redis  # type: ignore

        client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        client.ping()
    except Exception:
        _redis = None
        _redis_fail_until = now + _REDIS_RETRY_COOLDOWN_SEC
        raise
    _redis = client
    _redis_fail_until = 0.0
    return client


def _client_ip(request: Request) -> str:
    if _TRUST_XFF:
        fwd = request.headers.get("x-forwarded-for", "")
        if fwd:
            return fwd.split(",")[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _rate_limit_redis(r, key: str) -> None:
    now = int(time.time())
    minute_key = f"rl:m:{key}:{now // 60}"
    burst_key = f"rl:b:{key}:{now // 10}"
    pipe = r.pipeline()
    pipe.incr(minute_key, 1)
    pipe.expire(minute_key, 120)
    pipe.incr(burst_key, 1)
    pipe.expire(burst_key, 30)
    res = pipe.execute()
    minute_count = int(res[0] or 0)
    burst_count = int(res[2] or 0)
    if minute_count > RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Please retry later.")
    if burst_count > RATE_LIMIT_BURST:
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")


def _rate_limit_memory(key: str) -> None:
    now = time.monotonic()
    cutoff = now - 60.0
    with _lock:
        q = _hits.get(key)
        if q is None:
            # M4: bound the LRU so an attacker cannot grow _hits without limit.
            if len(_hits) >= _MAX_HITS_KEYS:
                _hits.popitem(last=False)
            q = _hits[key] = deque()
        else:
            _hits.move_to_end(key)

        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please retry later.")
        recent = sum(1 for t in q if t >= now - 10.0)
        if recent >= RATE_LIMIT_BURST:
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
        q.append(now)


def rate_limit(request: Request) -> None:
    global _redis_fail_until
    ip = _client_ip(request)
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    key = f"{ip}:{request.method}:{path}"

    if REDIS_URL:
        # M3: Redis was explicitly selected, so a mid-request failure must not
        # silently downgrade to local memory and double-count the hit.
        try:
            r = _get_redis()
            _rate_limit_redis(r, key)
        except HTTPException:
            raise
        except Exception:
            _redis_fail_until = time.monotonic() + _REDIS_RETRY_COOLDOWN_SEC
            raise HTTPException(status_code=503, detail="Rate limiter temporarily unavailable")
        return

    _rate_limit_memory(key)
