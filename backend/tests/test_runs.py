import pytest

from mogo.models import Run
from mogo.runs import create_run


def test_create_run_inserts_queued_row(sf, repos):
    rid = create_run(sf, "https://github.com/Acme/API/pull/9", "feat", True)
    with sf() as s:
        r = s.get(Run, rid)
        assert (r.repo, r.pr_number, r.status, r.dry_run) == ("Acme/API", 9, "queued", True)


@pytest.mark.parametrize("url", ["https://github.com/other/x/pull/1", "not a url"])
def test_create_run_rejects_bad_input(sf, repos, url):
    with pytest.raises(ValueError):
        create_run(sf, url)
