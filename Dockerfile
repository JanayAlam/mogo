# Runner image for isolated local runs:
#   docker build -t mogo . && docker run --rm --env-file .env mogo --pr <url> --dry-run
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git nodejs npm && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/pyproject.toml .
RUN mkdir mogo && touch mogo/__init__.py && pip install --no-cache-dir -e .
COPY backend/ .
COPY repos.yaml /app/repos.yaml
COPY seeds/ /app/seeds/
ENTRYPOINT ["python", "-m", "mogo.runner"]
