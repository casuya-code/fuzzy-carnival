from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from app.config import ENGINE_NAMES
from app.services.model_manager import CLOUD_ENGINES
from app.services.text_normalizer import normalize_text
from app.auth import require_api_key
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
    return {"normalized": normalize_text(req.text, lang)}


@router.post("/warm")
def warm(req: WarmRequest):
    """Pre-load an engine so the next synthesis is fast. Cloud engines are no-op (0 RAM)."""
    if req.engine not in ENGINE_NAMES:
        return {"warmed": False, "error": "unknown engine"}
    if req.engine in CLOUD_ENGINES:
        return {"warmed": True, "engine": req.engine, "cloud": True}
    try:
        from app.routers.synthesize import get_manager
        get_manager().get(req.engine)
        return {"warmed": True, "engine": req.engine}
    except Exception as e:
        return {"warmed": False, "engine": req.engine, "error": str(e)}