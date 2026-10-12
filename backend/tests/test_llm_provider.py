import base64

import pytest

from mogo.llm.provider import LLMUnavailable, OwnerLLM, make_client, resolve_llm, user_aad
from mogo.secrets import encrypt

KEY_B64 = base64.b64encode(b"k" * 32).decode()


def owner(**kw):
    return OwnerLLM(**{"user_id": "u1", "login": "alice", "base_url": "https://api.openai.com/v1",
                       "model": "gpt-4.1", "api_key_enc": None, **kw})


def test_decrypts_the_owners_key():
    enc = encrypt(b"k" * 32, user_aad("u1"), "llm_api_key", "sk-secret")
    c = resolve_llm(owner(api_key_enc=enc), KEY_B64)
    assert (c.base_url, c.model, c.api_key, c.label) == ("https://api.openai.com/v1", "gpt-4.1", "sk-secret",
                                                         "gpt-4.1 @ api.openai.com")


def test_a_key_of_another_user_does_not_decrypt():
    enc = encrypt(b"k" * 32, user_aad("u2"), "llm_api_key", "sk-other")
    with pytest.raises(LLMUnavailable, match="enter it again"):
        resolve_llm(owner(api_key_enc=enc), KEY_B64)


def test_no_key_is_fine_for_local_servers():
    c = resolve_llm(owner(base_url="https://ollama.example.ts.net/v1"), "")
    assert c.api_key == "" and make_client(c).api_key == "none"


@pytest.mark.parametrize("o", [None, owner(base_url=""), owner(model="")])
def test_not_set_up(o):
    with pytest.raises(LLMUnavailable):
        resolve_llm(o, KEY_B64)
