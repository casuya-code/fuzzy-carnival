from pydantic import BaseModel, Field
from typing import Any, Optional, Literal

EngineType = Literal["kyutai", "afrispeech", "msingi", "mms", "azure", "elevenlabs"]
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
    # Delivery pace: <1.0 = slower/more deliberate, >1.0 = faster.
    # Applied to VITS-based engines (MMS) via speaking_rate; other engines ignore it.
    speaking_rate: Optional[float] = Field(None, ge=0.6, le=1.6)


class TimelineSegment(BaseModel):
    id: int
    start: float
    end: float
    duration: float
    text: str


class SynthesizeResponse(BaseModel):
    audio_r2_key: str
    audio_url: str
    engine_used: str
    duration_seconds: Optional[float] = None
    warning: Optional[str] = None
    timeline: Optional[list[TimelineSegment]] = None
    timeline_source: Optional[str] = None  # provider | alignment | estimated | unavailable
    source_text: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    awake: bool = True
    loaded_models: list[str] = []