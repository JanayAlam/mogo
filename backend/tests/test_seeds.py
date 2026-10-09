"""antrotrip-server runs against a shared development database, so mogo must never write its schema or fixtures.
The seed file is kept for sandbox databases and checked for internal consistency."""
import re
from pathlib import Path

from mogo.config import load_repos
from mogo.runner.pipeline import SEEDS_DIR

SEED = SEEDS_DIR / "antrotrip-server" / "seed.ts"
REPOS = Path(__file__).resolve().parents[2] / "repos.yaml"


def test_the_shared_development_database_is_never_migrated_or_seeded():
    cfg = load_repos(REPOS)["antrotrip/antrotrip-server"]
    for cmd in cfg.prepare:
        assert not any(w in cmd for w in ("migrate", "seed", "bootstrap", "db push", "reset")), cmd


def test_claims_reference_defined_listings_and_cover_every_status():
    text = SEED.read_text()
    defined = set(re.findall(r'slug: "(seed-[a-z0-9-]+)"', text))
    claimed = set(re.findall(r'listing: "(seed-[a-z0-9-]+)"', text))
    assert claimed <= defined, claimed - defined
    for status in ("PENDING", "APPROVED", "REJECTED"):
        assert f"status: ClaimStatus.{status}" in text
    for status in ("UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"):
        assert f"BusinessVerificationStatus.{status}" in text
    for status in ("DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"):
        assert f"status: ListingStatus.{status}" in text
