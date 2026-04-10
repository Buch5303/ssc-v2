"""
providers/free_sources.py — FlowSeer Contact Verifier
Free-tier provider adapters. No paid quotas consumed here.

Adapters:
  google_search()         Layer 1 — Google Programmable Search (100/day free)
  sec_edgar_search()      Layer 2 — SEC EDGAR full-text (unlimited)
  wikidata_search()       Layer 3 — Wikidata entity search (unlimited)
  github_search()         Layer 4 — GitHub user search (5000/hr with token)
  newsapi_search()        Layer 5 — NewsAPI (100/day free)
  orcid_search()          Layer 6 — ORCID publications (unlimited)
  opencorporates_search() Layer 7 — OpenCorporates officers (500/day free key)
  validate_domain_mx()    Layer 8 — DNS-over-HTTPS MX check (unlimited)

Each adapter returns a list of EvidenceItem objects.
Empty list = no results (never raises — logs and returns []).
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, List

import requests

from models import EvidenceItem
from providers.common import (
    REQUEST_TIMEOUT,
    SLEEP_BETWEEN_CALLS,
    SLEEP_GOOGLE,
    now_iso,
    safe_get,
    safe_get_nested,
    normalize_domain,
    infer_email_patterns,
)

log = logging.getLogger(__name__)

GOOGLE_API_KEY         = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID          = os.getenv("GOOGLE_CSE_ID", "")
GITHUB_TOKEN           = os.getenv("GITHUB_TOKEN", "")
NEWS_API_KEY           = os.getenv("NEWS_API_KEY", "")
OPENCORPORATES_API_KEY = os.getenv("OPENCORPORATES_API_KEY", "")


# ── Layer 1: Google Programmable Search ───────────────────────────────────────

def google_search(
    session: requests.Session,
    full_name: str,
    company: str,
    domain: str,
    first: str,
    last: str,
) -> List[EvidenceItem]:
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        return []

    queries = [
        f'"{full_name}" "{company}"',
        f'site:{domain} "{full_name}"' if domain else "",
        f'"{full_name}" "{company}" email',
        f'"{company}" email format site:{domain}' if domain else "",
        f'"{full_name}" filetype:pdf',
        f'"{full_name}" press release "{company}"',
    ]

    fn_lower, co_lower = full_name.lower(), company.lower()
    items: List[EvidenceItem] = []

    for query in queries:
        if not query:
            continue
        try:
            r = session.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID, "q": query, "num": 5},
                timeout=REQUEST_TIMEOUT,
            )
            r.raise_for_status()
            time.sleep(SLEEP_GOOGLE)
            results = r.json().get("items", [])

            for result in results:
                title   = safe_get(result, "title")
                snippet = safe_get(result, "snippet")
                link    = safe_get(result, "link")
                text    = (title + " " + snippet).lower()

                matched_person  = fn_lower in text
                matched_company = co_lower in text

                match_type = ""
                if matched_person and matched_company:
                    match_type = "person_company_confirmed"
                elif matched_person:
                    match_type = "person_only"
                else:
                    match_type = "related_content"

                items.append(EvidenceItem(
                    provider="GOOGLE",
                    evidence_url=link,
                    page_title=title,
                    snippet=snippet[:300],
                    matched_name=full_name if matched_person else "",
                    matched_company=company if matched_company else "",
                    match_type=match_type,
                    timestamp=now_iso(),
                ))

                # Stop querying once person+company confirmed
                if matched_person and matched_company:
                    return items

        except Exception as e:
            log.debug("[GOOGLE] query failed: %s — %s", query, e)
            raise  # Let ProviderGuard handle retry/disable

    return items


# ── Layer 2: SEC EDGAR ────────────────────────────────────────────────────────

def sec_edgar_search(
    session: requests.Session,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
    try:
        r = session.get(
            "https://efts.sec.gov/LATEST/search-index",
            params={
                "q": f'"{full_name}"',
                "dateRange": "custom",
                "startdt": "2020-01-01",
                "forms": "DEF 14A,10-K,8-K",
            },
            headers={"User-Agent": "FlowSeerContactVerifier contact-research@flowseer.ai"},
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        hits = r.json().get("hits", {}).get("hits", [])
        co_lower = company.lower()
        items: List[EvidenceItem] = []

        for hit in hits[:5]:
            source = hit.get("_source", {})
            entity = safe_get(source, "entity_name")
            matched = co_lower in entity.lower() or any(
                co_lower in n.lower() for n in source.get("display_names", [])
            )
            match_type = "person_company_confirmed" if matched else "person_in_filing"
            items.append(EvidenceItem(
                provider="SEC_EDGAR",
                evidence_url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company={entity}",
                page_title=f"SEC EDGAR — {entity}",
                snippet=f"Filing type: {safe_get(source, 'file_num')} | Date: {safe_get(source, 'file_date')}",
                matched_name=full_name,
                matched_company=entity if matched else "",
                match_type=match_type,
                timestamp=now_iso(),
            ))
            if matched:
                return items

        return items
    except Exception as e:
        log.debug("[SEC_EDGAR] failed: %s", e)
        raise


# ── Layer 3: Wikidata ─────────────────────────────────────────────────────────

def wikidata_search(
    session: requests.Session,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
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
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        results = r.json().get("search", [])
        co_lower = company.lower()
        items: List[EvidenceItem] = []

        for item in results:
            description = item.get("description", "").lower()
            matched = co_lower in description or any(
                kw in description for kw in ["ceo", "president", "chairman", "officer", "executive", "director"]
            )
            match_type = "person_company_confirmed" if (matched and co_lower in description) else ("executive_role" if matched else "person_entity")
            url = f"https://www.wikidata.org/wiki/{item['id']}"
            items.append(EvidenceItem(
                provider="WIKIDATA",
                evidence_url=url,
                page_title=item.get("label", full_name),
                snippet=item.get("description", "")[:300],
                matched_name=full_name,
                matched_company=company if co_lower in description else "",
                match_type=match_type,
                timestamp=now_iso(),
            ))
            if matched and co_lower in description:
                return items

        return items
    except Exception as e:
        log.debug("[WIKIDATA] failed: %s", e)
        raise


# ── Layer 4: GitHub ───────────────────────────────────────────────────────────

def github_search(
    session: requests.Session,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
    headers: Dict[str, str] = {}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    co_lower = company.lower()

    try:
        r = session.get(
            "https://api.github.com/search/users",
            params={"q": f"{full_name} {company}", "per_page": 5},
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        if r.status_code == 403:
            log.debug("[GITHUB] rate limited")
            return []
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        users = r.json().get("items", [])
        items: List[EvidenceItem] = []

        for user in users:
            try:
                prof = session.get(user["url"], headers=headers, timeout=REQUEST_TIMEOUT).json()
                time.sleep(0.3)
                profile_company = (prof.get("company") or "").lower().strip("@ ")
                profile_name    = (prof.get("name") or "").lower()
                profile_email   = (prof.get("email") or "").lower()
                matched_co      = co_lower in profile_company
                matched_name    = full_name.lower() in profile_name

                if matched_co or matched_name:
                    match_type = "person_company_confirmed" if (matched_co and matched_name) else (
                        "company_match" if matched_co else "name_match"
                    )
                    items.append(EvidenceItem(
                        provider="GITHUB",
                        evidence_url=user.get("html_url", ""),
                        page_title=f"GitHub — {prof.get('login', '')}",
                        snippet=f"Name: {prof.get('name', '')} | Company: {prof.get('company', '')} | Bio: {(prof.get('bio') or '')[:100]}",
                        matched_name=full_name if matched_name else "",
                        matched_company=company if matched_co else "",
                        matched_email=profile_email,
                        match_type=match_type,
                        timestamp=now_iso(),
                    ))
                    if matched_co and matched_name:
                        return items
            except Exception:
                continue

        return items
    except Exception as e:
        log.debug("[GITHUB] failed: %s", e)
        raise


# ── Layer 5: NewsAPI ──────────────────────────────────────────────────────────

def newsapi_search(
    session: requests.Session,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
    if not NEWS_API_KEY:
        return []
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
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        articles = r.json().get("articles", [])
        items: List[EvidenceItem] = []

        for art in articles[:3]:
            items.append(EvidenceItem(
                provider="NEWSAPI",
                evidence_url=art.get("url", ""),
                page_title=art.get("title", "")[:200],
                snippet=(art.get("description") or "")[:300],
                matched_name=full_name,
                matched_company=company,
                match_type="person_company_confirmed",
                timestamp=now_iso(),
            ))

        return items
    except Exception as e:
        log.debug("[NEWSAPI] failed: %s", e)
        raise


# ── Layer 6: ORCID ────────────────────────────────────────────────────────────

def orcid_search(
    session: requests.Session,
    first: str,
    last: str,
    company: str,
) -> List[EvidenceItem]:
    co_lower = company.lower()
    try:
        r = session.get(
            "https://pub.orcid.org/v3.0/search",
            params={"q": f"family-name:{last} AND given-names:{first}"},
            headers={"Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        results = r.json().get("result", [])
        items: List[EvidenceItem] = []

        for item in results[:3]:
            orcid_id = safe_get_nested(item, "orcid-identifier", "path")
            if not orcid_id:
                continue
            try:
                emp_r = session.get(
                    f"https://pub.orcid.org/v3.0/{orcid_id}/employments",
                    headers={"Accept": "application/json"},
                    timeout=REQUEST_TIMEOUT,
                )
                emp_r.raise_for_status()
                for grp in emp_r.json().get("affiliation-group", []):
                    for s in grp.get("summaries", []):
                        org_name = safe_get_nested(s, "employment-summary", "organization", "name")
                        if co_lower in org_name.lower():
                            url = f"https://orcid.org/{orcid_id}"
                            items.append(EvidenceItem(
                                provider="ORCID",
                                evidence_url=url,
                                page_title=f"ORCID — {first} {last}",
                                snippet=f"Employed at {org_name}",
                                matched_name=f"{first} {last}",
                                matched_company=org_name,
                                match_type="person_company_confirmed",
                                timestamp=now_iso(),
                            ))
                            return items
            except Exception:
                continue

        return items
    except Exception as e:
        log.debug("[ORCID] failed: %s", e)
        raise


# ── Layer 7: OpenCorporates ───────────────────────────────────────────────────

def opencorporates_search(
    session: requests.Session,
    full_name: str,
    company: str,
) -> List[EvidenceItem]:
    co_lower = company.lower()
    try:
        params: Dict[str, Any] = {"q": full_name, "per_page": 10}
        if OPENCORPORATES_API_KEY:
            params["api_token"] = OPENCORPORATES_API_KEY

        r = session.get(
            "https://api.opencorporates.com/v0.4/officers/search",
            params=params,
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        time.sleep(SLEEP_BETWEEN_CALLS)
        officers = r.json().get("results", {}).get("officers", [])
        items: List[EvidenceItem] = []

        for entry in officers:
            officer  = entry.get("officer", {})
            name     = (officer.get("name") or "").lower()
            corp     = officer.get("company", {})
            corp_name= (corp.get("name") or "").lower()
            if full_name.lower() in name and co_lower in corp_name:
                items.append(EvidenceItem(
                    provider="OPENCORPORATES",
                    evidence_url=officer.get("opencorporates_url", ""),
                    page_title=f"OpenCorporates — {officer.get('name', full_name)}",
                    snippet=f"Officer at {corp.get('name', company)} | Position: {officer.get('position', '')}",
                    matched_name=full_name,
                    matched_company=corp.get("name", company),
                    matched_role=officer.get("position", ""),
                    match_type="person_company_confirmed",
                    timestamp=now_iso(),
                ))
                return items

        return items
    except Exception as e:
        log.debug("[OPENCORPORATES] failed: %s", e)
        raise


# ── Layer 8: Domain MX validation ────────────────────────────────────────────

def validate_domain_mx(
    session: requests.Session,
    domain: str,
) -> bool:
    """Returns True if domain has active MX records (mail server exists)."""
    if not domain:
        return False
    try:
        r = session.get(
            "https://dns.google/resolve",
            params={"name": domain, "type": "MX"},
            timeout=REQUEST_TIMEOUT,
        )
        r.raise_for_status()
        return bool(r.json().get("Answer"))
    except Exception as e:
        log.debug("[DOMAIN_MX] %s failed: %s", domain, e)
        return False
