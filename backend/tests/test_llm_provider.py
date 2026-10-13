import base64

import pytest

from mogo.llm.provider import Connection, LLMUnavailable, OwnerLLM, make_client, resolve_chain, user_aad
from mogo.secrets import encrypt

KEY_B64 = base64.b64encode(b"k" * 32).decode()


def conn(**kw):
    return Connection(**{"base_url": "https://api.openai.com/v1", "model": "gpt-4.1", "api_key_enc": None, **kw})


def owner(*connections, user_id="u1"):
    return OwnerLLM(user_id=user_id, login="alice", connections=tuple(connections))


def test_decrypts_the_owners_key():
    enc = encrypt(b"k" * 32, user_aad("u1"), "llm_api_key", "sk-secret")
    chain, skipped = resolve_chain(owner(conn(api_key_enc=enc)), KEY_B64)
    (c,) = chain
    assert (c.base_url, c.model, c.api_key, c.label) == ("https://api.openai.com/v1", "gpt-4.1", "sk-secret",
                                                         "gpt-4.1 @ api.openai.com")
    assert skipped == []


def test_keeps_the_owners_order():
    chain, _ = resolve_chain(owner(conn(model="a"), conn(model="b"), conn(model="c")), "")
    assert [c.model for c in chain] == ["a", "b", "c"]


def test_a_chain_retries_less_inside_each_client():
    one, _ = resolve_chain(owner(conn()), "")
    many, _ = resolve_chain(owner(conn(), conn()), "")
    assert (one[0].max_retries, many[0].max_retries) == (2, 1)
    assert make_client(many[0]).max_retries == 1


def test_a_key_of_another_user_is_skipped_not_fatal():
    bad = encrypt(b"k" * 32, user_aad("u2"), "llm_api_key", "sk-other")
    chain, skipped = resolve_chain(owner(conn(model="a", api_key_enc=bad), conn(model="b")), KEY_B64)
    assert [c.model for c in chain] == ["b"]
    assert len(skipped) == 1 and "enter it again" in skipped[0] and skipped[0].startswith("a @ api.openai.com")


def test_nothing_left_to_try_is_an_error():
    bad = encrypt(b"k" * 32, user_aad("u2"), "llm_api_key", "sk-other")
    with pytest.raises(LLMUnavailable, match="enter it again"):
        resolve_chain(owner(conn(api_key_enc=bad)), KEY_B64)


def test_no_key_is_fine_for_local_servers():
    (c,), _ = resolve_chain(owner(conn(base_url="https://ollama.example.ts.net/v1")), "")
    assert c.api_key == "" and make_client(c).api_key == "none"


@pytest.mark.parametrize("o", [None, owner()])
def test_not_set_up(o):
    with pytest.raises(LLMUnavailable):
        resolve_chain(o, KEY_B64)
