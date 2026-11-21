# syntax=docker/dockerfile:1
FROM python:3.11-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install CPU-only PyTorch first (smaller)
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.3.1 torchaudio==2.3.1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app and prefetch weights. Use a BuildKit secret instead of ARG/ENV to avoid
# persisting HF_TOKEN in image metadata/layers: docker build --secret id=hf_token,src=...
COPY . .
RUN --mount=type=secret,id=hf_token \
    sh -c 'export HF_TOKEN="$(cat /run/secrets/hf_token 2>/dev/null || true)"; python scripts/download_weights.py'

FROM python:3.11-slim AS runtime

# Runtime deps only (no compilers/git in final image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

WORKDIR /app
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /app /app

RUN mkdir -p /app/weights /app/temp_audio && chown -R appuser:appuser /app

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]