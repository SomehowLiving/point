FROM python:3.12-slim

# tesseract-ocr: default OCR engine (found on PATH, no TESSERACT_CMD needed on Linux)
# libgl1 + libglib2.0-0: runtime libraries required by opencv-contrib-python
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-paddle.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# PaddleOCR only ships Linux wheels (see the note in requirements.txt). Opt in with:
#   docker compose build --build-arg INSTALL_PADDLE=true backend
ARG INSTALL_PADDLE=false
RUN if [ "$INSTALL_PADDLE" = "true" ]; then \
        pip install --no-cache-dir -r requirements-paddle.txt; \
    fi

COPY . .

EXPOSE 8001
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8001"]
