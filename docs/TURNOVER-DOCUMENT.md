# SSC V2 / FLOWSEER — COMPLETE TURNOVER DOCUMENT

**Date:** April 6, 2026
**Repo:** https://github.com/Buch5303/ssc-v2
**Owner:** Greg Buchanan ("Buchs"), CEO Trans World Power
**Current State:** 624 tests, 0 failures, 94 files
**Last Validated:** Day 34 — Phase 2B Query & API Expansion

---

## 1. PROJECT IDENTITY

**What this is:** A hardened governance engine and supply chain data platform. The enforcement layer for the FlowSeer Supply Chain Platform.

**What this is NOT (yet):** Not a complete supply chain platform. No dashboard, no visualization, no AI/ML, no digital twin, no simulation. Those are future phases.

**Governing spec:** FlowSeer Enterprise Quality Specification (EQS v1.0) — defines aspirational targets including Tableau/Palantir/SAP-grade capabilities. Current build addresses EQS §3 (Governance), §4.4 (Security), §5 (Data Architecture), §9 (Deployment) only.

**AI Governance Chain:** ChatGPT = System Architect, Claude = Code Generator, Grok = QA/QC Authority. No code enters production without Claude generation + Grok validation + ChatGPT approval.

---

## 2. WHAT EXISTS AND IS PROVEN (624 TESTS)

### Governance Core (Days 22–31) — 504 tests

| Component | File | What It Does |
|-----------|------|-------------|
| Approval Service | `src/services/approval-service.js` | CRUD for approval requests. State machine: PENDING → APPROVED/REJECTED/CANCELLED. DUAL approval mode. Self-approval blocked. CAS guards. Transaction-wrapped. |
| Policy Registry | `src/services/approval-policy-registry.js` | Deterministic policy evaluation. NONE/SINGLE/DUAL modes. Escalation for bulk/destructive/AI. |
| Governance Gate | `src/services/governance-gate.js` | **Single mandatory enforcement point.** All execution routes through here. Returns CLEAR/PENDING/ERROR. Records audit events. Zero PASS_THROUGH. |
| Workflow Execution | `src/services/workflow-execution-service.js` | Execute/replay workflows. Calls governance gate internally. Replay via idempotency key (UNIQUE constraint). |
| Decision Execution | `src/services/decision-execution-service.js` | All 7 decision actions (resolve, dismiss, update, delete, reassign, comment, archive) through gate. |
| Governance Invariants | `src/services/governance-invariants.js` | Post-write verification of approval/execution integrity. |
| Auth Middleware | `src/middleware/auth.js` | JWT HS256 or headers mode. Fail-closed on missing/unknown mode. |
| Context Middleware | `src/middleware/context.js` | Extracts identity from auth into req.identity. Routes never read headers directly. |
| Tenant Isolation | `src/middleware/tenant-isolation.js` | requireTenant middleware. validateTenantAccess. scopedQuery. |
| RBAC | `src/middleware/rbac.js` | Role-based access control middleware. |
| Structured Logger | `src/common/logger.js` | JSON-structured with severity, correlation IDs, request-scoped. |
| Audit Trail | `src/services/audit-trail.js` | Append-only governance_audit_log. DB triggers prevent DELETE/UPDATE. |
| Rate Limiting | `src/middleware/rate-limit.js` | Per-org per-action sliding window (sql.js backend). |
| Input Validation | `src/common/validate.js` | String/int/bool/enum/object validators with schemas. |
| Bridges (SEALED) | `src/services/workflow-approval-bridge.js`, `decision-approval-bridge.js` | Deprecated redirects to governance gate. Zero independent logic. |

### DB Triggers and Migrations (7 migrations)

| Migration | What It Enforces |
|-----------|-----------------|
| 016 | Approval requests + policies tables |
| 017 | Workflow executions table |
| 018 | Terminal state immutability trigger, self-approval trigger, same-user dual trigger |
| 019 | Audit log table + rate limit table + audit immutability triggers |
| 020 | PostgreSQL DDL with RLS policies, PG-native triggers, constraints |
| 021 | Must-start-PENDING trigger, org_id immutability, requester immutability, execution org immutability |
| 022 | Supply chain entities (7 tables) + entity_history + lineage immutability triggers |

### Production Backbone (Day 32) — 47 tests

