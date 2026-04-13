"""
scoring.py — FlowSeer Contact Verifier
Confidence scoring from aggregated evidence items.
Deterministic: same inputs always produce same output.
"""
from __future__ import annotations

from typing import List, Tuple

from models import (
    EvidenceItem,
    STATUS_VERIFIED,
    STATUS_LIKELY,
    STATUS_PATTERN,
    STATUS_REVIEW,
)


# Provider trust weights — how much each source contributes to confidence
PROVIDER_TRUST: dict[str, int] = {
    "HUNTER_VERIFY":                40,
    "HUNTER_FINDER+VERIFY":         40,
    "HUNTER_PATTERN_VERIFY":        35,
    "APOLLO_FALLBACK":              40,
    "SEC_EDGAR":                    30,
    "WIKIDATA":                     20,
    "GITHUB":                       15,
    "NEWSAPI":                      15,
    "ORCID":                        20,
    "OPENCORPORATES":               25,
    "GOOGLE":                       20,
    "DOMAIN_MX":                    10,
    "DOMAIN_PATTERN_INFERENCE":      5,
    "HUNTER_FIND":                  25,
}

# If both person AND company are confirmed by a provider, grant a bonus
PERSON_COMPANY_BONUS = 10

# Maximum possible score before capping at 100
SCORE_CAP = 100


def score_evidence(
    items: List[EvidenceItem],
    domain_valid: bool = False,
) -> Tuple[int, str, str]:
    """
    Compute confidence score, status, and label from evidence items.

    Returns:
        (score: int, status: str, ambiguity_reason: str)
    """
    if not items:
        if domain_valid:
            return 20, STATUS_PATTERN, "Domain valid but no evidence"
        return 0, STATUS_REVIEW, "No evidence gathered"

    score = 0
    contradiction = False
    person_confirmed = False
    company_confirmed = False
    email_verified = False
    emails_seen: set[str] = set()
    email_verified_by: set[str] = set()

    for item in items:
        base = PROVIDER_TRUST.get(item.provider, 10)

        # Check for email verification
        if item.matched_email:
            emails_seen.add(item.matched_email.lower())
            if item.match_type in {
                "hunter_verified", "apollo_verified",
                "hunter_pattern_verified", "existing_email_verified"
            }:
                email_verified = True
                email_verified_by.add(item.provider)

        # Check for person/company confirmation
        if item.matched_name and item.matched_company:
            person_confirmed = True
            company_confirmed = True
            base += PERSON_COMPANY_BONUS
        elif item.matched_name:
            person_confirmed = True

        # Contradiction: multiple different emails found
        if len(emails_seen) > 1:
            contradiction = True

        score += base
        item.confidence_contribution = base

    # Hard overrides for verified email
    if email_verified:
        score = max(score, 95)

    # Cap at 100
    score = min(score, SCORE_CAP)

    # Determine status
    ambiguity_reason = ""

    if email_verified:
        status = STATUS_VERIFIED
    elif score >= 65 and person_confirmed and company_confirmed:
        status = STATUS_LIKELY
        if contradiction:
            ambiguity_reason = "Multiple email candidates found — manual review recommended"
    elif score >= 40 and domain_valid:
        status = STATUS_PATTERN
        ambiguity_reason = "Domain confirmed, email inferred from standard pattern"
    else:
        status = STATUS_REVIEW
        ambiguity_reason = "Insufficient evidence for confident classification"

    if contradiction:
        ambiguity_reason = (ambiguity_reason + " | CONTRADICTION: multiple email candidates").strip(" |")

    return score, status, ambiguity_reason


def rfq_gate(
    status: str,
    score: int,
    manual_approval: bool = False,
) -> Tuple[str, str]:
    """
    Apply RFQ-ready safety gate.
    Returns: (rfq_ready_flag, approval_basis)

    Rules:
      VERIFIED_EMAIL                    → YES, "VERIFIED_EMAIL"
      LIKELY_CORRECT + manual_approval  → YES, "MANUAL_APPROVAL"
      LIKELY_CORRECT without approval   → REVIEW_FIRST, ""
      Anything else                     → NO, ""
    """
    if status == STATUS_VERIFIED:
        return "YES", "VERIFIED_EMAIL"
    if status == STATUS_LIKELY and manual_approval:
        return "YES", "MANUAL_APPROVAL"
    if status in {STATUS_LIKELY, STATUS_PATTERN}:
        return "REVIEW_FIRST", ""
    return "NO", ""
