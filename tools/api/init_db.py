#!/usr/bin/env python3
"""
tools/api/init_db.py
Initialize the Neon PostgreSQL database with FlowSeer schema and seed data.

Usage:
  python3 init_db.py           # run full schema + seed
  python3 init_db.py --check   # verify connection and row counts
"""
import os, argparse
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / "orchestrator" / ".env")
except ImportError:
    pass

try:
    import psycopg2
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

DATABASE_URL = os.getenv("DATABASE_URL", "")
SCHEMA_FILE  = Path(__file__).parent / "schema.sql"


def check():
    if not DATABASE_URL:
        print("❌ DATABASE_URL not set in .env")
        return False
    if not HAS_PSYCOPG2:
        print("❌ psycopg2 not installed: pip install psycopg2-binary --break-system-packages")
        return False
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        cur.execute("SELECT version()")
        ver = cur.fetchone()[0]
        print(f"✅ Connected: {ver[:50]}")

        for table in ["contacts","suppliers","bop_pricing","rfq_pipeline","program_events"]:
            try:
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                count = cur.fetchone()[0]
                print(f"   {table}: {count} rows")
            except:
                print(f"   {table}: not found")
        conn.close()
        return True
    except Exception as e:
        print(f"❌ Connection failed: {e}")
        return False


def init():
    if not check():
        return
    sql = SCHEMA_FILE.read_text()
    try:
        conn = psycopg2.connect(DATABASE_URL)
        cur  = conn.cursor()
        cur.execute(sql)
        conn.commit()
        conn.close()
        print("\n✅ Schema initialized and seed data loaded")
    except Exception as e:
        print(f"❌ Init failed: {e}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    if args.check:
        check()
    else:
        init()
