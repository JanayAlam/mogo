from __future__ import annotations

import json
import logging
from contextvars import ContextVar

import sentry_sdk

_run_id: ContextVar[str] = ContextVar("run_id", default="-")


def set_run_context(run_id: str) -> None:
    _run_id.set(run_id)
    sentry_sdk.set_tag("run_id", run_id)


class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.run_id = _run_id.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "run_id": getattr(record, "run_id", "-"),
            "msg": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def setup_logging(level: str = "INFO", sentry_dsn: str = "", environment: str = "") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(_ContextFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    logging.getLogger("httpx").setLevel(logging.WARNING)

    if sentry_dsn:
        # The default LoggingIntegration turns ERROR logs into Sentry events
        # and keeps INFO logs as breadcrumbs.
        sentry_sdk.init(dsn=sentry_dsn, environment=environment or None, send_default_pii=False)
