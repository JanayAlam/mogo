"""Pick between a local OpenAI-compatible server and DeepSeek.

Ollama, LM Studio, vLLM and llama.cpp all speak the OpenAI API, and so does DeepSeek,
so one client class covers every backend. Only base_url, key and model differ.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Callable

import httpx
from openai import OpenAI

from mogo.config import Settings

log = logging.getLogger(__name__)


class LLMUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class LLMChoice:
    name: str  # "local" | "deepseek"
    base_url: str
    api_key: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.name}:{self.model}"


def probe_local(base_url: str, timeout: float = 2.0) -> bool:
    try:
        r = httpx.get(base_url.rstrip("/") + "/models", timeout=timeout)
        return r.status_code < 500
    except httpx.HTTPError:
        return False


def _local(s: Settings) -> LLMChoice:
    return LLMChoice("local", s.local_llm_base_url, "local", s.local_llm_model)


def _deepseek(s: Settings) -> LLMChoice:
    return LLMChoice("deepseek", s.deepseek_base_url, s.deepseek_api_key, s.deepseek_model)


def resolve_llm(
    s: Settings, mode: str | None = None, probe: Callable[[str], bool] = probe_local
) -> LLMChoice:
    mode = (mode or s.llm_mode or "auto").lower()
    local_configured = bool(s.local_llm_base_url and s.local_llm_model)

    if mode == "local":
        if not local_configured:
            raise LLMUnavailable("LOCAL_LLM_BASE_URL / LOCAL_LLM_MODEL are not set")
        if not probe(s.local_llm_base_url):
            raise LLMUnavailable(f"local LLM not reachable at {s.local_llm_base_url}")
        return _local(s)

    if mode == "deepseek":
        if not s.deepseek_api_key:
            raise LLMUnavailable("DEEPSEEK_API_KEY is not set")
        return _deepseek(s)

    if mode != "auto":
        raise LLMUnavailable(f"unknown llm mode '{mode}'")

    if local_configured and probe(s.local_llm_base_url):
        return _local(s)
    if local_configured:
        log.warning("local LLM not reachable at %s, falling back to DeepSeek", s.local_llm_base_url)
    if not s.deepseek_api_key:
        raise LLMUnavailable("local LLM unreachable and DEEPSEEK_API_KEY is not set")
    return _deepseek(s)


def make_client(choice: LLMChoice) -> OpenAI:
    return OpenAI(base_url=choice.base_url, api_key=choice.api_key, timeout=180.0, max_retries=2)
