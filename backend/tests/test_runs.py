import pytest

from mogo.models import Run
from mogo.runs import create_run


def test_create_run_inserts_queued_row(sf, repos):
    rid = create_run(sf, "https://github.com/Acme/API/pull/9", "feat", "local", True)
    with sf() as s:
        r = s.get(Run, rid)
        assert (r.repo, r.pr_number, r.status, r.llm_mode, r.dry_run) == ("Acme/API", 9, "queued", "local", True)


@pytest.mark.parametrize("url,mode", [
    ("https://github.com/other/x/pull/1", "auto"),
    ("not a url", "auto"),
    ("https://github.com/acme/api/pull/1", "gpt"),
])
def test_create_run_rejects_bad_input(sf, repos, url, mode):
    with pytest.raises(ValueError):
        create_run(sf, url, llm_mode=mode)
