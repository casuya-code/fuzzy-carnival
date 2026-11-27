from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

EngineType = Literal["kyutai", "afrispeech", "msingi", "mms", "azure", "elevenlabs", "cartesia"]
LanguageType = Literal["en", "sw"]


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(..., min_length=1, max_length=2000)
    language: LanguageType = "en"
    engine: EngineType = "kyutai"
    voice_r2_key: Optional[str] = Field(None, min_length=1, max_length=512)
    topic: Optional[str] = Field(None, max_length=120)
    skip_cache: bool = False  # force a fresh generation (new take/variation)
    # None -> fall back to the DENOISE_REFERENCE environment default
    denoise_ref: Optional[bool] = None
    # Delivery pace: <1.0 = slower/more deliberate, >1.0 = faster.
    # Applied by engines that support it (MMS, Azure); others return a warning.
    speaking_rate: Optional[float] = Field(None, ge=0.6, le=1.6)

    @field_validator("text")
    @classmethod
    def _text_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text must not be blank")
        return v

    @field_validator("voice_r2_key", "topic")
    @classmethod
    def _optional_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


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
    ready: bool = True
    loaded_models: list[str] = []
    # Non-secret runtime capabilities so the UI can explain which engines are ready.
    engines: list[str] = []
    capabilities: dict[str, bool] = {}
    worker: dict = {}
    issues: list[str] = []