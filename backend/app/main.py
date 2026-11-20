from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import CORS_ALLOW_ORIGINS, CORS_ORIGIN_REGEX, TEMP_AUDIO_DIR
from app.routers import captions, packaging, storage, synthesize, text, video
from app.schemas.tts import HealthResponse


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Warm default engines in the background so the first request is fast."""
    try:
        from app.routers.synthesize import get_manager

        get_manager().warm_async()
    except Exception:
        pass
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

# Serve locally generated files when R2 is not configured (dev fallback).
# Directory is created once in app.config.
app.mount("/static", StaticFiles(directory=str(TEMP_AUDIO_DIR)), name="static")


@app.get("/health", response_model=HealthResponse)
def health():
    loaded: list[str] = []
    try:
        loaded = synthesize.get_manager().loaded_models()
    except Exception:
        pass
    return HealthResponse(status="ok", awake=True, loaded_models=loaded)


@app.get("/")
def root():
    return {"service": "bilingual-voice-clone", "status": "ok"}
