from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.config import ENGINE_NAMES
from app.services.model_manager import CLOUD_ENGINES
from app.services.stage_directions import parse_stage_directions
from app.services.text_normalizer import normalize_text
from app.auth import require_user as require_api_key
from app.rate_limit import rate_limit

router = APIRouter(prefix="/api/v1", tags=["text"], dependencies=[Depends(require_api_key), Depends(rate_limit)])


class NormalizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    language: str = "en"


class WarmRequest(BaseModel):
    engine: str = "kyutai"


@router.post("/normalize")
def normalize(req: NormalizeRequest):
    lang = req.language if req.language in ("en", "sw") else "en"
    # Show exactly what will be spoken: stage directions are performed, not read.
    stage = parse_stage_directions(req.text)
    spoken = " ".join(
        part for seg in stage.segments if (part := normalize_text(seg, lang).strip())
    )
    return {"normalized": spoken}


def _warm_engine_locked(engine: str) -> bool:
    """Serialize warming with synthesis so worker results cannot cross owners."""
    from app.routers.synthesize import _synthesize_lock
    from app.services.synthesis_worker import get_synthesis_worker

    with _synthesize_lock:
        return get_synthesis_worker().warm(engine)


@router.post("/warm")
async def warm(req: WarmRequest):
    """Pre-load an engine so the next synthesis is fast. Cloud engines are no-op (0 RAM).

    Local engines are warmed in the worker process — the process that actually
    performs local synthesis — not just in the API process.
    """
    if req.engine not in ENGINE_NAMES:
        return {"warmed": False, "error": "unknown engine"}
    if req.engine in CLOUD_ENGINES:
        return {"warmed": True, "engine": req.engine, "cloud": True}
    try:
        warmed = await run_in_threadpool(_warm_engine_locked, req.engine)
        return {"warmed": warmed, "engine": req.engine}
    except Exception as e:
        return {"warmed": False, "engine": req.engine, "error": str(e)}