"""
providers/perplexity.py — FlowSeer Pricing Discovery Engine
Perplexity AI synthesis layer — key-gated, used last.
Synthesizes web evidence into a structured price estimate with citations.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

import requests

from models import PricingEvidence, VECTOR_SYNTHESIS, CONF_PERPLEXITY, CONFIDENCE_SCORES
from providers.common import REQUEST_TIMEOUT, SLEEP, now_iso, extract_dollar_amounts

log = logging.getLogger(__name__)

PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY", "")
PERPLEXITY_URL     = "https://api.perplexity.ai/chat/completions"


def perplexity_available() -> bool:
    return bool(PERPLEXITY_API_KEY)


def perplexity_price_synthesis(
    session: requests.Session,
    category_name: str,
    bom_description: str,
    suppliers: List[str],
    search_context: str = "",
) -> List[PricingEvidence]:
    """
    Ask Perplexity to synthesize current web pricing for a BOP category.
    Uses sonar-medium-online model for web-grounded responses.
    Only called when free sources haven't resolved high confidence.
    """
    if not perplexity_available():
        return []

    supplier_str = ", ".join(suppliers[:4])
    prompt = f"""You are an industrial equipment cost estimator specializing in gas turbine power plant procurement.

Research and provide a current market pricing estimate for the following equipment:

Equipment Category: {category_name}
Application: 50MW class industrial gas turbine (Westinghouse W251B8 or equivalent)
Key Suppliers: {supplier_str}

Component scope: {bom_description}

Please provide:
1. Low / Mid / High price range in USD (installed, not just equipment)
2. Primary source or basis for your estimate
3. Year of price data
4. Any key assumptions

Format your response as:
LOW: $XXX,XXX
MID: $XXX,XXX  
HIGH: $XXX,XXX
BASIS: [source description]
YEAR: [year]
NOTES: [any caveats]"""

    try:
        r = session.post(
            PERPLEXITY_URL,
            headers={
                "Authorization": f"Bearer {PERPLEXITY_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "sonar-medium-online",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 500,
                "temperature": 0.1,
            },
            timeout=REQUEST_TIMEOUT * 2,
        )
        r.raise_for_status()
        time.sleep(SLEEP)

        content = r.json()["choices"][0]["message"]["content"]
        amounts = extract_dollar_amounts(content)
        amounts = [a for a in amounts if 10_000 <= a <= 50_000_000]

        if not amounts:
            return []

        amounts = sorted(amounts)
        mid = amounts[len(amounts) // 2]

        return [PricingEvidence(
            vector=VECTOR_SYNTHESIS,
            provider="PERPLEXITY",
            source_name="Perplexity AI web synthesis",
            evidence_url="https://www.perplexity.ai",
            raw_value_usd=mid,
            normalized_value_usd=mid,
            year_of_data=2024,
            confidence_label=CONF_PERPLEXITY,
            confidence_score=CONFIDENCE_SCORES[CONF_PERPLEXITY],
            snippet=content[:500],
            timestamp=now_iso(),
            notes=f"Perplexity web synthesis for {category_name}",
        )]

    except Exception as e:
        log.debug("[PERPLEXITY] failed: %s", e)
        raise