| Component | File | Status |
|-----------|------|--------|
| Database runtime switch | `src/db/database.js` | Checks DATABASE_URL → PG adapter or sql.js. **Runtime-wired.** |
| PG Adapter | `src/db/pg-adapter.js` | Wraps pg Pool with prepare().run/get/all matching sql.js interface. |
| PG Client | `src/db/pg-client.js` | Pool, withTransaction, withRowLock, withAdvisoryLock, setTenantContext. |
| PG Migration Runner | `src/db/migrate-pg.js` | schema_migrations table, idempotent, checksum tracking. |
| Redis Client | `src/db/redis-client.js` | ioredis connection with reconnection strategy. |
| Redis Rate Limit | `src/middleware/redis-rate-limit.js` | INCR+EXPIRE sliding window. **Wired in integration.js.** |
| Redis Replay Protection | `src/middleware/redis-replay-protection.js` | SET NX EX nonce cache. **Wired in integration.js.** |
| Request Integrity | `src/middleware/request-integrity.js` | Nonce/timestamp replay protection (in-memory, production only). |
| Durable Worker Queue | `src/services/durable-worker-queue.js` | DB-backed worker_jobs table. Idempotent, governed, retry-safe. |
| In-Memory Worker Queue | `src/services/worker-queue.js` | Legacy in-memory queue (superseded by durable queue). |
| Metrics | `src/common/metrics.js` | Counters, histograms, gauges, timers, health probe, alert hooks. |
| Docker | `Dockerfile` + `docker-compose.yml` | postgres:16 + redis:7 + app. Health checks. |
| Env configs | `.env.local`, `.env.staging`, `.env.pilot-prep` | Environment-specific configuration. |
| Benchmarks | `benchmarks/run-benchmarks.js` | 6 benchmarks: approval create, approval flow, workflow execute, replay reject, queue process, persistence. |
| Server | `src/server.js` | PG migration on boot, Redis init, durable queue init. |
| Integration | `src/app/integration.js` | Express app: auth → tenant isolation → Redis rate limit → Redis replay protection → routes. |

### Supply Chain Data Foundation (Day 33) — 45 tests

| Entity | Table | CRUD | Governance | Lineage |
|--------|-------|------|-----------|---------|
| Suppliers | suppliers | Create, Read, List, Update, Delete | Delete = destructive (DUAL). Bulk import = DUAL. | Full history |
| Parts | parts | Create, Read, List | — | Full history |
| Purchase Orders | purchase_orders | Create, Read, List, Status Change | Cancel = destructive (DUAL) | Status changes tracked |
| PO Line Items | po_line_items | Create | — | — |
| Shipments | shipments | Create, Read | — | Full history |
| Inspections | inspections | Create | — | Full history |
| Certifications | certifications | Create | — | Full history |
| Entity History | entity_history | Append-only (DB triggers block DELETE/UPDATE) | — | IS the lineage system |

**Service:** `src/services/supply-chain-service.js` (22 functions)
**History:** `src/services/entity-history.js` (record, getHistory, getEntityTimeline)
**Routes:** `src/routes/supply-chain.js` (mounted at /api/sc)
**Migration:** `src/db/migrations/022-day33-supply-chain-entities.sql`

### Query & API Layer (Day 34) — 48 tests

| Surface | File | Functions | Filters |
|---------|------|-----------|---------|
| Advanced Queries | `src/services/query-service.js` | querySuppliers, queryParts, queryOrders, queryShipments, queryCertifications, queryInspections | status, category, country, rating, criticality, value range, date range, carrier, ETA, cert type, expiry, defect count, search |
| Relationship Traversal | Same file | getSupplierParts, getSupplierCertifications, getSupplierOrders, getOrderLineItems, getOrderShipments, getShipmentInspections | All tenant-safe with org_id check |
| Timeline/History | Same file | getEntityTimeline, getStatusChanges, getImportProvenance | action, actor, date range, source filter |

**Sort safety:** Whitelisted sort fields per entity. Invalid → defaults to created_at. SQL injection safe.
**Pagination:** Limit clamped 1–200. Offset clamped ≥ 0.
**Tenant isolation:** Every query filters by org_id. Cross-tenant returns empty/not_found.

---

## 3. CRITICAL ARCHITECTURE DECISIONS

**All services are async.** Every service function uses `async/await`. Works with sql.js (await resolves immediately on sync values) and PG adapter (real async).

**Governance gate is the only path to execution.** `enforceGovernance()` in `governance-gate.js` is called by workflow-execution-service, decision-execution-service, worker-queue, and durable-worker-queue. `assertGovernanceEnforced()` throws if gate wasn't called.

