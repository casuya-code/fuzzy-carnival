from pydantic import BaseModel, Field
from typing import Optional, Literal

EngineType = Literal["kyutai", "afrispeech", "msingi", "mms"]
LanguageType = Literal["en", "sw"]


class SynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    language: LanguageType = "en"
    engine: EngineType = "kyutai"
    voice_r2_key: Optional[str] = None
    topic: Optional[str] = None
    skip_cache: bool = False  # force a fresh generation (new take/variation)
    # None -> fall back to the DENOISE_REFERENCE environment default
    denoise_ref: Optional[bool] = None


class SynthesizeResponse(BaseModel):
    audio_r2_key: str
    audio_url: str
    engine_used: str
    duration_seconds: Optional[float] = None


class HealthResponse(BaseModel):
    status: str
    awake: bool = True
    loaded_models: list[str] = []