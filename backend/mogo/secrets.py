"""Repo secrets: AES-256-GCM with MOGO_SECRET_KEY. Same format as web/src/lib/secrets.ts, which encrypts them.

Token: "v1:" + base64(iv[12] + ciphertext + tag[16]). The additional data "<repo_id>:<name>" binds a value to its row,
so a ciphertext copied onto another repo or name does not decrypt.
"""
from __future__ import annotations

import base64
import binascii
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PREFIX = "v1:"


class SecretError(ValueError):
    pass


def load_key(raw: str) -> bytes:
    try:
        key = base64.b64decode(raw.strip(), validate=True)
    except (binascii.Error, ValueError) as e:
        raise SecretError("MOGO_SECRET_KEY must be base64 (create one with: openssl rand -base64 32)") from e
    if len(key) != 32:
        raise SecretError("MOGO_SECRET_KEY must decode to 32 bytes (openssl rand -base64 32)")
    return key


def _aad(repo_id: str, name: str) -> bytes:
    return f"{repo_id}:{name}".encode()


def encrypt(key: bytes, repo_id: str, name: str, value: str, iv: bytes | None = None) -> str:
    iv = iv or os.urandom(12)
    return PREFIX + base64.b64encode(iv + AESGCM(key).encrypt(iv, value.encode(), _aad(repo_id, name))).decode()


def decrypt(key: bytes, repo_id: str, name: str, token: str) -> str:
    if not token.startswith(PREFIX):
        raise SecretError(f"{name}: unknown secret format")
    try:
        raw = base64.b64decode(token[len(PREFIX):], validate=True)
        return AESGCM(key).decrypt(raw[:12], raw[12:], _aad(repo_id, name)).decode()
    except (InvalidTag, binascii.Error, ValueError) as e:
        raise SecretError(f"{name}: cannot decrypt (MOGO_SECRET_KEY changed, or the value was altered)") from e


def decrypt_all(raw_key: str, repo_id: str, tokens: dict[str, str]) -> tuple[dict[str, str], list[str]]:
    """Returns (name -> value, problems). Problems are messages without values; a bad secret is left out."""
    if not tokens:
        return {}, []
    if not raw_key:
        return {}, [f"MOGO_SECRET_KEY is not set: {len(tokens)} stored secret(s) unavailable ({', '.join(sorted(tokens))})"]
    try:
        key = load_key(raw_key)
    except SecretError as e:
        return {}, [str(e)]
    values, problems = {}, []
    for name, token in tokens.items():
        try:
            values[name] = decrypt(key, repo_id, name, token)
        except SecretError as e:
            problems.append(str(e))
    return values, problems


class Redactor:
    """Masks secret values in text that leaves the sandbox (run log, stored result, GitHub review)."""

    MIN_LEN = 4  # shorter values ("1", "on") would mask ordinary words

    def __init__(self, values=()):
        self.values = sorted({v for v in values if len(v) >= self.MIN_LEN}, key=len, reverse=True)

    def __call__(self, text: str) -> str:
        for v in self.values:
            text = text.replace(v, "***")
        return text

    def deep(self, obj):
        if isinstance(obj, str):
            return self(obj)
        if isinstance(obj, list):
            return [self.deep(x) for x in obj]
        if isinstance(obj, dict):
            return {k: self.deep(v) for k, v in obj.items()}
        return obj
