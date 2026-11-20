FROM python:3.11-slim

# System deps: ffmpeg (libass), fonts for crisp bold captions, build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    fonts-liberation \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Allow HF_TOKEN to be passed as a build arg for weight pre-fetching
ARG HF_TOKEN=""
ENV HF_TOKEN=${HF_TOKEN}

# Install CPU-only PyTorch first (smaller)
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu \
    torch==2.3.1 torchaudio==2.3.1

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY . .

# Pre-fetch weights at build time so cold starts are fast (skips gracefully if
# HF_TOKEN is not available during the build).
RUN python scripts/download_weights.py

# Create dirs
RUN mkdir -p /app/weights /app/temp_audio

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]