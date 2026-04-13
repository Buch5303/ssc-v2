"""
providers/supplier_catalogs.py — FlowSeer Pricing Discovery Engine
Google CSE targeted at OEM supplier sites for catalog/budgetary pricing.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List

import requests

from models import PricingEvidence, VECTOR_TRADE, CONF_SUPPLIER_CATALOG, CONFIDENCE_SCORES
from providers.common import REQUEST_TIMEOUT, SLEEP, now_iso, extract_dollar_amounts

log = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID  = os.getenv("GOOGLE_CSE_ID", "")
SLEEP_GOOGLE   = 1.2


def google_catalog_search(
    session: requests.Session,
    queries: List[str],
    category_name: str,
    suppliers: List[str],
) -> List[PricingEvidence]:
    """
    Run targeted Google CSE queries against OEM supplier sites.
    Focus: catalog pricing, budgetary pricing, list price PDFs.
    """
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        return []

    evidence: List[PricingEvidence] = []

    for query in queries:
        try:
            r = session.get(
                "https://www.googleapis.com/customsearch/v1",
                params={
                    "key": GOOGLE_API_KEY,
                    "cx": GOOGLE_CSE_ID,
                    "q": query,
                    "num": 5,
                },
                timeout=REQUEST_TIMEOUT,
            )
            r.raise_for_status()
            time.sleep(SLEEP_GOOGLE)
            items = r.json().get("items", [])

            for item in items:
                title   = item.get("title", "")
                snippet = item.get("snippet", "")
                link    = item.get("link", "")
                text    = title + " " + snippet

                amounts = extract_dollar_amounts(text)
                amounts = [a for a in amounts if 5_000 <= a <= 20_000_000]

                if not amounts:
                    continue

                # Determine which supplier matched
                matched_supplier = next(
                    (s for s in suppliers if s.lower() in text.lower()), ""
                )

                amount = sorted(amounts)[len(amounts) // 2]

                evidence.append(PricingEvidence(
                    vector=VECTOR_TRADE,
                    provider="GOOGLE_CATALOG",
                    source_name=f"Supplier catalog — {matched_supplier or 'OEM'}",
                    evidence_url=link,
                    raw_value_usd=amount,
                    normalized_value_usd=amount,
                    year_of_data=_year_from_snippet(snippet),
                    confidence_label=CONF_SUPPLIER_CATALOG,
                    confidence_score=CONFIDENCE_SCORES[CONF_SUPPLIER_CATALOG],
                    snippet=f"{title} | {snippet[:200]}",
                    timestamp=now_iso(),
                    notes=f"OEM catalog pricing for {category_name} — query: {query[:80]}",
                ))

        except Exception as e:
            log.debug("[GOOGLE_CATALOG] query failed: %s", e)
            raise

    return evidence


def _year_from_snippet(text: str) -> int:
    import re
    matches = re.findall(r'\b(20\d{2})\b', text)
    return int(matches[0]) if matches else 2023
