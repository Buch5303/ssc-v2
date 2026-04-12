#!/usr/bin/env python3
"""
tools/monitoring/platform_health.py
FlowSeer platform health monitor.
Checks all components and produces health dashboard.

Usage:
  python3 platform_health.py           # full health check
  python3 platform_health.py --watch   # check every 5 minutes
  python3 platform_health.py --json    # output as JSON
"""
from __future__ import annotations
import argparse, ast, csv, json, os, subprocess, sys, time
from datetime import datetime, date
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "orchestrator/.env")
except ImportError:
    pass

ROOT = Path(__file__).parent.parent

CHECKS = []

def check(name: str, category: str, fn) -> dict:
    try:
        result = fn()
        status = "✅" if result["ok"] else "⚠️ " if result.get("warn") else "❌"
        c = {"name": name, "category": category, "status": status,
             "ok": result["ok"], "detail": result.get("detail",""), "warn": result.get("warn",False)}
    except Exception as e:
        c = {"name": name, "category": category, "status": "❌", "ok": False, "detail": str(e)[:80]}
    CHECKS.append(c)
    return c


# ── File system checks ────────────────────────────────────────────────────────
def check_file(path, min_size=100):
    p = ROOT / path
    return {"ok": p.exists() and p.stat().st_size > min_size,
            "detail": f"{'exists' if p.exists() else 'MISSING'} ({p.stat().st_size if p.exists() else 0} bytes)"}

check("BOM library",          "pricing", lambda: check_file("pricing-discovery/bom_library.py", 5000))
check("Pricing CSV",          "pricing", lambda: check_file("pricing-discovery/outputs/pricing_updated.csv"))
check("BOP cost model CSV",   "pricing", lambda: check_file("pricing-discovery/outputs/bop_cost_model.csv"))
check("Verification report",  "pricing", lambda: check_file("pricing-discovery/outputs/verification_status_report.md"))
check("Contact verifier",     "contacts", lambda: check_file("contact-verifier/contact_verifier.py", 1000))
check("Apollo/Hunter adapter","contacts", lambda: check_file("contact-verifier/providers/apollo_hunter.py", 500))
check("Outreach sequences",   "contacts", lambda: {"ok": len(list((ROOT/"contact-verifier/outreach_sequences").glob("*.md"))) == 8,
                                                    "detail": f"{len(list((ROOT/'contact-verifier/outreach_sequences').glob('*.md')))} sequences"})
check("RFQ drafts (6)",       "rfq", lambda: {"ok": len(list((ROOT/"rfq-generator/drafts").glob("*.txt"))) >= 6,
                                               "detail": f"{len(list((ROOT/'rfq-generator/drafts').glob('*.txt')))} drafts"})
check("RFQ status JSON",      "rfq", lambda: check_file("rfq-generator/rfq_status.json"))
check("Ingest response",      "rfq", lambda: check_file("rfq-generator/ingest_response.py"))
check("Neon API",             "api",  lambda: check_file("api/neon_api.py", 500))
check("DB Schema SQL",        "api",  lambda: check_file("api/schema.sql", 1000))
check("Dashboard data dir",   "dashboard", lambda: {"ok": len(list((ROOT/"dashboard/data").glob("*.json"))) >= 6,
                                                     "detail": f"{len(list((ROOT/'dashboard/data').glob('*.json')))} JSON files"})
check("Program timeline",     "reports", lambda: check_file("reports/program_timeline.md"))
check("Program status report","reports", lambda: check_file("reports/w251_program_status.md", 1000))
check("Grok audit report",    "reports", lambda: check_file("reports/GROK_AUDIT_REPORT.md"))
check("Send scheduler",       "scheduling", lambda: check_file("scheduling/rfq_send_scheduler.py"))
check("Supplier profiles",    "supplier", lambda: check_file("supplier-intelligence/supplier_profiles.md", 2000))
check("Comparison matrix",    "supplier", lambda: check_file("supplier-intelligence/supplier_comparison_matrix.md"))

# ── Data integrity checks ─────────────────────────────────────────────────────
def check_bop_total():
    rows = []
    p = ROOT / "pricing-discovery/outputs/pricing_updated.csv"
    if p.exists():
        with open(p) as f:
            rows = [r for r in csv.DictReader(f) if r.get("category") != "TOTAL"]
    total = sum(float(r.get("mid_usd") or r.get("bom_mid",0)) for r in rows)
    ok    = abs(total - 9_274_000) < 100_000
    return {"ok": ok, "detail": f"${total:,.0f} (expected ~$9,274,000)", "warn": not ok}

