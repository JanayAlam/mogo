"""The run's LLM: the project owner's own OpenAI-compatible API (OpenAI, DeepSeek, OpenRouter, a local Ollama or
LM Studio behind a tunnel, ...). One client class covers every backend; only base_url, key and model differ."""
from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

from openai import OpenAI

from mogo.secrets import SecretError, decrypt, load_key


class LLMUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class LLMChoice:
    base_url: str
    api_key: str
    model: str

    @property
    def label(self) -> str:
        return f"{self.model} @ {urlparse(self.base_url).hostname or self.base_url}"


@dataclass(frozen=True)
class OwnerLLM:
    """What users.llm_* hold for one user. The key is ciphertext until resolve_llm."""
    user_id: str
    login: str
    base_url: str
    model: str
    api_key_enc: str | None


def user_aad(user_id: str) -> str:
    """The "repo id" half of the additional data for a user's encrypted columns: "user:<id>:<column>"."""
    return f"user:{user_id}"


def resolve_llm(owner: OwnerLLM | None, secret_key: str) -> LLMChoice:
    if owner is None:
        raise LLMUnavailable("the project has no owner")
    if not owner.base_url or not owner.model:
        raise LLMUnavailable(f"{owner.login} has not set up an LLM yet (Settings > LLM in the web app)")
    api_key = ""
    if owner.api_key_enc:
        try:
            api_key = decrypt(load_key(secret_key), user_aad(owner.user_id), "llm_api_key", owner.api_key_enc)
        except SecretError as e:
            raise LLMUnavailable(f"the LLM API key cannot be read ({e}); enter it again in Settings > LLM") from e
    return LLMChoice(owner.base_url, api_key, owner.model)


def make_client(choice: LLMChoice) -> OpenAI:
    # Local servers need no key, but the client refuses an empty one.
    return OpenAI(base_url=choice.base_url, api_key=choice.api_key or "none", timeout=180.0, max_retries=2)
