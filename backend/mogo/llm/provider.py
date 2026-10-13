"""The run's LLMs: the project owner's own OpenAI-compatible APIs (OpenAI, Claude, DeepSeek, OpenRouter, a local Ollama
or LM Studio behind a tunnel, ...), tried in the order the owner set. One client class covers every backend; only
base_url, key and model differ."""
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
    max_retries: int = 2  # per-request retries inside the client; kept low when there is a fallback to move to

    @property
    def label(self) -> str:
        return f"{self.model} @ {urlparse(self.base_url).hostname or self.base_url}"


@dataclass(frozen=True)
class Connection:
    """One switched-on llm_connections row. The key is ciphertext until resolve_chain."""
    base_url: str
    model: str
    api_key_enc: str | None


@dataclass(frozen=True)
class OwnerLLM:
    """The project owner and their switched-on connections, first choice first (empty when none is on)."""
    user_id: str
    login: str
    connections: tuple[Connection, ...] = ()


def user_aad(user_id: str) -> str:
    """The "repo id" half of the additional data for a user's encrypted columns: "user:<id>:<column>"."""
    return f"user:{user_id}"


def resolve_chain(owner: OwnerLLM | None, secret_key: str) -> tuple[list[LLMChoice], list[str]]:
    """The connections to try, in order, and a note for each one that had to be skipped (key cannot be read).
    Raises LLMUnavailable when nothing is left to try."""
    if owner is None:
        raise LLMUnavailable("the project has no owner")
    if not owner.connections:
        raise LLMUnavailable(f"{owner.login} has no LLM switched on (Settings > LLM connections in the web app)")
    retries = 1 if len(owner.connections) > 1 else 2
    chain: list[LLMChoice] = []
    skipped: list[str] = []
    for c in owner.connections:
        api_key = ""
        if c.api_key_enc:
            try:
                api_key = decrypt(load_key(secret_key), user_aad(owner.user_id), "llm_api_key", c.api_key_enc)
            except SecretError as e:
                label = LLMChoice(c.base_url, "", c.model).label
                skipped.append(f"{label}: the API key cannot be read ({e}); enter it again in Settings > LLM connections")
                continue
        chain.append(LLMChoice(c.base_url, api_key, c.model, retries))
    if not chain:
        raise LLMUnavailable("; ".join(skipped))
    return chain, skipped


def make_client(choice: LLMChoice) -> OpenAI:
    # Local servers need no key, but the client refuses an empty one.
    return OpenAI(base_url=choice.base_url, api_key=choice.api_key or "none", timeout=180.0, max_retries=choice.max_retries)
