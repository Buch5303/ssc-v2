#!/usr/bin/env python3
"""
FlowSeer / SSC V2 — Free-First Contact Verification Pipeline
Directive 52 — Unified Free-First Contact Verification Automation

Source stack (in order of use):
  Layer 1:  Google Programmable Search    (100/day free)
  Layer 2:  SEC EDGAR full-text search    (unlimited, public filings)
  Layer 3:  Wikidata entity search        (unlimited, structured)
  Layer 4:  GitHub user search            (5000/hr with free token)
  Layer 5:  NewsAPI                       (100/day free)
  Layer 6:  ORCID publications            (unlimited, free)
  Layer 7:  OpenCorporates officers       (500/day with free key)
  Layer 8:  Domain MX validation          (unlimited)
  Layer 9:  Hunter email finder/verifier  (50/mo free)
  Layer 10: Apollo fallback               (priority contacts only)

Input:  contacts.csv
Output: contacts_verified.csv
        verification_log.jsonl
        verification_summary.txt

Required CSV columns:
    first_name, last_name, full_name, company, company_domain,
    title, priority, category, rfq_status, email

Priority values:
    ACTIVE_RFQ   — contacts tied to live RFQ drafts (Baker Hughes etc.)
    TIER1        — Tier 1 / strategic OEM supplier executives
    BLOCKED      — blocked categories needing contact urgently
    HIGH_VALUE   — categories > $300K mid estimate
    NORMAL       — all others

Environment variables (.env or shell):
    GOOGLE_API_KEY          (Google Custom Search)
    GOOGLE_CSE_ID           (Your Custom Search Engine ID)
    GITHUB_TOKEN            (free — Personal Access Token, no special scope needed)
    NEWS_API_KEY            (newsapi.org free account)
    OPENCORPORATES_API_KEY  (optional — free tier)
    HUNTER_API_KEY          (optional — free tier, 50/mo)
    APOLLO_API_KEY          (optional — priority fallback only)

Usage:
    pip install requests python-dotenv
    cp .env.example .env          # fill in your keys
    python contact_verifier.py
    python contact_verifier.py --limit 20     # top 20 contacts only
    python contact_verifier.py --priority ACTIVE_RFQ TIER1  # filter
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, asdict, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

# ── Optional .env loading ────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not required — can use shell env directly

# ── Configuration ─────────────────────────────────────────────────────────────
GOOGLE_API_KEY         = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID          = os.getenv("GOOGLE_CSE_ID", "")
GITHUB_TOKEN           = os.getenv("GITHUB_TOKEN", "")
NEWS_API_KEY           = os.getenv("NEWS_API_KEY", "")
OPENCORPORATES_API_KEY = os.getenv("OPENCORPORATES_API_KEY", "")
HUNTER_API_KEY         = os.getenv("HUNTER_API_KEY", "")
APOLLO_API_KEY         = os.getenv("APOLLO_API_KEY", "")

INPUT_CSV    = "contacts.csv"
OUTPUT_CSV   = "contacts_verified.csv"
LOG_FILE     = "verification_log.jsonl"
SUMMARY_FILE = "verification_summary.txt"

REQUEST_TIMEOUT     = 20
SLEEP_BETWEEN_CALLS = 1.0   # seconds — respect rate limits
SLEEP_GOOGLE        = 1.2   # Google CSE is sensitive

# ── Status vocabulary ─────────────────────────────────────────────────────────
STATUS_VERIFIED = "VERIFIED_EMAIL"
STATUS_LIKELY   = "LIKELY_CORRECT"
STATUS_PATTERN  = "DOMAIN_PATTERN_ONLY"
STATUS_REVIEW   = "NEEDS_REVIEW"

# ── Priority order ────────────────────────────────────────────────────────────
PRIORITY_ORDER = {
    "ACTIVE_RFQ": 1,
    "TIER1":      2,
    "BLOCKED":    3,
    "HIGH_VALUE": 4,
    "NORMAL":     5,
}


# ── Data model ────────────────────────────────────────────────────────────────
@dataclass
class VerificationResult:
    verification_status:   str = STATUS_REVIEW
    verification_source:   str = "UNRESOLVED"
    confidence_score:      int = 0
    company_domain:        str = ""
    likely_email:          str = ""
    public_evidence_url:   str = ""
    notes:                 str = ""
    ready_for_rfq:         str = "NO"
    sources_tried:         str = ""   # comma-separated list of layers attempted
    last_checked_at:       str = ""


# ── Utilities ─────────────────────────────────────────────────────────────────
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: Dict[str, Any]) -> None:
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")


def safe_get(d: Dict[str, Any], key: str, default: str = "") -> str:
    value = d.get(key, default)
    return str(value).strip() if value is not None else default


def normalize_domain(raw: str) -> str:
    d = raw.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = re.sub(r"^www\.", "", d)
    return d.split("/")[0]


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = "FlowSeerContactVerifier/2.0 (contact verification research)"
    s.headers["Accept"]     = "application/json"
    return s


def infer_email_patterns(first: str, last: str, domain: str) -> List[str]:
    if not (domain and first and last):
        return []
    fn = re.sub(r"[^a-z]", "", first.lower())
    ln = re.sub(r"[^a-z]", "", last.lower())
    fi, li = fn[:1], ln[:1]
    seen, out = set(), []
    for p in [
        f"{fn}.{ln}@{domain}",
        f"{fi}{ln}@{domain}",
        f"{fn}{li}@{domain}",
        f"{fn}@{domain}",
        f"{ln}@{domain}",
        f"{fi}.{ln}@{domain}",
    ]:
        if p not in seen:
            out.append(p)
            seen.add(p)
    return out


def is_priority_for_apollo(contact: Dict[str, str]) -> bool:
    p = safe_get(contact, "priority", "NORMAL").upper()
    return PRIORITY_ORDER.get(p, 99) <= 3


def rfq_ready_from_status(status: str, confidence: int) -> str:
    if status == STATUS_VERIFIED:
        return "YES"
    if status == STATUS_LIKELY and confidence >= 80:
        return "REVIEW_FIRST"
    if status == STATUS_PATTERN:
        return "REVIEW_FIRST"
    return "NO"


# ── Layer 1: Google Programmable Search ───────────────────────────────────────
def google_search(session: requests.Session, query: str) -> List[Dict[str, Any]]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        return []
    try:
        r = session.get(
            "https://www.googleapis.com/customsearch/v1",
            params={"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": 5},
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        time.sleep(SLEEP_GOOGLE)
        return r.json().get("items", [])
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "google", "query": query, "error": str(e)})
        return []


def google_verify_contact(
    session: requests.Session,
    full_name: str,
    company: str,
    domain: str,
    first: str,
    last: str,
) -> Tuple[bool, str, str]:
    """Returns: (person_company_matched, best_evidence_url, note)"""
    queries = [
        f'"{full_name}" "{company}"',
        f'site:{domain} "{full_name}"' if domain else "",
        f'"{full_name}" "{company}" email',
        f'"{company}" email format site:{domain}' if domain else "",
        f'"{full_name}" filetype:pdf',
        f'"{full_name}" press release "{company}"',
    ]

    all_results: List[Dict[str, Any]] = []
    for q in queries:
        if not q:
            continue
        all_results.extend(google_search(session, q))

    fn_lower, co_lower = full_name.lower(), company.lower()
    for item in all_results:
        text = (safe_get(item, "title") + " " + safe_get(item, "snippet")).lower()
        if fn_lower in text and co_lower in text:
            return True, safe_get(item, "link"), "Google: person + company matched in public content"

    if all_results:
        return False, safe_get(all_results[0], "link"), "Google: results found, weak person-company match"

    return False, "", "Google: no results"


# ── Layer 2: SEC EDGAR ────────────────────────────────────────────────────────
def sec_edgar_search(
    session: requests.Session, full_name: str, company: str
) -> Tuple[bool, str, str]:
    """Search SEC EDGAR full-text for named executives at public companies."""
    try:
        params = {
            "q": f'"{full_name}"',
            "dateRange": "custom",
            "startdt": "2020-01-01",
            "forms": "DEF 14A,10-K,8-K",
        }
        r = session.get(
            "https://efts.sec.gov/LATEST/search-index",
            params=params,
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": "FlowSeerContactVerifier contact-research@flowseer.ai"},
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        if r.status_code != 200:
            return False, "", "SEC EDGAR: request failed"

        data = r.json()
        hits = data.get("hits", {}).get("hits", [])

        co_lower = company.lower()
        for hit in hits[:5]:
            source = hit.get("_source", {})
            entity_name = source.get("entity_name", "").lower()
            display_names = [n.lower() for n in source.get("display_names", [])]
            if co_lower in entity_name or any(co_lower in n for n in display_names):
                filing_url = (
                    "https://www.sec.gov/Archives/"
                    + source.get("file_date", "")
                    + "/"
                    + source.get("file_num", "")
                )
                return True, filing_url, f"SEC EDGAR: {full_name} found in filing for {source.get('entity_name', company)}"

        # Softer match — found person in any filing
        if hits:
            return False, "", f"SEC EDGAR: {full_name} appears in filings — company not confirmed"

        return False, "", "SEC EDGAR: no filings found"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "sec_edgar", "name": full_name, "error": str(e)})
        return False, "", f"SEC EDGAR: error — {e}"


# ── Layer 3: Wikidata ─────────────────────────────────────────────────────────
def wikidata_search(
    session: requests.Session, full_name: str, company: str
) -> Tuple[bool, str, str]:
    """Search Wikidata for person entity with employer match."""
    try:
        r = session.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": full_name,
                "language": "en",
                "type": "item",
                "format": "json",
                "limit": 5,
            },
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        results = r.json().get("search", [])

        co_lower = company.lower()
        for item in results:
            description = item.get("description", "").lower()
            if co_lower in description or any(
                kw in description
                for kw in ["executive", "ceo", "president", "chairman", "officer", "director"]
            ):
                url = f"https://www.wikidata.org/wiki/{item['id']}"
                return True, url, f"Wikidata: {full_name} found — {item.get('description', '')}"

        if results:
            item = results[0]
            url = f"https://www.wikidata.org/wiki/{item['id']}"
            return False, url, f"Wikidata: {full_name} found but company not confirmed — {item.get('description', '')}"

        return False, "", "Wikidata: no entity found"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "wikidata", "name": full_name, "error": str(e)})
        return False, "", f"Wikidata: error — {e}"


# ── Layer 4: GitHub ───────────────────────────────────────────────────────────
def github_search(
    session: requests.Session, full_name: str, company: str
) -> Tuple[bool, str, str]:
    """Search GitHub users — useful for CTOs, engineering VPs, technical leads."""
    headers: Dict[str, str] = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"

    try:
        r = session.get(
            "https://api.github.com/search/users",
            params={"q": f"{full_name} {company}", "per_page": 5},
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        if r.status_code == 403:
            return False, "", "GitHub: rate limited"
        items = r.json().get("items", [])

        co_lower = company.lower()
        for user in items:
            # Fetch full profile to check company field
            try:
                profile_r = session.get(
                    user["url"], headers=headers, timeout=REQUEST_TIMEOUT
                )
                profile = profile_r.json()
                profile_company = (profile.get("company") or "").lower().strip("@")
                profile_name    = (profile.get("name") or "").lower()
                if co_lower in profile_company or full_name.lower() in profile_name:
                    return True, user.get("html_url", ""), f"GitHub: profile matches {full_name} at {company}"
            except Exception:
                continue

        return False, "", "GitHub: no matching profile"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "github", "name": full_name, "error": str(e)})
        return False, "", f"GitHub: error — {e}"


# ── Layer 5: NewsAPI ──────────────────────────────────────────────────────────
def newsapi_search(
    session: requests.Session, full_name: str, company: str
) -> Tuple[bool, str, str]:
    """Search NewsAPI for recent press coverage confirming role."""
    if not NEWS_API_KEY:
        return False, "", "NewsAPI: no key"
    try:
        r = session.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": f'"{full_name}" "{company}"',
                "language": "en",
                "sortBy": "relevancy",
                "pageSize": 5,
                "apiKey": NEWS_API_KEY,
            },
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        articles = r.json().get("articles", [])
        if articles:
            art = articles[0]
            return True, art.get("url", ""), f"NewsAPI: {full_name} in press — {art.get('title', '')[:80]}"
        return False, "", "NewsAPI: no articles found"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "newsapi", "name": full_name, "error": str(e)})
        return False, "", f"NewsAPI: error — {e}"


# ── Layer 6: ORCID ────────────────────────────────────────────────────────────
def orcid_search(
    session: requests.Session, first: str, last: str, company: str
) -> Tuple[bool, str, str]:
    """Search ORCID for published researchers / technical executives."""
    try:
        r = session.get(
            "https://pub.orcid.org/v3.0/search",
            params={"q": f"family-name:{last} AND given-names:{first}"},
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        results = r.json().get("result", [])
        co_lower = company.lower()
        for item in results[:3]:
            orcid_id = item.get("orcid-identifier", {}).get("path", "")
            # Fetch employment info
            try:
                emp_r = session.get(
                    f"https://pub.orcid.org/v3.0/{orcid_id}/employments",
                    headers={"Accept": "application/json"},
                    timeout=REQUEST_TIMEOUT,
                )
                employments = emp_r.json().get("affiliation-group", [])
                for emp_group in employments:
                    summaries = emp_group.get("summaries", [])
                    for s in summaries:
                        org = s.get("employment-summary", {}).get("organization", {})
                        org_name = (org.get("name") or "").lower()
                        if co_lower in org_name:
                            url = f"https://orcid.org/{orcid_id}"
                            return True, url, f"ORCID: {first} {last} employed at {org.get('name', company)}"
            except Exception:
                continue

        return False, "", "ORCID: no matching researcher"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "orcid", "name": f"{first} {last}", "error": str(e)})
        return False, "", f"ORCID: error — {e}"


# ── Layer 7: OpenCorporates ───────────────────────────────────────────────────
def opencorporates_search(
    session: requests.Session, full_name: str, company: str
) -> Tuple[bool, str, str]:
    """Search OpenCorporates for registered officers."""
    try:
        params: Dict[str, Any] = {"q": full_name, "per_page": 10}
        if OPENCORPORATES_API_KEY:
            params["api_token"] = OPENCORPORATES_API_KEY

        r = session.get(
            "https://api.opencorporates.com/v0.4/officers/search",
            params=params,
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        if r.status_code != 200:
            return False, "", "OpenCorporates: request failed"

        results = r.json().get("results", {}).get("officers", [])
        co_lower = company.lower()

        for item in results:
            officer = item.get("officer", {})
            name = (officer.get("name") or "").lower()
            corp_name = (officer.get("company", {}).get("name") or "").lower()
            if full_name.lower() in name and co_lower in corp_name:
                url = officer.get("opencorporates_url", "")
                return True, url, f"OpenCorporates: officer record found — {officer.get('name', full_name)} at {officer.get('company', {}).get('name', company)}"

        return False, "", "OpenCorporates: no officer record"
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "opencorporates", "name": full_name, "error": str(e)})
        return False, "", f"OpenCorporates: error — {e}"


# ── Layer 8: Domain MX validation ────────────────────────────────────────────
def validate_domain_mx(session: requests.Session, domain: str) -> bool:
    """Check that the company domain has an active mail server (MX record)."""
    if not domain:
        return False
    try:
        # Use a public DNS-over-HTTPS API — no key needed
        r = session.get(
            "https://dns.google/resolve",
            params={"name": domain, "type": "MX"},
            timeout=REQUEST_TIMEOUT,
        )
        data = r.json()
        return bool(data.get("Answer"))
    except Exception:
        return False


# ── Layer 9: Hunter ───────────────────────────────────────────────────────────
def hunter_find(
    session: requests.Session, first: str, last: str, domain: str
) -> Optional[str]:
    if not (HUNTER_API_KEY and domain):
        return None
    try:
        r = session.get(
            "https://api.hunter.io/v2/email-finder",
            params={"domain": domain, "first_name": first, "last_name": last, "api_key": HUNTER_API_KEY},
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        data = r.json().get("data") or {}
        return data.get("email") or None
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "hunter_find", "error": str(e)})
        return None


def hunter_verify(session: requests.Session, email: str) -> Optional[str]:
    """Returns 'valid', 'risky', 'undeliverable', or None."""
    if not (HUNTER_API_KEY and email):
        return None
    try:
        r = session.get(
            "https://api.hunter.io/v2/email-verifier",
            params={"email": email, "api_key": HUNTER_API_KEY},
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        data = r.json().get("data") or {}
        return data.get("status") or None
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "hunter_verify", "error": str(e)})
        return None


# ── Layer 10: Apollo ──────────────────────────────────────────────────────────
def apollo_search(
    session: requests.Session, first: str, last: str, company: str
) -> Optional[str]:
    """Priority contacts only. Returns email or None."""
    if not APOLLO_API_KEY:
        return None
    try:
        r = session.post(
            "https://api.apollo.io/api/v1/people/search",
            headers={"Content-Type": "application/json", "X-Api-Key": APOLLO_API_KEY},
            json={"q_keywords": f"{first} {last} {company}", "page": 1, "per_page": 3},
            timeout=REQUEST_TIMEOUT,
        )
        time.sleep(SLEEP_BETWEEN_CALLS)
        people = r.json().get("people", [])
        if people:
            email = people[0].get("email") or ""
            return email if email else None
    except Exception as e:
        log_event({"ts": now_iso(), "layer": "apollo", "error": str(e)})
    return None


# ── Main verification orchestrator ────────────────────────────────────────────
def verify_contact(session: requests.Session, contact: Dict[str, str]) -> VerificationResult:
    first  = safe_get(contact, "first_name")
    last   = safe_get(contact, "last_name")
    full   = safe_get(contact, "full_name") or f"{first} {last}".strip()
    company = safe_get(contact, "company")
    domain  = normalize_domain(safe_get(contact, "company_domain"))
    existing_email = safe_get(contact, "email")

    sources_tried: List[str] = []
    best_evidence_url = ""
    best_note = ""
    person_company_confirmed = False

    # ── Step 0: Verify existing email if present ──────────────────────────────
    if existing_email:
        sources_tried.append("HUNTER_VERIFY")
        status = hunter_verify(session, existing_email)
        if status in {"valid", "accept_all"}:
            return VerificationResult(
                verification_status=STATUS_VERIFIED,
                verification_source="HUNTER_VERIFY_EXISTING",
                confidence_score=100,
                company_domain=domain,
                likely_email=existing_email,
                public_evidence_url="",
                notes=f"Existing email verified by Hunter ({status})",
                ready_for_rfq="YES",
                sources_tried=",".join(sources_tried),
                last_checked_at=now_iso(),
            )

    # ── Step 1: Google public-web search ─────────────────────────────────────
    if GOOGLE_API_KEY:
        sources_tried.append("GOOGLE")
        matched, url, note = google_verify_contact(session, full, company, domain, first, last)
        if matched:
            person_company_confirmed = True
        if url:
            best_evidence_url = best_evidence_url or url
        best_note = best_note or note

    # ── Step 2: SEC EDGAR ────────────────────────────────────────────────────
    sources_tried.append("SEC_EDGAR")
    matched, url, note = sec_edgar_search(session, full, company)
    if matched:
        person_company_confirmed = True
        best_evidence_url = best_evidence_url or url
        best_note = note

    # ── Step 3: Wikidata ─────────────────────────────────────────────────────
    sources_tried.append("WIKIDATA")
    matched, url, note = wikidata_search(session, full, company)
    if matched:
        person_company_confirmed = True
        best_evidence_url = best_evidence_url or url
        best_note = best_note or note

    # ── Step 4: GitHub ───────────────────────────────────────────────────────
    sources_tried.append("GITHUB")
    matched, url, note = github_search(session, full, company)
    if matched:
        person_company_confirmed = True
        best_evidence_url = best_evidence_url or url
        best_note = best_note or note

    # ── Step 5: NewsAPI ──────────────────────────────────────────────────────
    if NEWS_API_KEY:
        sources_tried.append("NEWSAPI")
        matched, url, note = newsapi_search(session, full, company)
        if matched:
            person_company_confirmed = True
            best_evidence_url = best_evidence_url or url
            best_note = best_note or note

    # ── Step 6: ORCID (technical contacts) ───────────────────────────────────
    sources_tried.append("ORCID")
    matched, url, note = orcid_search(session, first, last, company)
    if matched:
        person_company_confirmed = True
        best_evidence_url = best_evidence_url or url
        best_note = best_note or note

    # ── Step 7: OpenCorporates ────────────────────────────────────────────────
    sources_tried.append("OPENCORPORATES")
    matched, url, note = opencorporates_search(session, full, company)
    if matched:
        person_company_confirmed = True
        best_evidence_url = best_evidence_url or url
        best_note = best_note or note

    # ── Step 8: Domain MX validation ─────────────────────────────────────────
    mx_valid = False
    if domain:
        sources_tried.append("DOMAIN_MX")
        mx_valid = validate_domain_mx(session, domain)

    # ── Step 9: Hunter email finder ───────────────────────────────────────────
    if HUNTER_API_KEY and domain:
        sources_tried.append("HUNTER_FIND")
        found_email = hunter_find(session, first, last, domain)
        if found_email:
            verify_status = hunter_verify(session, found_email)
            if verify_status in {"valid", "accept_all"}:
                return VerificationResult(
                    verification_status=STATUS_VERIFIED,
                    verification_source="HUNTER_FINDER+VERIFY",
                    confidence_score=100,
                    company_domain=domain,
                    likely_email=found_email,
                    public_evidence_url=best_evidence_url,
                    notes=f"Hunter found and verified email ({verify_status}). {best_note}",
                    ready_for_rfq="YES",
                    sources_tried=",".join(sources_tried),
                    last_checked_at=now_iso(),
                )
            # Found but unverified — still useful
            patterns = [found_email]
        else:
            patterns = infer_email_patterns(first, last, domain)
    else:
        patterns = infer_email_patterns(first, last, domain) if domain else []

    # ── Consolidate evidence into result ──────────────────────────────────────
    if person_company_confirmed and patterns and mx_valid:
        # Try to Hunter-verify the top inferred pattern
        if HUNTER_API_KEY:
            verify_status = hunter_verify(session, patterns[0])
            if verify_status in {"valid", "accept_all"}:
                return VerificationResult(
                    verification_status=STATUS_VERIFIED,
                    verification_source="PUBLIC_EVIDENCE+PATTERN+HUNTER_VERIFY",
                    confidence_score=100,
                    company_domain=domain,
                    likely_email=patterns[0],
                    public_evidence_url=best_evidence_url,
                    notes=f"Person confirmed via public evidence, pattern verified by Hunter. {best_note}",
                    ready_for_rfq="YES",
                    sources_tried=",".join(sources_tried),
                    last_checked_at=now_iso(),
                )

        return VerificationResult(
            verification_status=STATUS_LIKELY,
            verification_source="PUBLIC_EVIDENCE+DOMAIN_PATTERN",
            confidence_score=80,
            company_domain=domain,
            likely_email=patterns[0],
            public_evidence_url=best_evidence_url,
            notes=f"Person+company confirmed in public sources, email inferred. {best_note}",
            ready_for_rfq="REVIEW_FIRST",
            sources_tried=",".join(sources_tried),
            last_checked_at=now_iso(),
        )

    if patterns and mx_valid and domain:
        return VerificationResult(
            verification_status=STATUS_PATTERN,
            verification_source="DOMAIN_PATTERN_ONLY",
            confidence_score=60,
            company_domain=domain,
            likely_email=patterns[0],
            public_evidence_url=best_evidence_url,
            notes=f"Domain has active MX. Email inferred from standard pattern. {best_note}",
            ready_for_rfq="REVIEW_FIRST",
            sources_tried=",".join(sources_tried),
            last_checked_at=now_iso(),
        )

    # ── Step 10: Apollo fallback (priority only) ──────────────────────────────
    if is_priority_for_apollo(contact):
        sources_tried.append("APOLLO")
        apollo_email = apollo_search(session, first, last, company)
        if apollo_email:
            return VerificationResult(
                verification_status=STATUS_VERIFIED,
                verification_source="APOLLO_FALLBACK",
                confidence_score=100,
                company_domain=domain,
                likely_email=apollo_email,
                public_evidence_url=best_evidence_url,
                notes=f"Resolved by Apollo (priority contact). {best_note}",
                ready_for_rfq="YES",
                sources_tried=",".join(sources_tried),
                last_checked_at=now_iso(),
            )

    return VerificationResult(
        verification_status=STATUS_REVIEW,
        verification_source="UNRESOLVED",
        confidence_score=0,
        company_domain=domain,
        likely_email="",
        public_evidence_url=best_evidence_url,
        notes=f"All layers exhausted. Manual review required. {best_note}".strip(),
        ready_for_rfq="NO",
        sources_tried=",".join(sources_tried),
        last_checked_at=now_iso(),
    )


# ── CSV I/O ───────────────────────────────────────────────────────────────────
def read_contacts(path: str) -> List[Dict[str, str]]:
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def write_contacts(path: str, rows: List[Dict[str, str]]) -> None:
    if not rows:
        return
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def sort_contacts(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    return sorted(
        rows,
        key=lambda r: (
            PRIORITY_ORDER.get(safe_get(r, "priority", "NORMAL").upper(), 99),
            safe_get(r, "company"),
            safe_get(r, "full_name"),
        ),
    )


def write_summary(output_rows: List[Dict[str, str]]) -> None:
    counts: Dict[str, int] = {
        STATUS_VERIFIED: 0,
        STATUS_LIKELY: 0,
        STATUS_PATTERN: 0,
        STATUS_REVIEW: 0,
    }
    ready_count = 0
    for row in output_rows:
        status = safe_get(row, "verification_status", STATUS_REVIEW)
        counts[status] = counts.get(status, 0) + 1
        if safe_get(row, "ready_for_rfq") == "YES":
            ready_count += 1

    lines = [
        "=" * 60,
        "FlowSeer Contact Verification Summary",
        f"Generated: {now_iso()}",
        "=" * 60,
        f"Total contacts processed:  {len(output_rows)}",
        f"VERIFIED_EMAIL:            {counts[STATUS_VERIFIED]}",
        f"LIKELY_CORRECT:            {counts[STATUS_LIKELY]}",
        f"DOMAIN_PATTERN_ONLY:       {counts[STATUS_PATTERN]}",
        f"NEEDS_REVIEW:              {counts[STATUS_REVIEW]}",
        f"Ready for RFQ (YES):       {ready_count}",
        "=" * 60,
    ]

    with open(SUMMARY_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print("\n".join(lines))


# ── CLI entrypoint ────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FlowSeer Contact Verifier")
    parser.add_argument("--input",    default=INPUT_CSV,  help="Input CSV path")
    parser.add_argument("--output",   default=OUTPUT_CSV, help="Output CSV path")
    parser.add_argument("--limit",    type=int,           help="Process only top N contacts")
    parser.add_argument("--priority", nargs="+",          help="Filter to specific priority levels")
    parser.add_argument("--dry-run",  action="store_true", help="Print contacts that would be processed, no API calls")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    contacts = sort_contacts(read_contacts(args.input))

    if args.priority:
        p_filter = {p.upper() for p in args.priority}
        contacts = [c for c in contacts if safe_get(c, "priority", "NORMAL").upper() in p_filter]

    if args.limit:
        contacts = contacts[:args.limit]

    print(f"Processing {len(contacts)} contacts...")
    print(f"Sources available: "
          f"Google={'YES' if GOOGLE_API_KEY else 'NO'} | "
          f"GitHub={'YES' if GITHUB_TOKEN else 'NO (add GITHUB_TOKEN for higher rate limit)'} | "
          f"NewsAPI={'YES' if NEWS_API_KEY else 'NO'} | "
          f"Hunter={'YES' if HUNTER_API_KEY else 'NO'} | "
          f"Apollo={'YES' if APOLLO_API_KEY else 'NO'}")
    print("SEC EDGAR, Wikidata, ORCID, OpenCorporates: always active (no key required)")
    print()

    if args.dry_run:
        for i, c in enumerate(contacts, 1):
            full = safe_get(c, "full_name") or f"{safe_get(c, 'first_name')} {safe_get(c, 'last_name')}"
            print(f"[{i}] {full} @ {safe_get(c, 'company')} — priority: {safe_get(c, 'priority', 'NORMAL')}")
        return

    session = make_session()
    output_rows: List[Dict[str, str]] = []

    for idx, row in enumerate(contacts, 1):
        full = safe_get(row, "full_name") or f"{safe_get(row, 'first_name')} {safe_get(row, 'last_name')}"
        company = safe_get(row, "company")

        try:
            result = verify_contact(session, row)
            merged = {**row, **asdict(result)}
            output_rows.append(merged)

            log_event({
                "ts": now_iso(), "index": idx,
                "contact": full, "company": company,
                "result": asdict(result),
            })

            status_icon = {
                STATUS_VERIFIED: "✓",
                STATUS_LIKELY:   "~",
                STATUS_PATTERN:  "?",
                STATUS_REVIEW:   "✗",
            }.get(result.verification_status, "?")

            print(f"[{idx:3}/{len(contacts)}] {status_icon} {full[:35]:<35} @ {company[:30]:<30} "
                  f"→ {result.verification_status} [{result.verification_source}]")

        except Exception as e:
            merged = {**row,
                      "verification_status": STATUS_REVIEW,
                      "verification_source": "ERROR",
                      "confidence_score": 0,
                      "likely_email": "",
                      "public_evidence_url": "",
                      "notes": f"Unhandled error: {e}",
                      "ready_for_rfq": "NO",
                      "sources_tried": "",
                      "last_checked_at": now_iso()}
            output_rows.append(merged)
            log_event({"ts": now_iso(), "index": idx, "contact": full, "error": str(e)})
            print(f"[{idx:3}/{len(contacts)}] ✗ {full} — ERROR: {e}")

    write_contacts(args.output, output_rows)
    write_summary(output_rows)
    print(f"\nOutput: {args.output}")
    print(f"Log:    {LOG_FILE}")
    print(f"Summary: {SUMMARY_FILE}")


if __name__ == "__main__":
    main()
