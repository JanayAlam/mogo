import pytest

from mogo.llm.provider import LLMUnavailable, resolve_llm


def test_auto_prefers_local_when_reachable(settings):
    assert resolve_llm(settings, "auto", probe=lambda _u: True).name == "local"


def test_auto_falls_back_to_deepseek_when_local_down(settings):
    c = resolve_llm(settings, "auto", probe=lambda _u: False)
    assert c.name == "deepseek" and c.api_key == "ds-key"


def test_auto_without_local_config_uses_deepseek(settings):
    settings.local_llm_base_url = ""
    assert resolve_llm(settings, "auto", probe=lambda _u: True).name == "deepseek"


def test_forced_local_fails_loudly_when_down(settings):
    with pytest.raises(LLMUnavailable, match="not reachable"):
        resolve_llm(settings, "local", probe=lambda _u: False)


def test_forced_deepseek_needs_key(settings):
    settings.deepseek_api_key = ""
    with pytest.raises(LLMUnavailable):
        resolve_llm(settings, "deepseek")


def test_nothing_available(settings):
    settings.deepseek_api_key = ""
    with pytest.raises(LLMUnavailable):
        resolve_llm(settings, "auto", probe=lambda _u: False)
