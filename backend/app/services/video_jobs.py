"""Process-local registry for background video renders."""

from __future__ import annotations

import contextvars
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


# Ownership is bound by the router before acquiring a render slot. Keeping it
# in a contextvar preserves the zero-argument acquire_slot() call used by
# existing callers/tests while letting the store use per-owner semaphores.
_CURRENT_OWNER: contextvars.ContextVar[str] = contextvars.ContextVar(
    "video_job_owner", default="@anonymous"
)

TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})


def bind_job_owner(owner: str):
    return _CURRENT_OWNER.set(owner or "@anonymous")


def clear_job_owner(token) -> None:
    _CURRENT_OWNER.reset(token)


@dataclass
class VideoJob:
    id: str
    kind: str
    owner: str
    cancel_event: threading.Event = field(default_factory=threading.Event)
    status: str = "queued"
    progress: float = 0.0
    stage: str = "queued"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    result: dict[str, Any] | None = None
    error: str | None = None
    error_status: int | None = None
    finished: bool = False

    def snapshot(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "job_id": self.id,
            "kind": self.kind,
            "status": self.status,
            "progress": round(self.progress, 1),
            "stage": self.stage,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if self.result is not None:
            out["result"] = self.result
        if self.error is not None:
            out["error"] = self.error
        if self.error_status is not None:
            out["error_status"] = self.error_status
        return out


class VideoJobStore:
    """Thread-safe job registry with a bounded number of concurrent renders."""

    def __init__(self) -> None:
        self._jobs: dict[str, VideoJob] = {}
        self._lock = threading.RLock()
        limit = max(1, int(os.getenv("VIDEO_JOB_MAX_CONCURRENT", "2")))
        self._slots: dict[str, threading.BoundedSemaphore] = {}
        self._slots_lock = threading.Lock()
        self.max_concurrent = limit

    def _slot_for(self, owner: str) -> threading.BoundedSemaphore:
        with self._slots_lock:
            slot = self._slots.get(owner)
            if slot is None:
                slot = threading.BoundedSemaphore(self.max_concurrent)
                self._slots[owner] = slot
            return slot

    def acquire_slot(self, owner: str | None = None) -> bool:
        owner = owner or _CURRENT_OWNER.get()
        return self._slot_for(owner).acquire(blocking=False)

    def release_slot(self, owner: str | None = None) -> None:
        owner = owner or _CURRENT_OWNER.get()
        try:
            self._slot_for(owner).release()
        except ValueError:
            pass

    def create(self, kind: str, owner: str) -> VideoJob:
        self._purge()
        job = VideoJob(id=uuid.uuid4().hex, kind=kind, owner=owner)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str, owner: str | None = None) -> VideoJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if owner is not None and job.owner != owner:
                return None
            return job

    def update(self, job: VideoJob, *, status: str | None = None, progress: float | None = None, stage: str | None = None) -> None:
        with self._lock:
            # A terminal status is authoritative: a late progress report from a
            # cancelled render must never resurrect it as "running".
            if job.finished or job.status in TERMINAL_STATUSES:
                return
            if status is not None:
                job.status = status
            if progress is not None:
                job.progress = max(job.progress, progress)
            if stage is not None:
                job.stage = stage
            job.updated_at = time.time()

    def finish(
        self,
        job: VideoJob,
        *,
        status: str,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        error_status: int | None = None,
    ) -> None:
        with self._lock:
            if job.finished:
                # The first finish already published the result and released the slot.
                return
            job.finished = True
            # Cancellation wins even if the render thread finished a split second
            # after the client cancelled (or finish() was called with "succeeded").
            effective = "cancelled" if job.cancel_event.is_set() else status
            job.status = effective
            job.result = result if effective == "succeeded" else None
            job.error = error
            job.error_status = error_status
            job.progress = 100.0 if effective == "succeeded" else job.progress
            job.updated_at = time.time()
        self.release_slot(job.owner)

    def cancel(self, job: VideoJob) -> bool:
        with self._lock:
            if job.finished or job.status in TERMINAL_STATUSES:
                return False
            job.cancel_event.set()
            job.status = "cancelled"
            job.stage = "cancelled"
            job.updated_at = time.time()
            return True

    def _purge(self, ttl_sec: float = 3600) -> None:
        cutoff = time.time() - ttl_sec
        with self._lock:
            stale = [j.id for j in self._jobs.values() if j.updated_at < cutoff and j.status in ("succeeded", "failed", "cancelled")]
            for job_id in stale:
                self._jobs.pop(job_id, None)


_store: VideoJobStore | None = None
_store_lock = threading.Lock()


def get_video_job_store() -> VideoJobStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = VideoJobStore()
        return _store