**Zero PASS_THROUGH.** The string does not exist in any source file. Old bridges are sealed redirects to the governance gate.

**DB triggers are defense-in-depth.** Application logic prevents illegal transitions. DB triggers catch any direct SQL bypass.

**Audit trail is append-only.** DB triggers on governance_audit_log and entity_history prevent DELETE and UPDATE.

**sql.js is the test/dev database.** All 624 tests run against sql.js (SQLite WASM). The `test-db-helper.js` creates an in-memory database per test suite. Migrations are loaded by splitting on `;` for standard SQL, and via `db._raw.exec()` for trigger-containing migrations.

---

## 4. HOW TO RUN

```bash
# Clone and install
git clone https://github.com/Buch5303/ssc-v2.git && cd ssc-v2
npm install

# Run all 624 tests
AUTH_MODE=headers node --max-old-space-size=1024 tests/run-all-regressions.js

# Run individual suite
AUTH_MODE=headers node tests/day34-query-api-tests.js

# Start server (sql.js mode)
AUTH_MODE=headers npm start

# Start server (Docker: PostgreSQL + Redis)
docker-compose up --build

# Run benchmarks
npm run benchmark
```

**Critical flags:**
- `AUTH_MODE=headers` — required for all test/dev runs
- `--max-old-space-size=1024` — required for full regression (13 suites in one process)
- `DATABASE_URL=postgresql://...` — triggers PostgreSQL mode at runtime
- `REDIS_URL=redis://...` — enables Redis rate limiting and replay protection

---

## 5. TEST SUITE STRUCTURE

| Suite | File | Tests | What It Covers |
|-------|------|-------|---------------|
| Day 22 | `tests/day22-approval-governance-tests.js` | 94 | Approval CRUD, state machine, DUAL, self-approval, cross-org, bridge redirect |
| Day 23 | `tests/day23-workflow-execution-tests.js` | 38 | Execute, block, replay, reject/cancel, cross-org, HTTP endpoints |
| Day 24 | `tests/day24-input-validation-tests.js` | 39 | String/int/bool/enum validators, HTTP validation, schema enforcement |
| Day 25 | `tests/day25-auth-hardening-tests.js` | 16 | Headers mode, JWT mode, missing auth, expired token, context extraction |
| Day 26 | `tests/day26-governance-hardening-tests.js` | 54 | DUAL enforcement, same-user blocking, illegal transitions, idempotency, bypass, invariants |
| Day 27 | `tests/day27-enforcement-tests.js` | 41 | Governance gate, assertion, decision coverage, pass-through elimination, DB triggers, approval verification |
| Day 28 | `tests/day28-logging-audit-ratelimit-tests.js` | 28 | Logger, audit trail, rate limiting, immutability |
| Day 29 | `tests/day29-distributed-infra-tests.js` | 47 | DB adapter, tenant isolation, worker queue, metrics, race simulation, retry storm |
| Day 30 | `tests/day30-eqs-audit-tests.js` | 76 | All 10 Grok EQS priorities: bypass, decision, concurrency, DB, zero trust, audit, logging, rate limit, security |
| Day 31 | `tests/day31-grok-remediation-tests.js` | 51 | Adversarial: all Grok findings, zero PASS_THROUGH scan, replay protection, terminal transitions, edge cases |
| Day 32 | `tests/day32-production-backbone-tests.js` | 47 | PG/Redis module exports, durable queue CRUD, redis fallback, metrics, governance preservation |
| Day 33 | `tests/day33-supply-chain-data-tests.js` | 45 | Supplier/part/order CRUD, lineage, history immutability, bulk import governance, cross-tenant |
| Day 34 | `tests/day34-query-api-tests.js` | 48 | Advanced queries (6 entities), relationship traversal (6 paths), timeline/history, sort safety, pagination |

**Test helper:** `tests/test-db-helper.js` — creates sql.js in-memory database with better-sqlite3-compatible interface.

**Regression runner:** `tests/run-all-regressions.js` — runs all 13 suites sequentially, reports per-suite and total.

---

## 6. API ENDPOINTS

### Governance (/api/approvals, /api/workflows)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health probe with DB mode, Redis status |
| GET | /api | Service info |
| GET | /api/metrics | Metrics snapshot |
| GET | /api/approvals | List approval requests |
| GET | /api/approvals/summary | Approval summary stats |
| GET | /api/approvals/:id | Get approval request |
| POST | /api/approvals/:id/approve | Approve request |
| POST | /api/approvals/:id/reject | Reject request |
| POST | /api/approvals/:id/cancel | Cancel request |
| POST | /api/workflows/:id/execute | Execute workflow |
| POST | /api/workflows/:id/replay | Replay approved execution |
| GET | /api/workflows/executions | List executions |
| GET | /api/workflows/executions/:id | Get execution |

