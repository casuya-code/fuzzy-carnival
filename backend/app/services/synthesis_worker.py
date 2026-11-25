"""Isolated synthesis worker process.

Runs heavy synthesis in a separate process so a cancelled/stuck request can be
terminated without taking down the main API server. The worker keeps a warm
ModelManager for reuse; if it is killed, the next request restarts it (cold).
"""

from __future__ import annotations

import logging
import multiprocessing as mp
import os
import queue
import time
import traceback
import uuid
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class SynthesisJobResult:
    ok: bool
    value: Any = None
    error_type: str | None = None
    error_message: str | None = None
    error_status: int | None = None
    traceback: str | None = None


def _worker_loop(job_q: mp.Queue, result_q: mp.Queue) -> None:
    # Imported inside worker process.
    from app.routers.synthesize import _synthesize_sync, get_manager  # local import for spawn
    from app.schemas.tts import SynthesizeRequest

    # Warm default local engines in background so worker is ready after (re)start.
    try:
        get_manager().warm_async()
    except Exception:
        pass

    while True:
        job = job_q.get()
        if job is None:
            return
        job_id, req_dict = job
        try:
            req = SynthesizeRequest.model_validate(req_dict)
            # No cancel_event inside worker; cancellation is handled by terminating process.
            res = _synthesize_sync(req, request=None, cancel_event=None)
            payload = res.model_dump() if hasattr(res, "model_dump") else res.dict()
            result_q.put((job_id, SynthesisJobResult(ok=True, value=payload)))
        except Exception as e:
            status = getattr(e, "status_code", None)
            detail = getattr(e, "detail", None)
            msg = detail if isinstance(detail, str) else str(e)
            result_q.put(
                (
                    job_id,
                    SynthesisJobResult(
                        ok=False,
                        error_type=e.__class__.__name__,
                        error_message=msg,
                        error_status=status if isinstance(status, int) else None,
                        traceback=traceback.format_exc(),
                    ),
                )
            )


class SynthesisWorker:
    def __init__(self) -> None:
        self._ctx = mp.get_context("spawn")
        self._job_q: mp.Queue | None = None
        self._result_q: mp.Queue | None = None
        self._proc: mp.Process | None = None
        self._lock = mp.Lock() if False else None  # not used; main router lock serializes
        self._start_lock = __import__("threading").Lock()

    def _ensure_started(self) -> None:
        with self._start_lock:
            if self._proc is not None and self._proc.is_alive():
                return
            self._stop_locked()
            self._ensure_started_unlocked()

    def _stop_locked(self) -> None:
        proc = self._proc
        self._proc = None
        job_q = self._job_q
        result_q = self._result_q
        self._job_q = None
        self._result_q = None
        if proc is not None:
            try:
                if proc.is_alive():
                    proc.terminate()
                    proc.join(timeout=2)
                if proc.is_alive():
                    try:
                        os.kill(proc.pid, 9)
                    except Exception:
                        pass
                    proc.join(timeout=2)
            except Exception as e:
                logger.warning("Failed stopping synthesis worker: %s", e)
        for q in (job_q, result_q):
            if q is not None:
                try:
                    q.close()
                    q.join_thread()
                except Exception:
                    pass

    def stop(self) -> None:
        with self._start_lock:
            self._stop_locked()

    def restart(self) -> None:
        with self._start_lock:
            logger.warning("Restarting synthesis worker")
            self._stop_locked()
            # Respawn immediately so warmup begins before the next request arrives.
            self._ensure_started_unlocked()

    def _ensure_started_unlocked(self) -> None:
        if self._proc is not None and self._proc.is_alive():
            return
        self._job_q = self._ctx.Queue()
        self._result_q = self._ctx.Queue()
        self._proc = self._ctx.Process(target=_worker_loop, args=(self._job_q, self._result_q), daemon=True)
        self._proc.start()
        logger.info("Synthesis worker started pid=%s", self._proc.pid)

    def is_alive(self) -> bool:
        p = self._proc
        return bool(p is not None and p.is_alive())

    def submit(
        self,
        req_dict: dict[str, Any],
        *,
        cancel_event=None,
        poll_interval: float = 0.5,
        timeout_sec: float = 900.0,
    ) -> SynthesisJobResult:
        self._ensure_started()
        assert self._job_q is not None and self._result_q is not None and self._proc is not None
        job_id = uuid.uuid4().hex
        deadline = time.monotonic() + max(1.0, float(timeout_sec))
        try:
            self._job_q.put((job_id, req_dict), timeout=5)
        except Exception as e:
            self.restart()
            return SynthesisJobResult(ok=False, error_type="WorkerError", error_message=f"Failed to submit synthesis job: {e}")

        while True:
            if cancel_event is not None and cancel_event.is_set():
                self.restart()
                return SynthesisJobResult(ok=False, error_type="Cancelled", error_message="Speech creation cancelled")
            if time.monotonic() >= deadline:
                self.restart()
                return SynthesisJobResult(
                    ok=False,
                    error_type="Timeout",
                    error_message="Synthesis timed out; the worker was restarted",
                    error_status=504,
                )
            if self._proc is None or not self._proc.is_alive():
                self.restart()
                return SynthesisJobResult(ok=False, error_type="WorkerDied", error_message="Synthesis worker stopped unexpectedly; restarted a fresh worker")
            try:
                got_id, result = self._result_q.get(timeout=poll_interval)
            except queue.Empty:
                continue
            except Exception as e:
                self.restart()
                return SynthesisJobResult(ok=False, error_type="WorkerError", error_message=f"Synthesis worker communication failed: {e}")
            if got_id != job_id:
                # stale/unknown result; ignore
                continue
            return result


_worker: SynthesisWorker | None = None
_worker_lock = __import__("threading").Lock()


def get_synthesis_worker() -> SynthesisWorker:
    global _worker
    with _worker_lock:
        if _worker is None:
            _worker = SynthesisWorker()
        return _worker