"""Rate limiting for abuse control.

Uses Redis when REDIS_URL is configured; falls back to process-local memory.
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
REDIS_URL = os.getenv("REDIS_URL", "").strip()

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)
_redis = None
_redis_init = False


def _get_redis():
    global _redis, _redis_init
    if _redis_init:
        return _redis
    _redis_init = True
    if not REDIS_URL:
        return None
    try:
        import redis  # type: ignore

        _redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        _redis.ping()
    except Exception:
        _redis = None
    return _redis


def _client_ip(request: Request) -> str:
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
    window = 60.0
    with _lock:
        q = _hits[key]
        cutoff = now - window
        while q and q[0] < cutoff:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MINUTE:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please retry later.")
        recent = sum(1 for t in q if t >= now - 10.0)
        if recent >= RATE_LIMIT_BURST:
            raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")
        q.append(now)
        if len(_hits) > 5000:
            stale = [k for k, dq in _hits.items() if not dq or dq[-1] < cutoff]
            for k in stale:
                _hits.pop(k, None)


def rate_limit(request: Request) -> None:
    ip = _client_ip(request)
    key = f"{ip}:{request.url.path}"
    r = _get_redis()
    if r is not None:
        try:
            _rate_limit_redis(r, key)
            return
        except HTTPException:
            raise
        except Exception:
            # Fall back to memory if redis is unavailable.
            pass
    _rate_limit_memory(key)
