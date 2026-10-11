"""The antrotrip-server seed file is kept for sandbox databases and checked for internal consistency.
(antrotrip-server itself runs against the shared development database: its repo settings never migrate or seed.)"""
import re

from mogo.runner.pipeline import SEEDS_DIR

SEED = SEEDS_DIR / "antrotrip-server" / "seed.ts"


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
