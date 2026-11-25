import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import ELEVENLABS_API_KEY, TEMP_AUDIO_DIR
from app.services.audio_processor import get_duration
from app.services.r2_storage import download_reference
from app.services.timeline_service import (
    estimate_timeline,
    segments_from_forced_alignment_words,
)
from app.auth import require_api_key
from app.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1", tags=["timeline"], dependencies=[Depends(require_api_key), Depends(rate_limit)])
logger = logging.getLogger(__name__)


class TimelineRequest(BaseModel):
    audio_r2_key: str
    text: str
    prefer_alignment: bool = True


class TimelineResponse(BaseModel):
    timeline: list[dict]
    timeline_source: str  # alignment | estimated | unavailable
    duration_seconds: Optional[float] = None
    warning: Optional[str] = None


@router.post("/timeline", response_model=TimelineResponse)
def build_timeline(req: TimelineRequest):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    work_dir = TEMP_AUDIO_DIR / "timeline" / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_path: Path | None = None
    warning: str | None = None

    try:
        suffix = Path(req.audio_r2_key).suffix or ".audio"
        audio_path = work_dir / f"audio{suffix}"
        download_reference(req.audio_r2_key, dest=audio_path)

        duration = get_duration(str(audio_path))

        # Try ElevenLabs forced alignment first when configured (best-effort fallback chain).
        if req.prefer_alignment and ELEVENLABS_API_KEY:
            try:
                from elevenlabs.client import ElevenLabs

                client = ElevenLabs(api_key=ELEVENLABS_API_KEY)
                with open(audio_path, "rb") as f:
                    resp = client.forced_alignment.create(file=f, text=text)
                words = getattr(resp, "words", None) or []
                segments = segments_from_forced_alignment_words(words)
                if segments:
                    return TimelineResponse(
                        timeline=segments,
                        timeline_source="alignment",
                        duration_seconds=duration,
                        warning=None,
                    )
                warning = "Alignment did not produce usable timestamps. Used estimated timeline instead."
            except Exception as e:
                logger.warning("ElevenLabs forced alignment failed: %s", e, exc_info=True)
                warning = "Alignment unavailable. Used estimated timeline instead."

        # Fallback: heuristic timeline from script + audio duration (works without external services).
        segments = estimate_timeline(text, duration)
        if segments:
            return TimelineResponse(
                timeline=segments,
                timeline_source="estimated",
                duration_seconds=duration,
                warning=warning,
            )

        return TimelineResponse(
            timeline=[],
            timeline_source="unavailable",
            duration_seconds=duration,
            warning=(warning or "Could not generate timeline for this audio."),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Timeline generation failed: {e}")
    finally:
        try:
            if audio_path and audio_path.exists():
                audio_path.unlink(missing_ok=True)
            if work_dir.exists():
                # remove dir if empty
                try:
                    work_dir.rmdir()
                except Exception as e:
                    logger.debug("Could not remove timeline work dir %s: %s", work_dir, e)
        except Exception as e:
            logger.warning("Timeline cleanup failed for %s: %s", work_dir, e)
