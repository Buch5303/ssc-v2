#!/usr/bin/env python3
"""
tools/rfq-generator/generate_rfqs.py
FlowSeer RFQ Draft Generator — Project Jupiter W251 BOP
Generates personalized C-suite RFQ emails for W251 BOP suppliers.
"""
import os
from pathlib import Path

DRAFTS_DIR = Path(__file__).parent / "drafts"
DRAFTS_DIR.mkdir(exist_ok=True)

def list_drafts():
    drafts = list(DRAFTS_DIR.glob("*.txt"))
    print(f"RFQ Drafts ({len(drafts)} ready to send):")
    for d in sorted(drafts):
        print(f"  {d.name}")

if __name__ == "__main__":
    list_drafts()
