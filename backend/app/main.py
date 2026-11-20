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
    TEMP_AUDIO_DIR,
)
from app.routers import captions, packaging, storage, synthesize, text, timeline, video
from app.schemas.tts import HealthResponse

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Warm default engines in the background so the first request is fast."""
    try:
        from app.routers.synthesize import get_manager

        get_manager().warm_async()
    except Exception as e:
        logger.warning("Engine warmup could not be started: %s", e, exc_info=True)
    yield


app = FastAPI(title="Bilingual Voice Clone API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(synthesize.router)
app.include_router(storage.router)
app.include_router(text.router)
app.include_router(video.router)
app.include_router(captions.router)
app.include_router(packaging.router)
app.include_router(timeline.router)

# Serve locally generated files when R2 is not configured (dev fallback).
# Directory is created once in app.config.
app.mount("/static", StaticFiles(directory=str(TEMP_AUDIO_DIR)), name="static")


@app.get("/health", response_model=HealthResponse)
def health():
    loaded: list[str] = []
    try:
        loaded = synthesize.get_manager().loaded_models()
    except Exception as e:
        logger.warning("Health check could not list loaded models: %s", e, exc_info=True)

    engine_flags = {
        "kyutai": ENABLE_KYUTAI,
        "afrispeech": ENABLE_AFRISPEECH,
        "msingi": ENABLE_MSINGI,
        "mms": ENABLE_MMS,
        "azure": ENABLE_AZURE,
        "elevenlabs": ENABLE_ELEVENLABS,
    }
    return HealthResponse(
        status="ok",
        awake=True,
        loaded_models=loaded,
        engines=[name for name in ENGINE_NAMES if engine_flags.get(name, False)],
        capabilities={
            "azure_configured": bool(AZURE_SPEECH_KEY),
            "elevenlabs_configured": bool(ELEVENLABS_API_KEY),
            "elevenlabs_cloning": bool(ELEVENLABS_API_KEY and ELEVENLABS_ENABLE_CLONING),
        },
    )


@app.get("/")
def root():
    return {"service": "bilingual-voice-clone", "status": "ok"}
