# FlowSeer SSC V2 — Tools Directory
**Platform:** Project Jupiter W251B8 BOP Intelligence
**Version:** 2.1.0 | **Grok Audit:** PASS 102/102
**Last Updated:** April 12, 2026

---

## Quick Start

```bash
# 1. Start the orchestrator (autonomous build loop)
cd tools/orchestrator
python3 go.py

# 2. Check platform health
python3 tools/monitoring/platform_health.py

# 3. Run pricing discovery
python3 tools/pricing-discovery/pricing_discovery.py --dry-run

# 4. Check RFQ send status
python3 tools/scheduling/rfq_send_scheduler.py --status

# 5. Initialize database
python3 tools/api/init_db.py --check

# 6. Start live API server
pip install fastapi uvicorn --break-system-packages
uvicorn tools/api/neon_api:app --host 0.0.0.0 --port 8000
```

---

## Directory Structure

```
tools/
├── orchestrator/          # Four-agent autonomous build pipeline
│   ├── go.py              # ← START HERE — single command reset + launch
│   ├── orchestrator.py    # Main loop (parallel dual-track v2.1)
│   ├── agents/            # ChatGPT, Perplexity, Claude, Grok adapters
│   ├── state/             # Session state, directive queue, audit log
│   └── .env               # API keys (gitignored)
│
├── pricing-discovery/     # W251 BOP pricing engine
│   ├── pricing_discovery.py   # Main runner (19 categories, $9.274M)
│   ├── bom_library.py         # Component BOM data
│   ├── outputs/               # CSV, MD, JSON reports
│   └── providers/             # FERC, USASpending, Google CSE, Perplexity
│
├── contact-verifier/      # Contact enrichment pipeline
│   ├── contact_verifier.py    # 10-layer free-first pipeline
│   ├── run_enrichment.py      # Batch runner for all 231 contacts
│   └── outreach_sequences/    # 8 three-touch C-suite email sequences
│
├── rfq-generator/         # RFQ pipeline management
│   ├── drafts/                # 6 RFQ drafts ready for May 25 send
│   ├── rfq_status.json        # Pipeline status (1 responded, 6 drafted)
│   └── ingest_response.py     # Ingest new RFQ responses
│
├── api/                   # Live data API layer
│   ├── neon_api.py            # FastAPI server (6 endpoints)
│   ├── schema.sql             # Neon DB schema + seed data
│   └── init_db.py             # Database initialization
│
├── dashboard/             # Frontend data bridge
│   ├── generate_dashboard_data.py  # Generates 6 JSON data files
│   └── data/                  # JSON files consumed by frontend
│
├── scheduling/            # RFQ send management
│   └── rfq_send_scheduler.py  # May 25 send plan + pre-send checklist
│
├── budget/                # Financial tracking
│   └── budget_variance_tracker.py  # Actual vs. estimate analysis
│
├── monitoring/            # Platform health
│   └── platform_health.py     # 25-check health monitor
│
├── supplier-intelligence/ # Supplier research
│   ├── supplier_profiles.md       # 10 strategic supplier profiles
│   └── supplier_comparison_matrix.md  # 6 categories head-to-head
│
├── reports/               # Generated intelligence reports
│   ├── w251_program_status.md     # Boardroom-ready program brief
│   ├── program_timeline.md        # Phase 1-6, May 25 RFQ date
│   ├── weekly_status_report.md    # RAG scorecard
│   └── GROK_AUDIT_REPORT.md      # Audit results PASS 102/102
│
└── BUILD_MANIFEST.json    # Platform manifest — single source of truth
```

---

## Key Dates

| Date | Event |
|------|-------|
| Apr 10, 2026 | Baker Hughes VIB_MON quoted at $340K |
| Apr 11, 2026 | Platform build complete, Grok audit PASS |
| May 1, 2026  | EthosEnergy ICD deadline (critical path) |
| **May 25, 2026** | **🚀 ALL RFQs SENT (7 packages, $3.28M)** |
| Jun-Jul 2026 | Supplier response window |
| Aug 15, 2026 | Target PO awards |
| Q2 2027 | First power |

---

## Adding New Directives

Edit `tools/orchestrator/directive_queue.json` and add:

```json
{
  "id": "D75-001",
  "title": "What you want built",
  "task": "Plain English description",
  "priority": 1,
  "depends_on": [],
  "context": "Background info"
}
```

The orchestrator picks it up automatically on the next cycle.

---
*FlowSeer SSC V2 | Project Jupiter | Trans World Power*
