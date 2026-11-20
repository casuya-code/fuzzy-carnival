from fastapi import APIRouter
from pydantic import BaseModel, Field
from app.config import ENGINE_NAMES
from app.services.text_normalizer import normalize_text

router = APIRouter(prefix="/api/v1", tags=["text"])


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
    """Pre-load an engine so the next synthesis is fast."""
    if req.engine not in ENGINE_NAMES:
        return {"warmed": False, "error": "unknown engine"}
    try:
        from app.routers.synthesize import get_manager
        get_manager().get(req.engine)
        return {"warmed": True, "engine": req.engine}
    except Exception as e:
        return {"warmed": False, "engine": req.engine, "error": str(e)}