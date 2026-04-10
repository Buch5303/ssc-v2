"""
providers/common.py — Shared utilities for pricing discovery providers.
"""
from __future__ import annotations
import re, time, logging
from datetime import datetime, timezone
from typing import Any, Dict, List
import requests

log = logging.getLogger(__name__)
REQUEST_TIMEOUT = 25
SLEEP = 1.2

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = "FlowSeerPricingDiscovery/1.0 (pricing-research@flowseer.ai)"
    s.headers["Accept"] = "application/json"
    return s

def safe_get(d: Dict[str, Any], key: str, default: str = "") -> str:
    v = d.get(key, default)
    return str(v).strip() if v is not None else default

def extract_dollar_amounts(text: str) -> List[float]:
    """Extract dollar amounts from text — handles $1.2M, $450K, $12,000,000 formats."""
    amounts = []
    # Match $X.XM or $XM (millions)
    for m in re.finditer(r'\$\s*(\d+(?:\.\d+)?)\s*[Mm](?:illion)?', text):
        amounts.append(float(m.group(1)) * 1_000_000)
    # Match $XK or $X,XXX
    for m in re.finditer(r'\$\s*(\d+(?:\.\d+)?)\s*[Kk](?:illion)?', text):
        amounts.append(float(m.group(1)) * 1_000)
    # Match $X,XXX,XXX (with commas)
    for m in re.finditer(r'\$\s*([\d,]+)', text):
        val = float(m.group(1).replace(',', ''))
        if val >= 1000:  # ignore tiny numbers
            amounts.append(val)
    return sorted(set(amounts))

def dollar_to_float(text: str) -> float:
    """Convert single dollar string to float."""
    vals = extract_dollar_amounts(text)
    return vals[0] if vals else 0.0
