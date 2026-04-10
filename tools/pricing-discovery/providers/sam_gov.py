"""
providers/sam_gov.py — FlowSeer Pricing Discovery Engine
Federal contract award search via USASpending.gov API (free, no key).
Finds government procurement awards for BOP equipment categories.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional

import requests

from models import PricingEvidence, VECTOR_UTILITY, CONF_PUBLIC_CONTRACT, CONFIDENCE_SCORES
from providers.common import REQUEST_TIMEOUT, SLEEP, now_iso, safe_get, extract_dollar_amounts

log = logging.getLogger(__name__)

USASPENDING_URL = "https://api.usaspending.gov/api/v2/search/spending_by_award/"


def search_usaspending(
    session: requests.Session,
    keywords: List[str],
    category_name: str,
) -> List[PricingEvidence]:
    """
    Search USASpending.gov for federal contract awards matching BOP equipment keywords.
    Free API — no key required.
    Returns list of PricingEvidence items.
    """
    evidence: List[PricingEvidence] = []

    payload = {
        "filters": {
            "keywords": keywords,
            "award_type_codes": ["A", "B", "C", "D"],  # contracts only
            "time_period": [{"start_date": "2015-01-01", "end_date": "2026-01-01"}],
        },
        "fields": [
            "Award ID", "Recipient Name", "Award Amount",
            "Description", "Period of Performance Start Date",
            "Awarding Agency Name", "NAICS Code",
        ],
        "sort": "Award Amount",
        "order": "desc",
        "limit": 10,
        "page": 1,
    }

    try:
        r = session.post(USASPENDING_URL, json=payload, timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        time.sleep(SLEEP)
        results = r.json().get("results", [])

        for award in results:
            amount = 0.0
            try:
                amount = float(str(award.get("Award Amount", "0")).replace(",", "").replace("$", ""))
            except (ValueError, TypeError):
                pass

            if amount < 10_000:  # skip tiny awards
                continue

            year = 0
            date_str = award.get("Period of Performance Start Date", "")
            if date_str and len(date_str) >= 4:
                try:
                    year = int(date_str[:4])
                except ValueError:
                    pass

            evidence.append(PricingEvidence(
                vector=VECTOR_UTILITY,
                provider="USASPENDING",
                source_name=f"USASpending — {award.get('Awarding Agency Name', 'Federal Agency')}",
                evidence_url=f"https://www.usaspending.gov/award/{award.get('Award ID', '')}",
                raw_value_usd=amount,
                normalized_value_usd=amount,
                year_of_data=year,
                confidence_label=CONF_PUBLIC_CONTRACT,
                confidence_score=CONFIDENCE_SCORES[CONF_PUBLIC_CONTRACT],
                snippet=f"Recipient: {award.get('Recipient Name', '')} | {award.get('Description', '')[:200]}",
                timestamp=now_iso(),
                notes=f"Federal contract award for {category_name}",
            ))

    except Exception as e:
        log.debug("[USASPENDING] failed: %s", e)
        raise

    return evidence


def build_bop_keywords(category_name: str, suppliers: List[str]) -> List[str]:
    """Build keyword list for USASpending search from category and supplier names."""
    keywords = []
    # Category keywords
    words = category_name.replace("/", " ").replace("(", "").replace(")", "").split()
    keywords.extend([w for w in words if len(w) > 3])
    # Add "gas turbine" context
    keywords.append("gas turbine")
    # Add top 2 suppliers
    keywords.extend(suppliers[:2])
    return list(set(keywords))[:8]  # USASpending prefers shorter keyword lists
