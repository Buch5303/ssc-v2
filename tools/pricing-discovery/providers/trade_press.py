"""
providers/trade_press.py — FlowSeer Pricing Discovery Engine
Directive 53.1 — Block B

Trade press search adapter.
Targeted Google CSE search against known industrial/power trade publications.

Target publications:
  - Power Magazine (powermag.com)
  - Gas Turbine World (gasturbineworld.com)
  - Turbomachinery International (turbomachinerymag.com)
  - Power Engineering (power-eng.com)
  - Diesel & Gas Turbine Worldwide (dieselgasturbine.com)
  - POWER (powergrid.com)
"""
from __future__ import annotations

import logging
import os
import time
from typing import List

import requests

from models import PricingEvidence, VECTOR_TRADE, CONF_MARKET_ANCHOR, CONFIDENCE_SCORES
from providers.common import (
    REQUEST_TIMEOUT, SLEEP, now_iso, extract_dollar_amounts, safe_get
)

log = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID  = os.getenv("GOOGLE_CSE_ID", "")

# Known trade publication domains for targeted search
TRADE_DOMAINS = [
    "powermag.com",
    "gasturbineworld.com",
    "turbomachinerymag.com",
    "power-eng.com",
    "powergrid.com",
    "ogj.com",            # Oil & Gas Journal
    "hpac.com",           # Heating, Piping, Air Conditioning
]


def trade_press_search(
    session: requests.Session,
    category_name: str,
    search_terms: List[str],
    suppliers: List[str],
) -> List[PricingEvidence]:
    """
    Search trade publications for project cost announcements,
    equipment pricing references, and installation cost data.
    """
    if not (GOOGLE_API_KEY and GOOGLE_CSE_ID):
        return []

    evidence: List[PricingEvidence] = []

    # Build trade-press-specific queries
    trade_queries = [
        f'"gas turbine" "balance of plant" "{category_name}" cost OR price',
        f'"{category_name}" "gas turbine" project cost site:{" OR site:".join(TRADE_DOMAINS[:3])}',
        f'"W251" OR "50MW" "{category_name}" cost OR price',
    ]

    # Add supplier-specific queries
    for supplier in suppliers[:2]:
        trade_queries.append(f'"{supplier}" "{category_name}" project cost')

    for query in trade_queries[:4]:  # max 4 queries per category
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
            time.sleep(SLEEP)
            items = r.json().get("items", [])

            for item in items:
                title   = safe_get(item, "title")
                snippet = safe_get(item, "snippet")
                link    = safe_get(item, "link")
                text    = title + " " + snippet

                # Only use results from trade domains
                is_trade = any(domain in link for domain in TRADE_DOMAINS)
                if not is_trade:
                    continue

                amounts = extract_dollar_amounts(text)
                amounts = [a for a in amounts if 10_000 <= a <= 30_000_000]
                if not amounts:
                    continue

                amount = sorted(amounts)[len(amounts) // 2]

                # Determine publication name
                pub_name = next((d.split(".")[0].title() for d in TRADE_DOMAINS if d in link), "Trade Press")

                evidence.append(PricingEvidence(
                    vector=VECTOR_TRADE,
                    provider="TRADE_PRESS",
                    source_name=f"{pub_name} — {category_name}",
                    evidence_url=link,
                    raw_value_usd=amount,
                    normalized_value_usd=amount,
                    year_of_data=_year_from_text(text),
                    confidence_label=CONF_MARKET_ANCHOR,
                    confidence_score=CONFIDENCE_SCORES[CONF_MARKET_ANCHOR],
                    snippet=f"{title} | {snippet[:200]}",
                    timestamp=now_iso(),
                    notes=f"Trade press reference for {category_name}",
                ))

        except Exception as e:
            log.debug("[TRADE_PRESS] query failed: %s — %s", query, e)
            raise

    return evidence


def _year_from_text(text: str) -> int:
    import re
    matches = re.findall(r'\b(20\d{2})\b', text)
    return int(matches[0]) if matches else 2022
