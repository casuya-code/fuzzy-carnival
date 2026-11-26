import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
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
from app.routers import auth, captions, packaging, storage, synthesize, text, timeline, video
from app.schemas.tts import HealthResponse

logger = logging.getLogger(__name__)


def _cleanup_temp_audio() -> None:
    # Best-effort cleanup of stale scratch dirs/files; keep refs_cache managed separately.
    import shutil
    import time
    from pathlib import Path

    now = time.time()
    max_age = 24 * 3600
    for child in Path(TEMP_AUDIO_DIR).iterdir():
        try:
            if child.name == "refs_cache":
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
    try:
        from app.routers.synthesize import get_manager

        get_manager().warm_async()
    except Exception as e:
        logger.warning("Engine warmup could not be started: %s", e, exc_info=True)
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
app.include_router(synthesize.router)
app.include_router(storage.router)
app.include_router(text.router)
app.include_router(video.router)
app.include_router(captions.router)
app.include_router(packaging.router)
app.include_router(timeline.router)

# Serve locally generated files when R2 is not configured (dev fallback).
# Directory is created once in app.config.
if SERVE_STATIC:
    app.mount("/static", StaticFiles(directory=str(TEMP_AUDIO_DIR)), name="static")


@app.get("/health", response_model=HealthResponse)
def health():
    loaded: list[str] = []
    issues: list[str] = []
    warmup: dict[str, dict[str, str]] = {}
    ready = True
    try:
        manager = synthesize.get_manager()
        loaded = manager.loaded_models()
        warmup = manager.warmup_status()
        for name, info in warmup.items():
            status = info.get("status")
            if status == "failed":
                ready = False
                # Do not leak internal exception details by default.
                logger.warning("Warmup failed for %s: %s", name, info.get("error", "failed"))
                issues.append(f"warmup:{name}:failed")
            elif status in {"warming", "pending"}:
                pass
    except Exception as e:
        ready = False
        logger.warning("Health check failed: %s", e, exc_info=True)
        issues.append("health:unavailable")

    engine_flags = {
        "kyutai": ENABLE_KYUTAI,
        "afrispeech": ENABLE_AFRISPEECH,
        "msingi": ENABLE_MSINGI,
        "mms": ENABLE_MMS,
        "azure": ENABLE_AZURE,
        "elevenlabs": ENABLE_ELEVENLABS,
    }
    worker_alive = False
    try:
        from app.services.synthesis_worker import get_synthesis_worker

        worker_alive = bool(get_synthesis_worker().is_alive())
    except Exception:
        worker_alive = False

    capabilities = {
        "azure_configured": bool(AZURE_SPEECH_KEY),
        "elevenlabs_configured": bool(ELEVENLABS_API_KEY),
        "elevenlabs_cloning": bool(ELEVENLABS_API_KEY and ELEVENLABS_ENABLE_CLONING),
        "synthesis_busy": bool(synthesize.is_synthesis_busy()),
        "worker_alive": worker_alive,
    }
    engines = [name for name in ENGINE_NAMES if engine_flags.get(name, False)]

    if not EXPOSE_HEALTH_DETAILS:
        # Minimal liveness-oriented response for public exposure.
        return HealthResponse(
            status="ok" if ready else "degraded",
            awake=True,
            ready=ready,
            loaded_models=[],
            engines=[],
            capabilities={},
            issues=[],
        )

    return HealthResponse(
        status="ok" if ready else "degraded",
        awake=True,
        ready=ready,
        loaded_models=loaded,
        engines=engines,
        capabilities=capabilities,
        issues=issues,
    )


@app.get("/")
def root():
    return {"service": "bilingual-voice-clone", "status": "ok"}
