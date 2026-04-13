#!/usr/bin/env python3
"""
tools/api/init_db.py
Plug-and-play Neon PostgreSQL initializer.
Run once after adding DATABASE_URL to tools/orchestrator/.env

Usage:
  python3 init_db.py --check      # test connection only
  python3 init_db.py              # full schema + seed data
  python3 init_db.py --sync       # sync current CSV/JSON data to DB

Steps to activate live DB:
  1. Go to neon.tech — create a free project
  2. Copy the connection string
  3. Add to tools/orchestrator/.env:
        DATABASE_URL=postgresql://user:pass@host/dbname
  4. Run: python3 tools/api/init_db.py
  5. Run: python3 tools/flowseer.py refresh
"""
from __future__ import annotations
import csv, json, os, sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "orchestrator/.env")
except ImportError:
    pass

DATABASE_URL = os.getenv("DATABASE_URL","")
SCHEMA_FILE  = Path(__file__).parent / "schema.sql"
ROOT         = Path(__file__).parent.parent

try:
    import psycopg2
    HAS_PG = True
except ImportError:
    HAS_PG = False


def check():
    if not DATABASE_URL:
        print("❌ DATABASE_URL not set")
        print("   Add to tools/orchestrator/.env:")
        print("   DATABASE_URL=postgresql://user:pass@host/dbname")
        print("   Get a free database at: https://neon.tech")
        return False
    if not HAS_PG:
        print("❌ psycopg2 not installed")
        print("   Run: pip install psycopg2-binary --break-system-packages")
        return False
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        cur.execute("SELECT version()")
        ver = cur.fetchone()[0]
        print(f"✅ Connected to Neon PostgreSQL")
        print(f"   {ver[:60]}")
        for table in ["contacts","bop_pricing","rfq_pipeline","program_events"]:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"   {table:<20} {count:>5} rows")
            except:
                print(f"   {table:<20}  not found (run init)")
        conn.close()
        return True
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False


def init():
    if not check(): return
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        cur.execute(SCHEMA_FILE.read_text())
        conn.commit()
        conn.close()
        print("\n✅ Schema created and seed data loaded")
        print("   Run: python3 tools/flowseer.py refresh  to update dashboard")
    except Exception as e:
        print(f"❌ Init failed: {e}")


def sync_contacts():
    """Push enriched contacts CSV to Neon DB."""
    p = ROOT / "contact-verifier/outputs/contacts_enriched.csv"
    if not p.exists():
        print("Run enrichment first: python3 tools/contact-verifier/run_enrichment.py")
        return
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        with open(p) as f:
            rows = list(csv.DictReader(f))
        inserted = 0
        for r in rows:
            try:
                cur.execute("""
                    INSERT INTO contacts (full_name, company, company_domain, title, email,
                        linkedin_url, priority, category, rfq_status, verification_status,
                        verification_score, notes)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT DO NOTHING
                """, (
                    r.get("full_name"), r.get("company"), r.get("company_domain"),
                    r.get("title"), r.get("email"), r.get("linkedin_url"),
                    r.get("priority"), r.get("category"), r.get("rfq_status"),
                    r.get("verification_status"), r.get("verification_score"), r.get("notes"),
                ))
                inserted += 1
            except Exception as e:
                print(f"  Skip {r.get('full_name')}: {e}")
        conn.commit()
        conn.close()
        print(f"✅ {inserted} contacts synced to Neon DB")
    except Exception as e:
        print(f"❌ Sync failed: {e}")


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--sync",  action="store_true")
    args = p.parse_args()

    if args.check:
        check()
    elif args.sync:
        if check():
            sync_contacts()
    else:
        init()


if __name__ == "__main__":
    main()
