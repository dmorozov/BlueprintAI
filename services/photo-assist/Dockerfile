# BlueprintAI photo-assist service — self-hosted MoGe-2 wall suggestion (Phase 2).
#
# Build:   docker build -t blueprintai-photo-assist .
# Run:     docker run --gpus all -p 8734:8734 -v hf-cache:/models \
#            blueprintai-photo-assist
#
# The first request downloads the MoGe-2 checkpoint (~1.3 GB) into HF_HOME (/models);
# mount a volume there so it survives container restarts. Needs an NVIDIA GPU with a
# CUDA 12.x-capable driver; CPU works but is slow (see README).

FROM nvidia/cuda:12.8.0-cudnn-runtime-ubuntu24.04

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /srv/photo-assist

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip3 install --break-system-packages -r requirements.txt \
    && pip3 install --break-system-packages --no-deps \
        git+https://github.com/microsoft/MoGe.git@b942f00bdc2a

COPY app.py moge_engine.py wall_fitting.py ./

EXPOSE 8734

CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8734"]
