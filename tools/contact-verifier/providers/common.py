"""
providers/common.py — FlowSeer Contact Verifier
Shared utilities for all provider adapters.
No external dependencies beyond stdlib + requests.
"""
from __future__ import annotations

import re
import time
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)

REQUEST_TIMEOUT     = 20
SLEEP_BETWEEN_CALLS = 1.0
SLEEP_GOOGLE        = 1.2


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_get(d: Dict[str, Any], key: str, default: str = "") -> str:
    v = d.get(key, default)
    return str(v).strip() if v is not None else default


def normalize_domain(raw: str) -> str:
    d = raw.strip().lower()
    d = re.sub(r"^https?://", "", d)
    d = re.sub(r"^www\.", "", d)
    return d.split("/")[0]


def infer_email_patterns(first: str, last: str, domain: str) -> List[str]:
    """Standard email pattern inference from name + domain."""
    if not (domain and first and last):
        return []
    fn = re.sub(r"[^a-z]", "", first.lower())
    ln = re.sub(r"[^a-z]", "", last.lower())
    fi, li = fn[:1], ln[:1]
    seen: set[str] = set()
    out: List[str] = []
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


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = "FlowSeerContactVerifier/2.0 (contact-research@flowseer.ai)"
    s.headers["Accept"]     = "application/json"
    return s


def safe_get_nested(obj: Any, *keys: str, default: str = "") -> str:
    """Safely traverse nested dicts."""
    for key in keys:
        if not isinstance(obj, dict):
            return default
        obj = obj.get(key)
    return str(obj).strip() if obj is not None else default
