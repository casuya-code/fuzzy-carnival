"""Tiny stdlib-only timing metrics.

Records duration samples in memory (bounded) and emits structured log lines.
No external dependency, so CI's minimal environment stays sufficient.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("app.observability")

_MAX_SAMPLES = 500
_lock = threading.Lock()
_samples: dict[str, deque[dict[str, Any]]] = {}


def record(event: str, duration_ms: float, **fields: Any) -> None:
    """Store one sample and log it. Fields are caller-controlled: never pass PII."""
    duration = round(float(duration_ms), 2)
    sample = {"duration_ms": duration, "ts": round(time.time(), 3)}
    sample.update({k: v for k, v in fields.items() if v is not None})
    with _lock:
        _samples.setdefault(event, deque(maxlen=_MAX_SAMPLES)).append(sample)
    extras = " ".join(f"{k}={v}" for k, v in sample.items() if k not in ("duration_ms", "ts"))
    logger.info("metric event=%s duration_ms=%.2f %s", event, duration, extras)


@contextmanager
def timed(event: str, **fields: Any) -> Iterator[dict[str, Any]]:
    """Time a block; yields a mutable dict so callers can set `status`."""
    start = time.perf_counter()
    state: dict[str, Any] = {"status": "ok"}
    try:
        yield state
    except Exception as exc:
        record(
            event,
            (time.perf_counter() - start) * 1000,
            status="error",
            error_type=type(exc).__name__,
            **fields,
        )
        raise
    else:
        record(event, (time.perf_counter() - start) * 1000, status=state["status"], **fields)


def summary() -> dict[str, dict[str, Any]]:
    """Aggregate recent samples for GET /api/v1/metrics."""
    with _lock:
        out: dict[str, dict[str, Any]] = {}
        for event, samples in _samples.items():
            values = [s["duration_ms"] for s in samples]
            if not values:
                continue
            out[event] = {
                "count": len(values),
                "avg_ms": round(sum(values) / len(values), 2),
                "max_ms": round(max(values), 2),
                "last_ms": round(values[-1], 2),
                "last_at": samples[-1]["ts"],
            }
        return out


def reset() -> None:
    """Mainly for tests."""
    with _lock:
        _samples.clear()
