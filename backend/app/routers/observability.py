from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.auth import require_api_key
from app.observability import record, summary

router = APIRouter(prefix="/api/v1", tags=["observability"], dependencies=[Depends(require_api_key)])


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
    safe = {k: v for k, v in sample.fields.items() if k in {"kind", "stage", "status", "engine", "language", "engine_used", "cache_hit", "ok"}}
    record(sample.event, sample.duration_ms, **safe)
    return {"ok": True}
