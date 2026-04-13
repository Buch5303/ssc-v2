#!/usr/bin/env python3
"""
tools/api/neon_api.py — FlowSeer Live Data API
FastAPI server connecting Neon PostgreSQL to the dashboard.

Start: uvicorn neon_api:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations
import json, os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from fastapi import FastAPI, Query
    from fastapi.middleware.cors import CORSMiddleware
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "orchestrator" / ".env")
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL", "")
TOOLS_DIR    = Path(__file__).parent.parent

if HAS_FASTAPI:
    app = FastAPI(title="FlowSeer API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


def get_db():
    if not DATABASE_URL or not HAS_PSYCOPG2:
        return None
    try:
        return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    except Exception:
        return None


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text())
    except Exception:
        return {}


def read_csv_as_dicts(path: Path) -> List[Dict]:
    import csv
    try:
        with open(path) as f:
            return list(csv.DictReader(f))
    except Exception:
        return []


if HAS_FASTAPI:
    @app.get("/api/health")
    def health():
        return {"status": "ok", "db": bool(DATABASE_URL), "ts": datetime.utcnow().isoformat()}

    @app.get("/api/contacts")
    def get_contacts(
        priority: Optional[str] = Query(None),
        limit: int = Query(50)
    ):
        conn = get_db()
        if conn:
            try:
                cur = conn.cursor()
                q = "SELECT * FROM contacts"
                params = []
                if priority:
                    q += " WHERE priority = %s"
                    params.append(priority)
                q += f" LIMIT {min(limit, 500)}"
                cur.execute(q, params)
                rows = [dict(r) for r in cur.fetchall()]
                conn.close()
                return {"contacts": rows, "count": len(rows), "source": "neon_db"}
            except Exception as e:
                conn.close()
                return _fallback_contacts(priority, limit, str(e))
        return _fallback_contacts(priority, limit, "no_db")

    def _fallback_contacts(priority, limit, reason):
        rows = read_csv_as_dicts(TOOLS_DIR / "contact-verifier" / "contacts_sample.csv")
        if priority:
            rows = [r for r in rows if r.get("priority") == priority]
        return {"contacts": rows[:limit], "count": len(rows), "source": "csv_fallback", "reason": reason}

    @app.get("/api/contacts/stats")
    def contact_stats():
        conn = get_db()
        if conn:
            try:
                cur = conn.cursor()
                cur.execute("SELECT priority, COUNT(*) as count FROM contacts GROUP BY priority")
                by_priority = {r["priority"]: r["count"] for r in cur.fetchall()}
                cur.execute("SELECT COUNT(*) as total FROM contacts")
                total = cur.fetchone()["total"]
                conn.close()
                return {"total": total, "by_priority": by_priority, "source": "neon_db"}
            except Exception as e:
                conn.close()
        return {"total": 231, "verified": 64, "by_priority": {
            "ACTIVE_RFQ": 2, "TIER1": 12, "NORMAL": 217
        }, "source": "static_estimate"}

    @app.get("/api/pricing")
    def get_pricing():
        rows = read_csv_as_dicts(TOOLS_DIR / "pricing-discovery" / "outputs" / "pricing_updated.csv")
        if not rows:
            rows = read_csv_as_dicts(TOOLS_DIR / "pricing-discovery" / "outputs" / "bop_cost_model.csv")
        total_mid = sum(float(r.get("mid_usd") or r.get("bom_mid", 0)) for r in rows if r.get("category") != "TOTAL")
        return {
            "categories": rows,
            "total_bop_mid": total_mid,
            "category_count": len([r for r in rows if r.get("category") != "TOTAL"]),
            "source": "pricing_csv",
        }

    @app.get("/api/rfq-status")
    def rfq_status():
        data = read_json(TOOLS_DIR / "rfq-generator" / "rfq_status.json")
        rfqs = data.get("rfqs", [])
        return {
            "rfqs": rfqs,
            "total": len(rfqs),
            "by_status": {
                "RESPONDED": len([r for r in rfqs if r["status"] == "RESPONDED"]),
                "DRAFTED":   len([r for r in rfqs if r["status"] == "DRAFTED"]),
                "SENT":      len([r for r in rfqs if r["status"] == "SENT"]),
                "AWARDED":   len([r for r in rfqs if r["status"] == "AWARDED"]),
            },
            "rfq_send_date": "2026-05-25",
            "source": "rfq_status_json",
        }

    @app.get("/api/program-summary")
    def program_summary():
        pricing = get_pricing()
        rfqs    = rfq_status()
        contacts = contact_stats()
        return {
            "program":             "Project Jupiter — 50MW W251B8",
            "location":            "Santa Teresa, NM",
            "client":              "Oracle / OpenAI",
            "gt_supplier":         "EthosEnergy Italia",
            "program_manager":     "Trans World Power",
            "total_bop_mid_usd":   pricing["total_bop_mid"],
            "bop_categories":      pricing["category_count"],
            "total_contacts":      contacts["total"],
            "verified_contacts":   contacts.get("verified", 64),
            "total_rfqs":          rfqs["total"],
            "rfqs_responded":      rfqs["by_status"]["RESPONDED"],
            "rfqs_drafted":        rfqs["by_status"]["DRAFTED"],
            "rfq_send_date":       "2026-05-25",
            "baker_hughes_quote":  340000,
            "baseline_estimate":   9274000,
            "last_updated":        datetime.utcnow().isoformat(),
        }

if __name__ == "__main__":
    if not HAS_FASTAPI:
        print("Install: pip install fastapi uvicorn psycopg2-binary --break-system-packages")
    else:
        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=8000)
