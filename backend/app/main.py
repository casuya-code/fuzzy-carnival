import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import (
    AZURE_SPEECH_KEY,
    CORS_ALLOW_ORIGINS,
    CORS_ORIGIN_REGEX,
    ELEVENLABS_API_KEY,
    ELEVENLABS_ENABLE_CLONING,
    ENABLE_AFRISPEECH,
    ENABLE_AZURE,
    ENABLE_ELEVENLABS,
    ENABLE_KYUTAI,
    ENABLE_MMS,
    ENABLE_MSINGI,
    ENGINE_NAMES,
    EXPOSE_HEALTH_DETAILS,
    SERVE_STATIC,
    TEMP_AUDIO_DIR,
)
from app.routers import (
    auth,
    captions,
    observability,
    packaging,
    storage,
    synthesize,
    text,
    timeline,
    video,
    video_jobs,
)
from app.schemas.tts import HealthResponse

logger = logging.getLogger(__name__)

# Only generated output folders may be served from local disk; references,
# uploaded inputs and scratch files must never be reachable via /static.
_STATIC_OUTPUT_SUBDIRS = ("outputs", "audio", "video", "thumbs")

_ENGINE_FLAGS = {
    "kyutai": ENABLE_KYUTAI,
    "afrispeech": ENABLE_AFRISPEECH,
    "msingi": ENABLE_MSINGI,
    "mms": ENABLE_MMS,
    "azure": ENABLE_AZURE,
    "elevenlabs": ENABLE_ELEVENLABS,
}


def _enabled_engines() -> list[str]:
    return [name for name in ENGINE_NAMES if _ENGINE_FLAGS.get(name, False)]


def _cleanup_temp_audio() -> None:
    # Best-effort cleanup of stale scratch dirs/files; keep refs_cache managed separately.
    import shutil
    import time
    from pathlib import Path

    now = time.time()
    max_age = 24 * 3600
    for child in Path(TEMP_AUDIO_DIR).iterdir():
        try:
            if child.name in {"audio", "video", "thumbs", "outputs", "refs_cache"}:
                continue
            age = now - child.stat().st_mtime
            if age < max_age:
                continue
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
        except Exception as e:
            logger.debug("Temp cleanup skipped for %s: %s", child, e)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Warm default engines in the background so the first request is fast."""
    try:
        from app.services.user_store import init_db

        init_db()
    except Exception as e:
        logger.warning("User DB init failed: %s", e, exc_info=True)
    try:
        _cleanup_temp_audio()
    except Exception as e:
        logger.warning("Temp audio cleanup failed: %s", e, exc_info=True)
    # Local engine warm-up belongs to the synthesis worker process only; warming
    # here would load duplicate weights in the API process (H17).
    yield
    # Best-effort cleanup: stop synthesis worker so it doesn't linger after shutdown.
    try:
        from app.services.synthesis_worker import get_synthesis_worker

        get_synthesis_worker().stop()
    except Exception as e:
        logger.warning("Synthesis worker shutdown failed: %s", e, exc_info=True)


app = FastAPI(title="Bilingual Voice Clone API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(observability.router)
app.include_router(synthesize.router)
app.include_router(storage.router)
app.include_router(text.router)
app.include_router(video.router)
app.include_router(video_jobs.router)
app.include_router(captions.router)
app.include_router(packaging.router)
app.include_router(timeline.router)

# Serve only generated output subtrees when R2 is not configured (dev fallback).
# Mounting TEMP_AUDIO_DIR itself would expose reference audio, fonts and job inputs.
if SERVE_STATIC:
    for _subdir in _STATIC_OUTPUT_SUBDIRS:
        _directory = TEMP_AUDIO_DIR / _subdir
        _directory.mkdir(parents=True, exist_ok=True)
        app.mount(
            f"/static/{_subdir}",
            StaticFiles(directory=str(_directory)),
            name=f"static-{_subdir}",
        )


def _is_ready() -> bool:
    """Liveness stays in /health; readiness adds lightweight degradation checks."""
    try:
        warmup = synthesize.get_manager().warmup_status()
        if any(info.get("status") == "failed" for info in warmup.values()):
            # Do not log warm-up error strings (may contain internal paths/keys).
            for name, info in warmup.items():
                if info.get("status") == "failed":
                    logger.warning("Warmup failed for engine %s", name)
            return False
    except Exception as e:
        logger.warning("Health check failed: %s", type(e).__name__)
        return False
    try:
        from app.services.synthesis_worker import get_synthesis_worker

        worker = get_synthesis_worker()
        if worker.ever_started and not worker.is_alive():
            return False
    except Exception:
        # A worker that has not been started yet is not a readiness failure.
        pass
    return True


@app.get("/ready")
def ready():
    """Readiness probe for orchestrators; 503 when the instance cannot serve work."""
    if not _is_ready():
        raise HTTPException(status_code=503, detail="Service is not ready")
    return {"status": "ready"}


@app.get("/health", response_model=HealthResponse)
def health():
    ready = _is_ready()

    if not EXPOSE_HEALTH_DETAILS:
        # Minimal liveness-oriented response for public exposure. The enabled
        # engine names are non-sensitive and required by the UI (C8); keep the
        # HealthResponse key shape unchanged.
        return HealthResponse(
            status="ok" if ready else "degraded",
            awake=True,
            ready=ready,
            loaded_models=[],
            engines=_enabled_engines(),
            capabilities={},
            worker={},
            issues=[],
        )

    # Detailed data is only computed when it will actually be returned (M14).
    loaded: list[str] = []
    issues: list[str] = []
    warmup: dict[str, dict[str, str]] = {}
    try:
        loaded = synthesize.get_manager().loaded_models()
        warmup = synthesize.get_manager().warmup_status()
        issues.extend(
            f"warmup:{name}:failed"
            for name, info in warmup.items()
            if info.get("status") == "failed"
        )
    except Exception as e:
        issues.append("health:unavailable")
        logger.warning("Health check failed: %s", type(e).__name__)

    worker_status: dict = {}
    try:
        from app.services.synthesis_worker import get_synthesis_worker

        worker_status = get_synthesis_worker().status()
    except Exception:
        worker_status = {"alive": False}

    capabilities = {
        "azure_configured": bool(AZURE_SPEECH_KEY),
        "elevenlabs_configured": bool(ELEVENLABS_API_KEY),
        "elevenlabs_cloning": bool(ELEVENLABS_API_KEY and ELEVENLABS_ENABLE_CLONING),
        "synthesis_busy": bool(synthesize.is_synthesis_busy()),
        "worker_alive": bool(worker_status.get("alive")),
    }

    return HealthResponse(
        status="ok" if ready else "degraded",
        awake=True,
        ready=ready,
        loaded_models=loaded,
        engines=_enabled_engines(),
        capabilities=capabilities,
        worker=worker_status,
        issues=issues,
    )


@app.get("/")
def root():
    return {"service": "bilingual-voice-clone", "status": "ok"}