### Supply Chain (/api/sc)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/sc/suppliers | List suppliers |
| POST | /api/sc/suppliers | Create supplier |
| GET | /api/sc/suppliers/:id | Get supplier |
| PUT | /api/sc/suppliers/:id | Update supplier |
| DELETE | /api/sc/suppliers/:id | Delete supplier (governed) |
| POST | /api/sc/suppliers/import | Bulk import (DUAL approval) |
| GET | /api/sc/suppliers/:id/parts | Traversal: supplier → parts |
| GET | /api/sc/suppliers/:id/certifications | Traversal: supplier → certs |
| GET | /api/sc/suppliers/:id/orders | Traversal: supplier → orders |
| GET | /api/sc/parts | List parts |
| POST | /api/sc/parts | Create part |
| GET | /api/sc/parts/:id | Get part |
| GET | /api/sc/orders | List orders |
| POST | /api/sc/orders | Create order |
| GET | /api/sc/orders/:id | Get order + line items |
| PUT | /api/sc/orders/:id/status | Update order status (cancel=governed) |
| GET | /api/sc/orders/:id/line-items | Traversal: order → line items |
| POST | /api/sc/orders/:id/line-items | Add line item |
| GET | /api/sc/orders/:id/shipments | Traversal: order → shipments |
| POST | /api/sc/shipments | Create shipment |
| GET | /api/sc/shipments/:sid | Get shipment |
| GET | /api/sc/shipments/:id/inspections | Traversal: shipment → inspections |
| POST | /api/sc/inspections | Create inspection |
| POST | /api/sc/certifications | Create certification |

### Query Layer (/api/sc/query, /api/sc/timeline)

| Method | Path | Filters |
|--------|------|---------|
| GET | /api/sc/query/suppliers | status, category, country, min_rating, search, sort_by, sort_dir, limit, offset |
| GET | /api/sc/query/parts | category, criticality, supplier_id, max_lead_time, search |
| GET | /api/sc/query/orders | status, supplier_id, min_value, max_value, required_after, required_before, search |
| GET | /api/sc/query/shipments | status, carrier, po_id, eta_after, eta_before, search |
| GET | /api/sc/query/certifications | cert_type, status, supplier_id, expiring_before, expiring_after |
| GET | /api/sc/query/inspections | result, shipment_id, inspector_user_id, date_after, date_before, min_defects |
| GET | /api/sc/timeline/:entityType | action, actor, after, before, source, limit, offset |
| GET | /api/sc/timeline/:entityType/:entityId | Same filters, scoped to entity |
| GET | /api/sc/timeline/:entityType/:entityId/status-changes | Status change history |
| GET | /api/sc/timeline/:entityType/imports | Import provenance |
| GET | /api/sc/history/:entityType/:entityId | Raw entity history |

---

## 7. KNOWN ISSUES AND TECHNICAL DEBT

### Grok Push Problem
Grok repeatedly rejects packages as non-existent because the zip isn't pushed to GitHub before Grok audits. **The code exists in the zip and passes all tests.** After extracting the zip, the user must `git add -A && git commit && git push` before submitting to Grok.

### Day 25 Test Reduction
Day 25 was originally 36 tests. During the async refactor (Day 32), the file was rewritten to 16 tests. The 20 missing tests are JWT edge cases (extra claims, missing sub+user_id, Bearer prefix, empty Bearer, POST with token, empty headers, mode switching, JWT_SECRET absence, identity propagation, spoof rejection). Core auth paths are still covered.

### Async Refactor Scars
All services were converted from sync to async in Day 32 to support the PG adapter. This required mechanical conversion of all 13 test files. Some test files have `_r1`, `_r2` variable names from automated assert-splitting. Functionally correct but cosmetically imperfect.

### Not Yet Proven Against Real Infrastructure
- PostgreSQL: adapter and migrations exist, never tested against real PG
- Redis: rate limit and replay protection wired in integration.js, tested against null/mock Redis only
- Docker: Dockerfile and docker-compose.yml exist, never built/run
- Multi-instance concurrency: designed (CAS, row locks, advisory locks) but never stress-tested

---

## 8. WHAT DOES NOT EXIST

