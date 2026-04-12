# FlowSeer Internal User Guide
**Version:** 2.1.0 | **Program:** Project Jupiter W251B8
**Prepared for:** Trans World Power LLC Internal Use

---

## What Is FlowSeer?

FlowSeer is an AI-powered procurement intelligence platform built specifically for the
Project Jupiter W251B8 BOP (Balance of Plant) procurement program. It replaces manual
spreadsheets and ad-hoc tracking with an integrated, always-current intelligence system.

**It handles:**
- BOP pricing across all 19 categories ($9.27M baseline)
- 231 supplier contacts across 73 companies
- 13 RFQ packages totaling $9.9M
- Automated weekly reporting
- Program alerts and critical path tracking
- Award scenario modeling
- Contract template generation

---

## Getting Started (30 seconds)

```bash
# From your repo directory
cd ~/ssc-v2

# See everything at once
python3 tools/flowseer.py status

# Check what needs attention right now
python3 tools/flowseer.py alerts

# See RFQ pipeline
python3 tools/flowseer.py rfq
```

---

## Daily Workflow

### Morning check (30 seconds)
```bash
python3 tools/flowseer.py alerts
```
Shows you what's critical, high, or needs attention today.

### When an RFQ response arrives
```bash
python3 tools/rfq-generator/ingest_response.py \
  --contact "Bob Yeager" \
  --company "Emerson" \
  --category-code FUEL_GAS \
  --quoted-price 685000 \
  --date 2026-06-12
```
This automatically:
- Updates the RFQ pipeline status
- Computes variance vs estimate
- Upgrades category confidence to RFQ_VERIFIED
- Generates cross-category learning signals
- Updates the program dashboard

### Weekly status report
```bash
python3 tools/reports/generate_weekly_report.py
```
Generates a markdown report for the week. Send to team or print for executive review.

---

## Key Commands Reference

| Command | What it does |
|---------|-------------|
| `python3 tools/flowseer.py status` | Full program dashboard |
| `python3 tools/flowseer.py alerts` | Critical items needing action |
| `python3 tools/flowseer.py health` | Platform health (25 checks) |
| `python3 tools/flowseer.py pricing` | All 19 BOP categories |
| `python3 tools/flowseer.py rfq` | 13-package RFQ pipeline |
| `python3 tools/flowseer.py analytics` | Spend + scenario models |
| `python3 tools/flowseer.py icd` | EthosEnergy ICD status |
| `python3 tools/flowseer.py icd escalate` | Generate escalation email |
| `python3 tools/flowseer.py refresh` | Refresh all dashboard data |

---

## RFQ Management

### The 13 RFQ packages (all send May 25, 2026)

| Priority | Supplier | Category | Value | Notes |
|----------|---------|----------|-------|-------|
| 1 | Baker Hughes | VIB_MON | $340K | ✅ RESPONDED — decision needed |
| 2 | GE Vernova | Generator | $2.09M | ⚠️ CRITICAL PATH |
| 3 | Siemens Energy | Generator | $2.09M | ⚠️ Competitive bid |
| 4 | ABB Power | Transformer | $760K | ⚠️ CRITICAL PATH — 52-70 wk |
| 5 | Emerson | Fuel Gas | $700K | Ready to send |
| 6 | Donaldson | Inlet Air | $525K | Ready to send |
| 7 | Donaldson | Controls | $505K | Ready to send |
| 8 | Flowserve | Piping/Valves | $508K | Replaces Trillium AVOID |
| 9 | CECO | Emissions | $892K | Pending NM permit scope |
| 10 | Baker Hughes | Exhaust | $431K | Ready to send |
| 11 | Amerex | Fire Fighting | $229K | Ready to send |
| 12 | Turbotect | Comp Washing | $132K | Ready to send |
| 13 | Siemens | Transformer | $760K | ⚠️ Competitive bid |

### After an RFQ response arrives
1. Run `ingest_response.py` with the quoted price
2. Run `python3 tools/flowseer.py refresh` to update dashboard
3. Run `python3 tools/analytics/award_scenario_modeler.py` to see updated scenarios
4. If price is >15% above estimate, check cross-category learning signals

---

## Critical Path — What Must Happen Before May 25

| Deadline | Action | Owner | Blocker? |
|----------|--------|-------|---------|
| May 1 | EthosEnergy ICD received | Alberto/Dunlop | YES — blocks Transformer, Exhaust, Electrical |
| May 1 | Baker Hughes VIB_MON decision | Greg Buchanan | YES — accept $340K or counter |
| May 15 | Generator RFQs finalized | TWP | No — GE + Siemens drafts ready |
| May 20 | All 13 RFQ packages reviewed | Greg Buchanan | No |
| **May 25** | **All RFQs sent** | **Greg Buchanan** | **— FIXED DATE —** |

### If EthosEnergy ICD is not received by May 1:
```bash
# Generate escalation email
python3 tools/flowseer.py icd escalate
```

---

## Adding New Intelligence to the Platform

### Add a new directive for the AI build loop
Edit `tools/orchestrator/directive_queue.json`:
```json
{
  "id": "D90-001",
  "title": "What you want built",
  "task": "Plain English — what should be built and where",
  "priority": 1,
  "depends_on": [],
  "context": "Background context for the AI"
}
```
Then run: `python3 tools/orchestrator/go.py`

### Add a new contact
Edit `tools/contact-verifier/contacts_sample.csv` with new row.
Then run enrichment: `python3 tools/contact-verifier/run_enrichment.py`

### Update a supplier profile
Edit `tools/supplier-intelligence/supplier_profiles.md` directly.

---

## File Reference

| File | Purpose |
|------|---------|
| `tools/flowseer.py` | Master CLI |
| `tools/rfq-generator/rfq_status.json` | Live RFQ pipeline |
| `tools/rfq-generator/drafts/` | 13 RFQ draft files |
| `tools/pricing-discovery/outputs/pricing_updated.csv` | Live BOP pricing |
| `tools/reports/w251_program_status.md` | Boardroom program report |
| `tools/reports/program_timeline.md` | Phase 1-6 timeline |
| `tools/notifications/current_alerts.json` | Live alerts |
| `tools/dashboard/data/` | Dashboard JSON feeds |
| `tools/BUILD_MANIFEST.json` | Platform version + manifest |

---

## Troubleshooting

**"No pricing data found"**
→ Run: `python3 tools/pricing-discovery/pricing_discovery.py --dry-run`

**"Health check DEGRADED"**
→ Run: `python3 tools/monitoring/platform_health.py` to see which check failed

**Orchestrator not responding**
→ Run: `cd tools/orchestrator && python3 go.py`

**Dashboard data stale**
→ Run: `python3 tools/flowseer.py refresh`

---

*FlowSeer v2.1.0 | Project Jupiter W251B8 | Trans World Power LLC*
*Powered by Claude (Builder) + ChatGPT (Architect) + Perplexity (Research) + Grok (Audit)*
