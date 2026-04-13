"""
models.py — FlowSeer Contact Verifier
Shared dataclasses, enums, and type vocabulary.
All other modules import from here — no circular dependencies.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import List, Optional


# ── Status vocabulary ─────────────────────────────────────────────────────────
STATUS_VERIFIED = "VERIFIED_EMAIL"
STATUS_LIKELY   = "LIKELY_CORRECT"
STATUS_PATTERN  = "DOMAIN_PATTERN_ONLY"
STATUS_REVIEW   = "NEEDS_REVIEW"
STATUS_SKIPPED  = "SKIPPED"

# ── Suppression reason vocabulary ────────────────────────────────────────────
SUPP_DUPLICATE_IN_RUN    = "DUPLICATE_IN_RUN"
SUPP_ALREADY_VERIFIED    = "ALREADY_VERIFIED"
SUPP_BOUNCED_EMAIL       = "BOUNCED_EMAIL"
SUPP_BAD_EMAIL           = "BAD_EMAIL"
SUPP_DO_NOT_CONTACT      = "DO_NOT_CONTACT"
SUPP_INSUFFICIENT_ID     = "INSUFFICIENT_IDENTITY"
SUPP_QUOTA_EXCEEDED      = "PROVIDER_QUOTA_EXCEEDED"

# ── Priority order ────────────────────────────────────────────────────────────
PRIORITY_ORDER = {
    "ACTIVE_RFQ": 1,
    "TIER1":      2,
    "BLOCKED":    3,
    "HIGH_VALUE": 4,
    "NORMAL":     5,
}

# Providers that require Apollo gating (ACTIVE_RFQ, TIER1, BLOCKED only)
APOLLO_ALLOWED_PRIORITIES = {"ACTIVE_RFQ", "TIER1", "BLOCKED"}


@dataclass
class EvidenceItem:
    """One piece of evidence from one provider."""
    provider:       str
    evidence_url:   str = ""
    page_title:     str = ""
    snippet:        str = ""
    matched_name:   str = ""
    matched_company:str = ""
    matched_role:   str = ""
    matched_domain: str = ""
    matched_email:  str = ""
    match_type:     str = ""   # e.g. "person_company_confirmed", "domain_pattern"
    timestamp:      str = ""
    confidence_contribution: int = 0
    contradiction:  bool = False


@dataclass
class VerificationResult:
    """Full verification result for one contact."""
    verification_status:    str = STATUS_REVIEW
    verification_source:    str = "UNRESOLVED"
    confidence_score:       int = 0
    confidence_label:       str = STATUS_REVIEW
    company_domain:         str = ""
    likely_email:           str = ""
    primary_evidence_url:   str = ""
    evidence_count:         int = 0
    evidence_items:         List[EvidenceItem] = field(default_factory=list)
    suppression_reason:     str = ""
    rfq_ready_flag:         str = "NO"
    manual_rfq_approval:    bool = False
    approval_basis:         str = ""
    provider_path:          str = ""   # comma-separated providers that contributed
    sources_tried:          str = ""
    ambiguity_reason:       str = ""
    contradiction_flag:     bool = False
    notes:                  str = ""
    last_checked_at:        str = ""

    def to_flat_dict(self) -> dict:
        """Flatten for CSV output — evidence_items serialized as JSON string."""
        import json
        d = {
            "verification_status":  self.verification_status,
            "verification_source":  self.verification_source,
            "confidence_score":     self.confidence_score,
            "confidence_label":     self.confidence_label,
            "company_domain":       self.company_domain,
            "likely_email":         self.likely_email,
            "primary_evidence_url": self.primary_evidence_url,
            "evidence_count":       self.evidence_count,
            "suppression_reason":   self.suppression_reason,
            "rfq_ready_flag":       self.rfq_ready_flag,
            "manual_rfq_approval":  str(self.manual_rfq_approval),
            "approval_basis":       self.approval_basis,
            "provider_path":        self.provider_path,
            "sources_tried":        self.sources_tried,
            "ambiguity_reason":     self.ambiguity_reason,
            "contradiction_flag":   str(self.contradiction_flag),
            "notes":                self.notes,
            "last_checked_at":      self.last_checked_at,
            "evidence_json":        json.dumps([vars(e) for e in self.evidence_items], ensure_ascii=False),
        }
        return d


@dataclass
class ProviderStats:
    """Per-provider call statistics for run summary."""
    name:           str
    attempted:      int = 0
    successful:     int = 0
    failed:         int = 0
    rate_limited:   int = 0
    skipped_quota:  int = 0
    disabled:       bool = False
    disable_reason: str = ""
