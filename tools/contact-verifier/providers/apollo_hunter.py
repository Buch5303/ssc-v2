#!/usr/bin/env python3
"""
tools/contact-verifier/providers/apollo_hunter.py
Apollo.io + Hunter.io contact enrichment adapters.
Both require paid API keys. Free tiers available.

Apollo Basic: $49/mo — 1,000 enrichments/mo
Hunter Free:  25 searches/mo
Hunter Starter: $34/mo — 500 searches/mo

Usage (once keys are in .env):
  from providers.apollo_hunter import enrich_contact_apollo, verify_email_hunter
  result = enrich_contact_apollo("Lorenzo Simonelli", "bakerhughes.com")
  email  = verify_email_hunter("lorenzo.simonelli@bakerhughes.com")
"""
from __future__ import annotations
import os, time, logging
import requests

log = logging.getLogger("enrichment.apollo_hunter")

APOLLO_KEY = os.getenv("APOLLO_API_KEY", "")
HUNTER_KEY = os.getenv("HUNTER_API_KEY", "")


# ─── APOLLO ───────────────────────────────────────────────────────────────────

def enrich_contact_apollo(full_name: str, domain: str) -> dict:
    """
    Enrich a contact using Apollo.io People Match API.
    Returns enriched contact dict or empty dict if not found.
    Requires APOLLO_API_KEY.
    """
    if not APOLLO_KEY:
        log.info("APOLLO_API_KEY not set — skipping Apollo enrichment")
        return {}

    first, *rest = full_name.split()
    last = rest[-1] if rest else ""

    try:
        r = requests.post(
            "https://api.apollo.io/v1/people/match",
            headers={"Content-Type": "application/json", "Cache-Control": "no-cache"},
            json={
                "api_key":    APOLLO_KEY,
                "first_name": first,
                "last_name":  last,
                "domain":     domain,
                "reveal_personal_emails": False,
            },
            timeout=15,
        )
        if r.status_code == 200:
            person = r.json().get("person", {})
            if person:
                return {
                    "email":        person.get("email", ""),
                    "phone":        person.get("phone_numbers", [{}])[0].get("raw_number", "") if person.get("phone_numbers") else "",
                    "title":        person.get("title", ""),
                    "linkedin_url": person.get("linkedin_url", ""),
                    "city":         person.get("city", ""),
                    "state":        person.get("state", ""),
                    "source":       "apollo",
                }
    except Exception as e:
        log.warning("Apollo enrichment failed for %s: %s", full_name, e)

    return {}


def search_contacts_apollo(domain: str, titles: list = None, limit: int = 10) -> list:
    """
    Search for contacts at a company by domain.
    Useful for finding additional contacts beyond known individuals.
    """
    if not APOLLO_KEY:
        return []

    try:
        r = requests.post(
            "https://api.apollo.io/v1/mixed_people/search",
            headers={"Content-Type": "application/json"},
            json={
                "api_key":          APOLLO_KEY,
                "q_organization_domains": [domain],
                "person_titles":    titles or ["CEO","President","EVP","Vice President","Director"],
                "per_page":         min(limit, 25),
            },
            timeout=15,
        )
        if r.status_code == 200:
            people = r.json().get("people", [])
            return [{
                "full_name":    p.get("name",""),
                "email":        p.get("email",""),
                "title":        p.get("title",""),
                "linkedin_url": p.get("linkedin_url",""),
                "source":       "apollo_search",
            } for p in people]
    except Exception as e:
        log.warning("Apollo search failed for %s: %s", domain, e)

    return []


# ─── HUNTER ───────────────────────────────────────────────────────────────────

def verify_email_hunter(email: str) -> dict:
    """
    Verify an email address using Hunter.io Email Verifier.
    Returns verification result dict.
    Requires HUNTER_API_KEY.
    """
    if not HUNTER_KEY:
        log.info("HUNTER_API_KEY not set — skipping Hunter verification")
        return {"status": "unknown", "source": "no_key"}

    try:
        r = requests.get(
            "https://api.hunter.io/v2/email-verifier",
            params={"email": email, "api_key": HUNTER_KEY},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json().get("data", {})
            return {
                "email":      email,
                "status":     data.get("status","unknown"),     # valid | invalid | accept_all | unknown
                "score":      data.get("score", 0),
                "disposable": data.get("disposable", False),
                "webmail":    data.get("webmail", False),
                "source":     "hunter_verify",
            }
    except Exception as e:
        log.warning("Hunter verify failed for %s: %s", email, e)

    return {"email": email, "status": "unknown", "source": "hunter_error"}


def find_email_hunter(first: str, last: str, domain: str) -> dict:
    """
    Find email address for a person at a company using Hunter.io Email Finder.
    """
    if not HUNTER_KEY:
        return {}

    try:
        r = requests.get(
            "https://api.hunter.io/v2/email-finder",
            params={"first_name": first, "last_name": last,
                    "domain": domain, "api_key": HUNTER_KEY},
            timeout=15,
        )
        if r.status_code == 200:
            data = r.json().get("data", {})
            if data.get("email"):
                return {
                    "email":       data["email"],
                    "score":       data.get("score", 0),
                    "sources":     len(data.get("sources", [])),
                    "source":      "hunter_finder",
                }
    except Exception as e:
        log.warning("Hunter finder failed for %s %s @ %s: %s", first, last, domain, e)

    return {}


# ─── COMBINED ENRICHMENT ──────────────────────────────────────────────────────

def enrich_contact_full(contact: dict) -> dict:
    """
    Run full enrichment pipeline: Apollo → Hunter verify/find.
    Returns enriched contact dict.
    """
    name   = contact.get("full_name", "")
    domain = contact.get("company_domain", "")
    email  = contact.get("email", "")

    result = {**contact}
    time.sleep(0.5)   # rate limit courtesy delay

    # Apollo enrichment
    if domain:
        apollo = enrich_contact_apollo(name, domain)
        if apollo:
            result.update(apollo)

    # Hunter email find (if no email from Apollo)
    if not result.get("email") and domain:
        parts = name.split()
        if len(parts) >= 2:
            hunter = find_email_hunter(parts[0], parts[-1], domain)
            if hunter:
                result["email"]  = hunter.get("email","")
                result["source"] = "hunter_finder"

    # Hunter email verify (if we have an email)
    if result.get("email"):
        verify = verify_email_hunter(result["email"])
        result["email_status"] = verify.get("status","unknown")
        result["email_score"]  = verify.get("score", 0)

    return result
