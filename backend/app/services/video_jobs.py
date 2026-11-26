"""Process-local registry for background video renders."""

from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


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
        self._slots = threading.BoundedSemaphore(limit)
        self.max_concurrent = limit

    def acquire_slot(self) -> bool:
        return self._slots.acquire(blocking=False)

    def release_slot(self) -> None:
        try:
            self._slots.release()
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
            job.status = status
            job.result = result
            job.error = error
            job.error_status = error_status
            job.progress = 100.0 if status == "succeeded" else job.progress
            job.updated_at = time.time()
        self.release_slot()

    def cancel(self, job: VideoJob) -> bool:
        with self._lock:
            if job.status in ("succeeded", "failed", "cancelled"):
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
