"""Cooperative cancellation and progress plumbing for background jobs.

A contextvar carries the active job into the render helpers. Synchronous callers
have no context, so their behavior (including plain ``subprocess.run``) is
unchanged.
"""

from __future__ import annotations

import contextvars
import subprocess
import threading
from dataclasses import dataclass
from typing import Any, Callable

from app.observability import record


class JobCancelled(Exception):
    """Raised at a job checkpoint when the client cancelled the render."""


@dataclass
class JobContext:
    cancel_event: threading.Event
    progress: Callable[[str, float], None]
    last_report: dict[str, Any] | None = None


_job_context: contextvars.ContextVar[JobContext | None] = contextvars.ContextVar(
    "video_job_context", default=None
)


def set_job_context(ctx: JobContext):
    return _job_context.set(ctx)


def reset_job_context(token) -> None:
    _job_context.reset(token)


def get_job_context() -> JobContext | None:
    return _job_context.get()


def check_cancelled() -> None:
    ctx = _job_context.get()
    if ctx is not None and ctx.cancel_event.is_set():
        raise JobCancelled()


def report_progress(stage: str, pct: float) -> None:
    ctx = _job_context.get()
    if ctx is None:
        return
    now = __import__("time").perf_counter()
    if ctx.last_report is not None:
        record(
            "video.stage",
            (now - ctx.last_report["t"]) * 1000,
            stage=ctx.last_report["stage"],
            kind=ctx.last_report.get("kind"),
        )
    ctx.last_report = {"t": now, "stage": stage, "kind": ctx.last_report.get("kind") if ctx.last_report else None}
    ctx.progress(stage, min(100.0, max(0.0, float(pct))))


def run_ffmpeg(
    cmd: list[str], *, check: bool = True, cwd: str | None = None
) -> subprocess.CompletedProcess:
    """Run FFmpeg, allowing cooperative cancellation for background jobs."""
    ctx = _job_context.get()
    if ctx is None:
        return subprocess.run(
            cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=check
        )
    check_cancelled()
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    while True:
        try:
            out, err = proc.communicate(timeout=0.25)
            break
        except subprocess.TimeoutExpired:
            if ctx.cancel_event.is_set():
                proc.terminate()
                try:
                    out, err = proc.communicate(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    out, err = proc.communicate()
                raise JobCancelled()
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd, output=out, stderr=err)
    return subprocess.CompletedProcess(cmd, proc.returncode, out, err)
