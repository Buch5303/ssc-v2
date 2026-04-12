# GROK AUDIT ORDER — FlowSeer SSC V2 / Track A Build
**Issued by:** Greg Buchanan, CEO Trans World Power
**Audit scope:** All deliverables since Track A implementation (commit 788fd8c onwards)
**Audit type:** DETAILED — file-by-file, block-by-block
**Standard:** Production-grade procurement intelligence platform

---

## AUDIT AUTHORITY

Grok operates as sole QA/Auditor in the FlowSeer four-agent pipeline.
This order supersedes any previous PASS verdicts on Track A builds.
Issue BLOCK on any finding that would cause a real-world failure.

---

## AUDIT SCOPE — 10 Delivery Areas

### Area 1: Orchestrator v2 Architecture (commits 788fd8c → fdc5e82)
Files:
- tools/orchestrator/orchestrator.py
- tools/orchestrator/agents/architect.py
- tools/orchestrator/agents/researcher.py
- tools/orchestrator/agents/builder.py
- tools/orchestrator/agents/auditor.py
- tools/orchestrator/agents/self_editor.py
- tools/orchestrator/agents/research_cache.py
- tools/orchestrator/outputs/file_writer.py
- tools/orchestrator/outputs/git_ops.py
- tools/orchestrator/state/*.py

Audit criteria:
□ Parallel dual-track executes without race conditions
□ Thread lock serializes git ops correctly
□ Self-editor catches syntax errors before audit
□ Research cache TTL is 24hr and keys are hashed correctly
□ Perplexity pre-fetch fires in parallel with architect, not after
□ Tiered model selection (sonar vs sonar-pro) logic is correct
□ Claude fallback fires correctly when OpenAI/xAI/Perplexity unreachable
□ Hard PASS rule: files_written>0 AND frontend_clean=True → always PASS
□ Frontend guard blocks all writes outside tools/
□ Git ops auto-rebase on rejection, force-with-lease on conflict
□ Session state persists correctly across restarts
□ Audit log writes JSONL with all 6 event types
□ go.py resets session and launches loop in one command

### Area 2: Contact Verifier (D52/D52A)
Files:
- tools/contact-verifier/contact_verifier.py
- tools/contact-verifier/models.py
- tools/contact-verifier/rate_limits.py
- tools/contact-verifier/scoring.py
- tools/contact-verifier/suppression.py
- tools/contact-verifier/providers/*.py
- tools/contact-verifier/tests/*.py (45 tests)

Audit criteria:
□ 10-layer free-first pipeline executes in correct order
□ Rate limits apply exponential backoff and auto-disable on failure
□ RFQ safety gate blocks unverified contacts from RFQ lists
□ Suppression/dedupe removes duplicates correctly
□ Evidence model stores source, confidence, and URL per finding
□ All 45 tests pass without live API calls (mocked)
□ run_enrichment.py dry-run produces correct output without live calls
□ apollo_hunter.py handles missing API keys gracefully

### Area 3: Pricing Discovery Engine (D53/D53.1)
Files:
- tools/pricing-discovery/pricing_discovery.py
- tools/pricing-discovery/bom_library.py (19 categories)
- tools/pricing-discovery/contradiction_detector.py
- tools/pricing-discovery/normalization_trace.py
- tools/pricing-discovery/procurement_strategy.py
- tools/pricing-discovery/learning_engine.py
- tools/pricing-discovery/providers/*.py
- tools/pricing-discovery/tests/*.py (67 tests)

Audit criteria:
□ BOM build-up produces $9.274M total in dry-run
□ Contradiction detector fires for MAGNITUDE >50%, SOURCE_CLASS >40%, VINTAGE >5yr
□ Contradictions are NEVER silently averaged — written to separate CSV
□ Normalization trace records every ENR CCI factor and MW scale factor
□ Procurement strategy correctly flags Trillium AVOID on PIPING_VALVES
□ Learning engine correctly classifies BH VIB_MON as UNDERESTIMATE (-21.1%)
□ Cross-category signal propagates +10.6% to Controls/DCS and Telecoms
□ Perplexity synthesis fires LAST — never first-pass (synthesis_is_first_pass=False)
□ All 67 tests pass without live API calls
□ live_price_verify.py handles missing API keys gracefully

### Area 4: RFQ Pipeline (D56-D57)
Files:
- tools/rfq-generator/drafts/*.txt (6 files)
- tools/rfq-generator/rfq_status.json
- tools/rfq-generator/rfq_status_report.md
- tools/rfq-generator/ingest_response.py
- tools/rfq-generator/generate_rfqs.py

Audit criteria:
□ All 6 RFQ drafts present and contain real content (not placeholders)
□ Each RFQ correctly references W251B8, Santa Teresa NM, Project Jupiter
□ Each RFQ is addressed to the correct named contact
□ rfq_status.json correctly shows Baker Hughes as RESPONDED at $340K
□ ingest_response.py updates rfq_status.json, pricing CSV, and confidence
□ ingest_response.py computes correct delta (BH: +$71.75K, +26.7%)
□ RFQ send date is correctly set to May 25, 2026

### Area 5: Program Intelligence Reports (D56-D58)
Files:
- tools/reports/w251_program_status.md
- tools/reports/program_timeline.md
- tools/reports/weekly_status_report.md
- tools/reports/generate_weekly_report.py
- tools/reports/rfq_countdown.md
- tools/pricing-discovery/outputs/verification_status_report.md
- tools/pricing-discovery/outputs/pricing_dashboard.txt

Audit criteria:
□ Program status report covers all 7 required sections
□ Timeline correctly places RFQ send on May 25, 2026
□ Timeline correctly identifies Transformer as critical path (52-70 week lead)
□ Timeline correctly targets Q2 2027 first power
□ Weekly report generator produces valid markdown without errors
□ Countdown correctly shows 44 days to May 25 from April 11 baseline
□ EthosEnergy ICD is flagged as PENDING and blocking in all relevant documents

### Area 6: Supplier Intelligence (D57)
Files:
- tools/supplier-intelligence/supplier_profiles.md (10 profiles)
- tools/supplier-intelligence/supplier_comparison_matrix.md

Audit criteria:
□ All 10 strategic suppliers have complete profiles
□ Trillium AVOID is documented with clear reason
□ Flowserve is correctly identified as Trillium replacement
□ Lead times are credible for each supplier category
□ Comparison matrix covers 6 key categories with correct preferred/backup designation
□ Generator and Transformer correctly flagged as competitive bid (not single-source)

### Area 7: Live API + Database Layer (D58, D67)
Files:
- tools/api/neon_api.py (6 endpoints)
- tools/api/schema.sql
- tools/api/init_db.py
- tools/api/requirements.txt

Audit criteria:
□ All 6 FastAPI endpoints are syntactically valid
□ CSV fallback fires correctly when DB is unavailable
□ schema.sql creates all 5 required tables
□ schema.sql seed data has all 19 BOP categories with correct values
□ VIB_MON is seeded as RFQ_VERIFIED at $340K quoted
□ init_db.py --check verifies connection and row counts
□ CORS middleware allows dashboard to call API

### Area 8: Dashboard Data Bridge (D64)
Files:
- tools/dashboard/generate_dashboard_data.py
- tools/dashboard/data/*.json (6 files)

Audit criteria:
□ All 6 JSON data files are valid JSON and contain real data
□ program_summary.json reflects correct BOP total ($9.274M)
□ rfq_pipeline.json correctly shows 1 RESPONDED, 6 DRAFTED
□ kpi_band.json primary signal references Baker Hughes $340K
□ supplier_network.json shows Trillium in avoid_suppliers
□ Data files can be consumed by frontend without transformation
□ --watch mode regenerates files every 5 minutes correctly

### Area 9: Budget + Scheduling Tools (D65-D66)
Files:
- tools/budget/budget_variance_tracker.py
- tools/scheduling/rfq_send_scheduler.py
- tools/scheduling/rfq_send_plan.md

Audit criteria:
□ Budget variance tracker correctly computes delta and variance_pct
□ RAG health signals are correct (green <10%, amber <25%, red >25%)
□ Send scheduler shows correct send order (Emerson first at $700K)
□ Pre-send checklist includes EthosEnergy ICD as critical blocker
□ rfq_send_plan.md is complete and contains all 8 RFQ entries
□ Days-to-send calculation is correct from today's date

### Area 10: Contact Scoring + Enrichment (D61, D68)
Files:
- tools/scoring/contact_priority_scorer.py
- tools/contact-verifier/run_enrichment.py
- tools/contact-verifier/providers/apollo_hunter.py
- tools/contact-verifier/outreach_sequences/*.md (8 files)

Audit criteria:
□ Priority scorer correctly weights seniority, company tier, RFQ status
□ Lorenzo Simonelli (BH CEO, ACTIVE_RFQ) scores highest
□ run_enrichment.py dry-run completes without live API calls
□ apollo_hunter.py returns empty dict when API keys not set
□ All 8 outreach sequences present and contain 3-touch structure
□ Alberto Malandra sequence correctly requests EthosEnergy ICD
□ Sequences are addressed to correct named contacts

---

## AUDIT OUTPUT FORMAT

For each Area, Grok must return:

```
AREA [N]: [Name]
Verdict: PASS | CONDITIONAL_PASS | BLOCK
Files reviewed: [count]
Criteria met: [X/Y]
Issues found:
  - [BLOCKING] description
  - [MAJOR] description  
  - [MINOR] description
Corrections required: [specific fixes needed]
```

Final summary:
```
OVERALL VERDICT: PASS | CONDITIONAL_PASS | BLOCK
Blocking issues: [count]
Major issues: [count]
Minor issues: [count]
Build integrity: [SOUND | AT_RISK | COMPROMISED]
Recommendation: [PROMOTE TO PRODUCTION | CORRECT AND REAUDIT | HOLD]
```

---

## LOCKED BASELINES — DO NOT REGRESS

- UI baseline: `2111282` — zero frontend changes permitted
- Contact verifier commit: `09d8f7e` — 45/45 tests must still pass
- Pricing discovery: $9.274M BOP mid — must reproduce in dry-run
- Directives closed: 15, 17, 20–68

---

*Audit Order issued: April 11, 2026*
*Authorized by: Greg Buchanan, CEO Trans World Power*
*Audit Authority: Grok (xAI) — QA/Auditor, FlowSeer Four-Agent Pipeline*
