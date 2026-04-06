# SSC Supply Chain V2

Governance and execution platform for supply chain workflows. Deterministic approval policies, multi-level authorization, exact-once replay, and full audit trail.

---

## Current State

**Day 34 complete.** 624 tests passing across 13 suites. Governance hardened, production backbone wired, supply chain data model added, advanced query/API layer operational.

**Environment posture:** Development / staging. Not yet production-hardened on real infra. See [docs/PRODUCTION-GAPS.md](docs/PRODUCTION-GAPS.md).

---

## Architecture

Request → Express → Auth → Identity Extraction → Tenant Isolation → Input Validation → Route → Service → Database → Audit/History

### Layers

| Layer | Responsibility | Location |
|------|----------------|----------|
| Routes | HTTP, auth enforcement, input validation | `src/routes/` |
| Services | Business logic, governance, workflows | `src/services/` |
| Database | Persistence, migrations, adapters | `src/db/` |
| Middleware | Auth, context, tenant isolation, RBAC, rate limiting | `src/middleware/` |
| Common | Validation, logging, metrics, helpers | `src/common/` |

### Design principles

- **Fail-closed governance:** unknown actions require approval, not bypass
- **Deterministic:** no AI/probabilistic decisions in governance
- **Exact-once replay:** nonce/idempotency constraints prevent duplicate execution
- **Org-scoped reads:** every query requires `org_id`
- **Identity from trusted context only:** routes do not trust body-supplied identity

---

## Folder Structure

```text
ssc-v2/
├── src/
│   ├── app/
│   │   └── integration.js            # Express factory
│   ├── common/
│   │   ├── json.js                   # Safe JSON parse/stringify
│   │   ├── logger.js                 # Structured logging
│   │   ├── metrics.js                # Counters, histograms, health
│   │   ├── pagination.js             # Clamped limit/offset helpers
│   │   ├── time.js                   # Timestamp utilities
│   │   └── validate.js               # Schema validation engine
│   ├── db/
│   │   ├── database.js               # Runtime DB switch (sql.js / PG)
│   │   ├── migrate.js                # sql.js migration runner
│   │   ├── migrate-pg.js             # PostgreSQL migration runner
│   │   ├── pg-adapter.js             # better-sqlite3 compatible PG adapter
│   │   ├── pg-client.js              # Pool, tx, row/advisory locks
│   │   └── migrations/               # 016–022 migrations
│   ├── middleware/
│   │   ├── auth.js
│   │   ├── context.js
│   │   ├── rate-limit.js
│   │   ├── redis-rate-limit.js
│   │   ├── redis-replay-protection.js
│   │   ├── request-integrity.js
│   │   ├── rbac.js
│   │   └── tenant-isolation.js
│   ├── routes/
│   │   ├── approvals.js
│   │   ├── workflows.js
│   │   └── supply-chain.js
│   ├── services/
│   │   ├── approval-policy-registry.js
│   │   ├── approval-service.js
│   │   ├── audit-trail.js
│   │   ├── decision-approval-bridge.js
│   │   ├── decision-execution-service.js
│   │   ├── durable-worker-queue.js
│   │   ├── entity-history.js
│   │   ├── governance-gate.js
│   │   ├── governance-invariants.js
│   │   ├── query-service.js
│   │   ├── supply-chain-service.js
│   │   ├── worker-queue.js
│   │   ├── workflow-approval-bridge.js
│   │   └── workflow-execution-service.js
│   └── server.js
├── tests/
│   ├── day22-approval-governance-tests.js
│   ├── day23-workflow-execution-tests.js
│   ├── day24-input-validation-tests.js
│   ├── day25-auth-hardening-tests.js
│   ├── day26-governance-hardening-tests.js
│   ├── day27-enforcement-tests.js
│   ├── day28-logging-audit-ratelimit-tests.js
│   ├── day29-distributed-infra-tests.js
│   ├── day30-eqs-audit-tests.js
│   ├── day31-grok-remediation-tests.js
│   ├── day32-production-backbone-tests.js
│   ├── day33-supply-chain-data-tests.js
│   ├── day34-query-api-tests.js
│   ├── run-all-regressions.js
│   └── test-db-helper.js
├── docs/
│   ├── BUILD-STATUS.md
│   ├── PRODUCTION-GAPS.md
│   └── TURNOVER-DOCUMENT.md
├── benchmarks/
│   └── run-benchmarks.js
├── Dockerfile
├── docker-compose.yml
├── Procfile
└── package.json
```

