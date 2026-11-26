from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_api_key
from app.observability import record, summary
from app.rate_limit import rate_limit

router = APIRouter(
    prefix="/api/v1",
    tags=["observability"],
    dependencies=[Depends(require_api_key), Depends(rate_limit)],
)

_ALLOWED_FIELDS = frozenset(
    {"kind", "stage", "status", "engine", "language", "engine_used", "cache_hit", "ok"}
)
_MAX_FIELD_VALUE_LEN = 128
_MAX_FIELDS = 16


class MetricSample(BaseModel):
    event: str = Field(..., min_length=1, max_length=80)
    duration_ms: float = Field(..., ge=0, le=86_400_000)
    fields: dict[str, str | int | float | bool] = Field(default_factory=dict)


@router.get("/metrics")
def metrics():
    """Recent duration samples for page/render/speech performance checks."""
    return {"metrics": summary()}


@router.post("/metrics")
def ingest_metric(sample: MetricSample):
    """Accept browser-side timings (page load, upload, render, speech)."""
    # H9: bound both the number of fields and each value before recording.
    safe: dict[str, str | int | float | bool] = {}
    for key, value in sample.fields.items():
        if key not in _ALLOWED_FIELDS or len(safe) >= _MAX_FIELDS:
            continue
        safe[key] = value[:_MAX_FIELD_VALUE_LEN] if isinstance(value, str) else value
    record(sample.event, sample.duration_ms, **safe)
    return {"ok": True}
