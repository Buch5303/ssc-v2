"""
tools/pricing-discovery/providers/google_cse.py
Google Custom Search Engine pricing intelligence provider.
Searches trade publications, supplier sites, and procurement databases.

Requires: GOOGLE_API_KEY and GOOGLE_CSE_ID in .env
Free tier: 100 queries/day
"""
from __future__ import annotations
import logging, os, re, time
from typing import Any, Dict, List
import requests

log = logging.getLogger("pricing.google_cse")

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")
GOOGLE_CSE_ID  = os.getenv("GOOGLE_CSE_ID", "")

TRADE_DOMAINS = [
    "powermag.com", "gasturbineworld.com", "turbomachinerymag.com",
    "power-eng.com", "powergrid.com", "ogj.com",
]


def available() -> bool:
    return bool(GOOGLE_API_KEY and GOOGLE_CSE_ID)


def extract_dollar_amounts(text: str) -> List[float]:
    amounts = []
    for pattern, multiplier in [
        (r'\$([\d,]+(?:\.\d+)?)\s*[Mm]illion', 1_000_000),
        (r'\$([\d,]+(?:\.\d+)?)\s*[Kk]', 1_000),
        (r'\$([\d,]+(?:\.\d+)?)', 1),
    ]:
        for m in re.finditer(pattern, text):
            try:
                val = float(m.group(1).replace(',', '')) * multiplier
                if 10_000 <= val <= 50_000_000:
                    amounts.append(val)
            except ValueError:
                pass
    return amounts


def search_pricing(
    category_name: str,
    search_terms: List[str],
    suppliers: List[str],
    max_queries: int = 3,
) -> List[Dict[str, Any]]:
    """Search Google CSE for BOP category pricing data."""
    if not available():
        log.info("Google CSE not configured — skipping (add GOOGLE_API_KEY + GOOGLE_CSE_ID)")
        return []

    queries = [
        f'"gas turbine" "balance of plant" {category_name} cost price',
        f'{" OR ".join(suppliers[:2])} {category_name} budgetary price 2024 2025',
        f'"{category_name}" "50MW" gas turbine installation cost',
    ]

    findings = []
    for query in queries[:max_queries]:
        try:
            r = requests.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"key": GOOGLE_API_KEY, "cx": GOOGLE_CSE_ID,
                        "q": query, "num": 5},
                timeout=15,
            )
            r.raise_for_status()
            items = r.json().get("items", [])
            time.sleep(0.5)

            for item in items:
                text    = f"{item.get('title','')} {item.get('snippet','')}"
                link    = item.get("link", "")
                amounts = extract_dollar_amounts(text)
                if not amounts:
                    continue

                val     = sorted(amounts)[len(amounts)//2]
                is_trade= any(d in link for d in TRADE_DOMAINS)
                conf    = 55 if is_trade else 40

                findings.append({
                    "source":     "GOOGLE_CSE",
                    "url":        link,
                    "value_usd":  val,
                    "confidence": conf,
                    "snippet":    text[:200],
                    "is_trade":   is_trade,
                    "query":      query[:80],
                })
        except Exception as e:
            log.warning("Google CSE query failed: %s", e)
            continue

    log.info("Google CSE: %d findings for %s", len(findings), category_name)
    return findings
