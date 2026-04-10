"""
suppression.py — FlowSeer Contact Verifier
Identity normalization, dedupe, and suppression logic.
Keeps repeated runs quiet and efficient.
"""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Dict, Optional, Set, Tuple

from models import (
    STATUS_VERIFIED,
    SUPP_ALREADY_VERIFIED,
    SUPP_BAD_EMAIL,
    SUPP_BOUNCED_EMAIL,
    SUPP_DO_NOT_CONTACT,
    SUPP_DUPLICATE_IN_RUN,
    SUPP_INSUFFICIENT_ID,
)


# ── Identity normalization ─────────────────────────────────────────────────────

def normalize_name(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip().lower())


def normalize_domain(raw: str) -> str:
    d = raw.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = re.sub(r"^www\.", "", d)
    return d.split("/")[0]


def normalize_email(email: str) -> str:
    return email.strip().lower()


def contact_identity_key(contact: Dict[str, str]) -> str:
    """
    Canonical deduplication key for a contact.
    Combines normalized name + company + domain.
    """
    full   = contact.get("full_name", "") or \
             f"{contact.get('first_name', '')} {contact.get('last_name', '')}".strip()
    company = contact.get("company", "")
    domain  = normalize_domain(contact.get("company_domain", ""))
    return f"{normalize_name(full)}|{normalize_name(company)}|{domain}"


# ── In-run dedupe ─────────────────────────────────────────────────────────────

class RunDeduplicator:
    """Tracks contacts processed in the current run to suppress repeats."""

    def __init__(self) -> None:
        self._seen: Set[str] = set()

    def check_and_register(self, contact: Dict[str, str]) -> Optional[str]:
        """
        Returns suppression reason string if duplicate, else None.
        Registers the contact as seen if not duplicate.
        """
        key = contact_identity_key(contact)
        if key in self._seen:
            return SUPP_DUPLICATE_IN_RUN
        self._seen.add(key)
        return None


# ── Cross-run already-verified index ─────────────────────────────────────────

class VerifiedIndex:
    """
    Persisted index of already-verified contacts.
    Loaded from a prior contacts_verified.csv output.
    Prevents re-processing contacts that are already at VERIFIED_EMAIL.
    """

    def __init__(self, prior_output_path: Optional[str] = None) -> None:
        self._index: Set[str] = set()
        if prior_output_path and Path(prior_output_path).exists():
            self._load(prior_output_path)

    def _load(self, path: str) -> None:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                status = row.get("verification_status", "")
                if status == STATUS_VERIFIED:
                    key = contact_identity_key(row)
                    self._index.add(key)

    def is_already_verified(self, contact: Dict[str, str]) -> bool:
        return contact_identity_key(contact) in self._index


# ── Bad-email suppression ─────────────────────────────────────────────────────

BAD_EMAIL_MARKERS = {
    "bounced", "invalid", "undeliverable", "bad", "do_not_contact",
    "do-not-contact", "dnc", "opt_out", "optout"
}


class BadEmailList:
    """
    Tracks emails that have previously bounced, been marked invalid,
    or been flagged do-not-contact.
    Can be loaded from a JSON file: {"email@domain.com": "bounced"}.
    """

    def __init__(self, bad_email_file: Optional[str] = None) -> None:
        self._bad: Dict[str, str] = {}
        if bad_email_file and Path(bad_email_file).exists():
            with open(bad_email_file, "r", encoding="utf-8") as f:
                self._bad = json.load(f)

    def check(self, email: str) -> Optional[str]:
        """Returns suppression reason or None."""
        if not email:
            return None
        key = normalize_email(email)
        reason_raw = self._bad.get(key, "").lower()
        if not reason_raw:
            return None
        if "bounce" in reason_raw:
            return SUPP_BOUNCED_EMAIL
        if "do_not" in reason_raw or "dnc" in reason_raw or "optout" in reason_raw:
            return SUPP_DO_NOT_CONTACT
        return SUPP_BAD_EMAIL


# ── Identity sufficiency check ────────────────────────────────────────────────

def has_sufficient_identity(contact: Dict[str, str]) -> Tuple[bool, str]:
    """
    Returns (sufficient, suppression_reason).
    A contact must have at minimum a name and either a company or domain.
    """
    full = contact.get("full_name", "") or \
           f"{contact.get('first_name', '')} {contact.get('last_name', '')}".strip()
    company = contact.get("company", "").strip()
    domain  = normalize_domain(contact.get("company_domain", ""))

    if not full or len(full) < 3:
        return False, SUPP_INSUFFICIENT_ID
    if not company and not domain:
        return False, SUPP_INSUFFICIENT_ID
    return True, ""


# ── Suppression orchestrator ─────────────────────────────────────────────────

class SuppressionLayer:
    """
    Applies all suppression checks in order.
    Returns (suppressed: bool, reason: str).
    """

    def __init__(
        self,
        prior_output_path: Optional[str] = None,
        bad_email_file: Optional[str] = None,
    ) -> None:
        self._run_dedup   = RunDeduplicator()
        self._verified_idx = VerifiedIndex(prior_output_path)
        self._bad_emails  = BadEmailList(bad_email_file)

    def check(self, contact: Dict[str, str]) -> Tuple[bool, str]:
        """
        Returns (suppressed, reason).
        If suppressed, caller should skip verification and record the reason.
        """
        # 1. Identity sufficiency
        ok, reason = has_sufficient_identity(contact)
        if not ok:
            return True, reason

        # 2. Bad existing email
        existing_email = contact.get("email", "")
        if existing_email:
            bad_reason = self._bad_emails.check(existing_email)
            if bad_reason:
                return True, bad_reason

        # 3. Already verified in prior run
        if self._verified_idx.is_already_verified(contact):
            return True, SUPP_ALREADY_VERIFIED

        # 4. In-run duplicate
        dup_reason = self._run_dedup.check_and_register(contact)
        if dup_reason:
            return True, dup_reason

        return False, ""