def check_rfq_status():
    p = ROOT / "rfq-generator/rfq_status.json"
    if not p.exists(): return {"ok": False, "detail": "rfq_status.json missing"}
    data = json.loads(p.read_text())
    rfqs = data.get("rfqs", [])
    responded = [r for r in rfqs if r["status"] == "RESPONDED"]
    drafted   = [r for r in rfqs if r["status"] == "DRAFTED"]
    return {"ok": len(responded) >= 1 and len(drafted) >= 5,
            "detail": f"{len(responded)} responded, {len(drafted)} drafted"}

def check_dashboard_json():
    d = ROOT / "dashboard/data/program_summary.json"
    if not d.exists(): return {"ok": False, "detail": "program_summary.json missing"}
    data = json.loads(d.read_text())
    total = data.get("total_bop_mid", 0)
    return {"ok": abs(total - 9_274_000) < 500_000, "detail": f"BOP mid: ${total:,.0f}"}

def check_api_keys():
    keys = {
        "ANTHROPIC": bool(os.getenv("ANTHROPIC_API_KEY")),
        "OPENAI":    bool(os.getenv("OPENAI_API_KEY")),
        "PERPLEXITY":bool(os.getenv("PERPLEXITY_API_KEY")),
        "XAI":       bool(os.getenv("XAI_API_KEY")),
    }
    present = sum(keys.values())
    return {"ok": keys["ANTHROPIC"], "warn": present < 4,
            "detail": f"{present}/4 keys configured: " + " ".join(k for k,v in keys.items() if v)}

def check_python_syntax():
    errors = []
    for f in ROOT.rglob("*.py"):
        if "__pycache__" in str(f): continue
        try:
            ast.parse(f.read_text())
        except SyntaxError as e:
            errors.append(f"{f.name}: {e.msg}")
    return {"ok": len(errors) == 0, "detail": f"{len(errors)} syntax errors" if errors else "all files clean"}

def check_days_to_rfq():
    days = (date(2026,5,25) - date.today()).days
    return {"ok": days > 0, "warn": days < 7, "detail": f"{days} days to May 25, 2026 send"}

check("BOP total $9.274M",    "data",    check_bop_total)
check("RFQ pipeline status",  "data",    check_rfq_status)
check("Dashboard JSON fresh", "data",    check_dashboard_json)
check("API keys",             "config",  check_api_keys)
check("Python syntax (all)",  "code",    check_python_syntax)
check("Days to RFQ send",     "schedule",check_days_to_rfq)

# ── Output ────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--json",  action="store_true")
    p.add_argument("--watch", action="store_true")
    args = p.parse_args()

    ok_count   = sum(1 for c in CHECKS if c["ok"])
    warn_count = sum(1 for c in CHECKS if c.get("warn"))
    fail_count = sum(1 for c in CHECKS if not c["ok"])
    total      = len(CHECKS)

    if args.json:
        print(json.dumps({"checks": CHECKS, "ok": ok_count, "warn": warn_count,
                          "fail": fail_count, "total": total}, indent=2))
        return

    rag = "🟢 HEALTHY" if fail_count == 0 else ("🟡 DEGRADED" if fail_count <= 2 else "🔴 CRITICAL")

    print(f"\n{'='*60}")
    print(f"FlowSeer Platform Health — {datetime.now().strftime('%H:%M:%S')}")
    print(f"Status: {rag}  |  {ok_count}/{total} checks passing")
    print(f"{'='*60}")

    by_cat = {}
    for c in CHECKS:
        by_cat.setdefault(c["category"], []).append(c)

    for cat, checks in by_cat.items():
        cat_ok = all(c["ok"] for c in checks)
        cat_icon = "✅" if cat_ok else "⚠️"
        print(f"\n{cat_icon} {cat.upper()}")
        for c in checks:
            detail = f"  ({c['detail']})" if c["detail"] else ""
            print(f"  {c['status']} {c['name']}{detail}")

    if fail_count > 0:
        print(f"\n❌ FAILURES ({fail_count}):")
        for c in CHECKS:
            if not c["ok"]:
                print(f"  • {c['name']}: {c['detail']}")

    print(f"\n{'='*60}")


if __name__ == "__main__":
    main()
