"""
providers/apollo.py — FlowSeer Contact Verifier
Apollo.io adapter — Layer 10 (priority contacts only).
Only called for ACTIVE_RFQ, TIER1, BLOCKED priority levels.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List

import requests

from models import EvidenceItem, APOLLO_ALLOWED_PRIORITIES
from providers.common import REQUEST_TIMEOUT, SLEEP_BETWEEN_CALLS, now_iso, safe_get

log = logging.getLogger(__name__)

APOLLO_API_KEY = os.getenv("APOLLO_API_KEY", "")


def apollo_available() -> bool:
    return bool(APOLLO_API_KEY)


def apollo_allowed_for_priority(priority: str) -> bool:
    """Hard gate — Apollo only fires for approved priority levels."""
    return priority.upper() in APOLLO_ALLOWED_PRIORITIES


def apollo_people_search(
    session: requests.Session,
    first: str,
    last: str,
    company: str,
    full_name: str,
    domain: str,
    evidence_url: str = "",
) -> List[EvidenceItem]:
    """
    Search Apollo for a contact. Returns EvidenceItem list.
    Raises on error — ProviderGuard handles retry/disable.
    Never call without confirming apollo_allowed_for_priority() first.
    """
    if not apollo_available():
        return []

    r = session.post(
        "https://api.apollo.io/api/v1/people/search",
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": APOLLO_API_KEY,
        },
        json={"q_keywords": f"{first} {last} {company}", "page": 1, "per_page": 3},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    time.sleep(SLEEP_BETWEEN_CALLS)
    people = r.json().get("people", [])

    if not people:
        return []

    person = people[0]
    email  = (person.get("email") or "").strip()

    return [EvidenceItem(
        provider="APOLLO_FALLBACK",
        evidence_url=evidence_url or f"https://app.apollo.io/#/people",
        page_title=f"Apollo — {full_name} @ {company}",
        snippet=(
            f"Apollo result: {person.get('name', full_name)} | "
            f"Title: {person.get('title', '')} | "
            f"Company: {person.get('organization_name', company)}"
        )[:300],
        matched_name=full_name,
        matched_company=company,
        matched_domain=domain,
        matched_email=email,
        match_type="apollo_verified" if email else "apollo_no_email",
        timestamp=now_iso(),
    )]
