"""
providers/hunter.py — FlowSeer Contact Verifier
Hunter.io adapter — Layer 9 (50 credits/month free).
Handles email finding and verification separately.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

import requests

from models import EvidenceItem
from providers.common import REQUEST_TIMEOUT, SLEEP_BETWEEN_CALLS, now_iso, safe_get

log = logging.getLogger(__name__)

HUNTER_API_KEY = os.getenv("HUNTER_API_KEY", "")

# Hunter verification status values considered valid
HUNTER_VALID_STATUSES = {"valid", "accept_all"}


def hunter_available() -> bool:
    return bool(HUNTER_API_KEY)


def hunter_find_email(
    session: requests.Session,
    first: str,
    last: str,
    domain: str,
) -> Optional[str]:
    """
    Attempt to find an email via Hunter Email Finder.
    Returns email string or None.
    Raises on network/API error — caller handles via ProviderGuard.
    """
    if not hunter_available() or not domain:
        return None

    r = session.get(
        "https://api.hunter.io/v2/email-finder",
        params={"domain": domain, "first_name": first, "last_name": last, "api_key": HUNTER_API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    time.sleep(SLEEP_BETWEEN_CALLS)
    data = r.json().get("data") or {}
    return data.get("email") or None


def hunter_verify_email(
    session: requests.Session,
    email: str,
) -> Optional[str]:
    """
    Verify a specific email via Hunter Email Verifier.
    Returns status string ('valid', 'risky', 'undeliverable', etc.) or None.
    Raises on network/API error — caller handles via ProviderGuard.
    """
    if not hunter_available() or not email:
        return None

    r = session.get(
        "https://api.hunter.io/v2/email-verifier",
        params={"email": email, "api_key": HUNTER_API_KEY},
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    time.sleep(SLEEP_BETWEEN_CALLS)
    data = r.json().get("data") or {}
    return data.get("status") or None


def hunter_find_and_verify(
    session: requests.Session,
    first: str,
    last: str,
    domain: str,
    full_name: str,
    company: str,
    evidence_url: str = "",
) -> List[EvidenceItem]:
    """
    Combined find + verify flow. Returns EvidenceItem list.
    Empty list if Hunter finds nothing or is not configured.
    Raises on error — ProviderGuard handles retry/disable.
    """
    found_email = hunter_find_email(session, first, last, domain)
    if not found_email:
        return []

    verify_status = hunter_verify_email(session, found_email)
    is_valid  = verify_status in HUNTER_VALID_STATUSES
    match_type = "hunter_verified" if is_valid else "hunter_found_unverified"

    return [EvidenceItem(
        provider="HUNTER_FINDER+VERIFY",
        evidence_url=evidence_url,
        page_title=f"Hunter — {full_name} @ {domain}",
        snippet=f"Email: {found_email} | Verify status: {verify_status or 'not checked'}",
        matched_name=full_name,
        matched_company=company,
        matched_domain=domain,
        matched_email=found_email,
        match_type=match_type,
        timestamp=now_iso(),
    )]


def hunter_verify_existing(
    session: requests.Session,
    email: str,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
    """
    Verify a pre-existing email address. Returns EvidenceItem list.
    """
    if not hunter_available() or not email:
        return []

    status = hunter_verify_email(session, email)
    if not status:
        return []

    is_valid   = status in HUNTER_VALID_STATUSES
    match_type = "existing_email_verified" if is_valid else "existing_email_failed_verify"

    return [EvidenceItem(
        provider="HUNTER_VERIFY",
        evidence_url="",
        page_title=f"Hunter verify — {email}",
        snippet=f"Existing email status: {status}",
        matched_name=full_name,
        matched_company=company,
        matched_email=email,
        match_type=match_type,
        timestamp=now_iso(),
    )]


def hunter_verify_pattern(
    session: requests.Session,
    email: str,
    full_name: str,
    company: str,
    domain: str,
) -> List[EvidenceItem]:
    """
    Verify a pattern-inferred email. Returns EvidenceItem list.
    """
    if not hunter_available() or not email:
        return []

    status     = hunter_verify_email(session, email)
    is_valid   = status in HUNTER_VALID_STATUSES
    match_type = "hunter_pattern_verified" if is_valid else "hunter_pattern_failed"

    return [EvidenceItem(
        provider="HUNTER_PATTERN_VERIFY",
        evidence_url="",
        page_title=f"Hunter pattern verify — {email}",
        snippet=f"Pattern email {email} — status: {status}",
        matched_name=full_name,
        matched_company=company,
        matched_domain=domain,
        matched_email=email if is_valid else "",
        match_type=match_type,
        timestamp=now_iso(),
    )]
