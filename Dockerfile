# Runner image for isolated local runs:
#   docker build -t mogo . && docker run --rm --env-file backend/.env mogo --pr <url> --dry-run
#   migrations: docker run --rm --env-file backend/.env --entrypoint python mogo -m mogo.tools.migrate
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends git nodejs npm && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/pyproject.toml .
RUN mkdir mogo && touch mogo/__init__.py && pip install --no-cache-dir -e .
COPY backend/ .
COPY db/ /app/db/
COPY seeds/ /app/seeds/
ENTRYPOINT ["python", "-m", "mogo.runner"]
