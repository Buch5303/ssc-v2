# SSC Supply Chain V2

Governance and execution platform for supply chain workflows. Deterministic approval policies, multi-level authorization, exact-once replay, and full audit trail.

## Current State

**Day 24 complete.** 171 tests passing across 3 suites. 12 verified endpoints. Server boots clean. Migrations run clean. Railway-deployable.

**Environment posture:** Development / staging. Not yet production-hardened. See [Production Gaps](docs/PRODUCTION-GAPS.md).

---

## Architecture

```
Request → Express → Identity Extraction → Input Validation → Route → Service → Database
                         (headers)         (schema check)     (REST)  (logic)   (sql.js)
```

| Layer | Responsibility | Location |
|-------|---------------|----------|
| Routes | HTTP, identity enforcement, input validation | `src/routes/` |
| Services | Business logic, state machines, governance | `src/services/` |
| Database | Persistence, migrations, transaction-safe writes | `src/db/` |
| Common | JSON, time, pagination, validation utilities | `src/common/` |
| Middleware | Identity extraction from trusted context | `src/middleware/` |
| Schemas | Input validation rules per endpoint | `src/schemas/` |

**Design principles:**
- **Fail-closed governance:** Unknown actions require approval, not bypass
- **Deterministic:** No AI or probabilistic decisions in governance
- **Exact-once replay:** UNIQUE database constraint prevents double execution
- **Org-scoped reads:** Every query requires org_id
- **Identity from trusted context only:** Body-supplied identity ignored

---

## Folder Structure

```
ssc-v2/
├── src/
│   ├── app/integration.js          # Express factory
│   ├── common/
│   │   ├── json.js                 # Safe JSON parse/stringify
│   │   ├── time.js                 # SQLite-compatible timestamps
│   │   ├── pagination.js           # Clamped limit/offset
│   │   └── validate.js             # Schema validation engine
│   ├── db/
│   │   ├── database.js             # sql.js wrapper, transaction-safe
│   │   ├── migrate.js              # Migration runner
│   │   └── migrations/
│   │       ├── 016-day22-approval-governance.sql
│   │       └── 017-day23-workflow-execution.sql
│   ├── middleware/context.js        # Identity extraction
│   ├── routes/
│   │   ├── approvals.js            # Approval endpoints
│   │   └── workflows.js            # Execution endpoints
│   ├── schemas/
│   │   ├── approvals.js            # Approval input schemas
│   │   └── workflows.js            # Workflow input schemas
│   ├── services/
│   │   ├── approval-policy-registry.js
│   │   ├── approval-service.js
│   │   ├── decision-approval-bridge.js
│   │   ├── workflow-approval-bridge.js
│   │   └── workflow-execution-service.js
│   └── server.js                   # Entry point
├── tests/
│   ├── test-db-helper.js
│   ├── day22-approval-governance-tests.js  (94 tests)
│   ├── day23-workflow-execution-tests.js   (38 tests)
│   ├── day24-input-validation-tests.js     (39 tests)
│   └── run-all-regressions.js
├── docs/
│   ├── BUILD-STATUS.md
│   └── PRODUCTION-GAPS.md
├── data/                           # Runtime SQLite (gitignored)
├── package.json
├── .gitignore
├── .env.example
└── Procfile
```

---

## Endpoints (12)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check |
| GET | `/api` | No | Route manifest |
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

Auth = requires `x-user-id` and `x-org-id` headers. Returns 401 without.

---

## Test Inventory

| Suite | File | Tests |
|-------|------|-------|
| Day 22: Approval Governance | `day22-approval-governance-tests.js` | 94 |
| Day 23: Workflow Execution | `day23-workflow-execution-tests.js` | 38 |
| Day 24: Input Validation | `day24-input-validation-tests.js` | 39 |
| **Total** | | **171** |

---

## Running Locally

```bash
git clone https://github.com/Buch5303/ssc-v2.git
cd ssc-v2
npm install
npm test          # 171 tests
npm start         # boots on port 3000
```

---

## Authentication Model

**Current:** Dev mode. `x-user-id` / `x-org-id` headers. No token verification.
**Future:** JWT bearer tokens with RBAC. See [Production Gaps](docs/PRODUCTION-GAPS.md).

---

## Deployment

**Railway:** `Procfile` → `web: node src/server.js`. Set `PORT` (auto).
**Database:** sql.js (SQLite/WASM). File-persists to `data/ssc-v2.db`.