---

## Endpoints

### Governance

| Method | Path | Auth | Description |
|-------|------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api` | No | Route manifest |
| GET | `/api/metrics` | Yes | Metrics snapshot |
| GET | `/api/approvals` | Yes | List approval requests |
| GET | `/api/approvals/summary` | Yes | Backlog summary |
| GET | `/api/approvals/:id` | Yes | Get single request |
| POST | `/api/approvals/:id/approve` | Yes | Approve (validated) |
| POST | `/api/approvals/:id/reject` | Yes | Reject (validated) |
| POST | `/api/approvals/:id/cancel` | Yes | Cancel (validated) |
| POST | `/api/workflows/:id/execute` | Yes | Execute workflow (validated) |
| POST | `/api/workflows/:id/replay` | Yes | Replay approved execution |
| GET | `/api/workflows/executions` | Yes | List executions |
| GET | `/api/workflows/executions/:id` | Yes | Get single execution |

Auth: in headers mode requires `x-user-id` and `x-org-id`.

### Supply Chain

Mounted at `/api/sc`.

Examples:
- `GET /api/sc/suppliers`
- `POST /api/sc/suppliers`
- `GET /api/sc/orders`
- `PUT /api/sc/orders/:id/status`
- `GET /api/sc/query/suppliers`
- `GET /api/sc/query/orders`
- `GET /api/sc/timeline/suppliers/:entityId`

---

## Running Locally

```bash
git clone https://github.com/Buch5303/ssc-v2.git
cd ssc-v2
npm install
AUTH_MODE=headers node --max-old-space-size=1024 tests/run-all-regressions.js
AUTH_MODE=headers npm start
```

### Docker / production-like

```bash
docker-compose up --build
```

### Benchmarks

```bash
npm run benchmark
```

---

## Test Inventory

| Suite | File | Tests |
|------|------|------:|
| Day 22: Approval Governance | `day22-approval-governance-tests.js` | 94 |
| Day 23: Workflow Execution | `day23-workflow-execution-tests.js` | 38 |
| Day 24: Input Validation | `day24-input-validation-tests.js` | 39 |
| Day 25: Auth Hardening | `day25-auth-hardening-tests.js` | 16 |
| Day 26: Governance Hardening | `day26-governance-hardening-tests.js` | 54 |
| Day 27: Enforcement | `day27-enforcement-tests.js` | 41 |
| Day 28: Logging / Audit / Rate Limit | `day28-logging-audit-ratelimit-tests.js` | 28 |
| Day 29: Distributed Infra | `day29-distributed-infra-tests.js` | 47 |
| Day 30: EQS Audit | `day30-eqs-audit-tests.js` | 76 |
| Day 31: Grok Remediation | `day31-grok-remediation-tests.js` | 51 |
| Day 32: Production Backbone | `day32-production-backbone-tests.js` | 47 |
| Day 33: Supply Chain Data | `day33-supply-chain-data-tests.js` | 45 |
| Day 34: Query & API Expansion | `day34-query-api-tests.js` | 48 |
| **Total** |  | **624** |

---

## Notes

- `sql.js` is used for tests/dev by default.
- `DATABASE_URL` enables PostgreSQL mode.
- `REDIS_URL` enables Redis rate limiting and replay protection.
- Audit trail and entity history are append-only and DB-protected.
- Real PG/Redis infra validation is the next logical step.

See [`docs/TURNOVER-DOCUMENT.md`](docs/TURNOVER-DOCUMENT.md) for the full technical turnover.