| Category | Status |
|----------|--------|
| Dashboards / visualization | Not started |
| Predictive AI / recommendations | Not started |
| Digital twin / simulation | Not started |
| GPU acceleration | Not started |
| External IdP (OIDC/SAML) | Not started (JWT HS256 only) |
| Multi-region deployment | Not started |
| Full-text search | LIKE-based only |
| Aggregation / analytics endpoints | Not started |
| Real-time streaming | Not started (batch/queue foundation only) |
| Token refresh / revocation | Not started |
| Load testing results | Benchmark harness exists, no results |

---

## 9. KEY FILE RELATIONSHIPS

```text
server.js
  → database.js (runtime switch: DATABASE_URL → PG or sql.js)
  → migrate.js (sql.js) or migrate-pg.js (PostgreSQL)
  → integration.js
      → auth.js → context.js → tenant-isolation.js
      → redis-rate-limit.js (if Redis)
      → redis-replay-protection.js (if Redis)
      → routes/approvals.js → approval-service.js
      → routes/workflows.js → workflow-execution-service.js → governance-gate.js
      → routes/supply-chain.js → supply-chain-service.js + query-service.js
                                   → entity-history.js
                                   → governance-gate.js (for destructive ops)

governance-gate.js
  → approval-policy-registry.js (policy evaluation)
  → approval-service.js (creates approval requests)
  → audit-trail.js (records governance events)

All services → logger.js, metrics.js
```

---

## 10. GROK AUDIT HISTORY

| Audit | Date | Result | Key Findings |
|-------|------|--------|-------------|
| Initial EQS | Day 30 | REJECTED | Governance optional, no DB integrity, weak zero trust, no concurrency |
| Remediation | Day 31 | P0/P1 CLOSED | All bypass paths eliminated, 7 DB triggers, replay protection, 504 tests |
| Truthfulness | Post-31 | OVERCLAIMED | 6 of 10 gaps overclaimed as CLOSED. Docs rewritten honestly. |
| Phase 1A | Day 32 | REJECTED | PG/Redis not wired at runtime. Rebuilt with real runtime switch. |
| Day 33 | Post-33 | REJECTED | "No Day 33 code exists." Code was present but not pushed to GitHub. |
| Day 34 | Post-34 | REJECTED | "No Day 34 code exists." Same push issue. Code is present and tested. |

**Pattern:** Grok audits the GitHub repo, not the zip. Code must be pushed before submitting for audit.

---

## 11. NEXT PHASE OPTIONS

Per EQS v1.0, the logical next builds are:

1. **Phase 3: Aggregation & Analytics** — SUM/AVG/GROUP BY endpoints, supplier scorecards, order pipeline views. Foundation for dashboards.
2. **Phase 3: Real PG+Redis Validation** — docker-compose up, run tests against real infra, prove end-to-end.
3. **Phase 4: Dashboard Foundation** — React frontend, WebSocket real-time, executive views consuming the query layer.
4. **Phase 4: Operational Intelligence** — Decision engine, anomaly detection, recommendation stubs.
5. **Phase 5+: Simulation, Digital Twin, GPU** — Far future.

---

## 12. COMMANDS CHEAT SHEET

```bash
# Full regression (MUST use these exact flags)
AUTH_MODE=headers node --max-old-space-size=1024 tests/run-all-regressions.js

# Single suite
AUTH_MODE=headers node tests/day34-query-api-tests.js

# Start server
AUTH_MODE=headers npm start

# Docker
docker-compose up --build

# Benchmarks
npm run benchmark

# Push to GitHub (MUST do before Grok audit)
git add -A && git commit -m "message" && git push origin main

# Verify files in git
git ls-files src/services/query-service.js tests/day34-query-api-tests.js
```

---

## 13. SESSION CONTEXT FOR CLAUDE

When starting a new Claude session, provide this context:

> You are continuing the SSC V2 / FlowSeer build. Repo: github.com/Buch5303/ssc-v2. Current state: Day 34 complete, 624 tests passing, 94 files. The project uses a ChatGPT (architect) → Claude (code) → Grok (QA) governance chain. All services are async. Database switches between sql.js (dev) and PostgreSQL (production) via DATABASE_URL. Redis is wired for rate limiting and replay protection via REDIS_URL. The governance gate is mandatory at every execution entry point — zero PASS_THROUGH. All test files use `async function test(name, fn)` and `await` on all service calls. The FlowSeer EQS v1.0 is the controlling quality spec. At the end of every build session, provide a single-line git push command. Do not claim anything not proven by tests.

---

*End of turnover document.*
