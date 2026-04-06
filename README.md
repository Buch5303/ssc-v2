# SSC Supply Chain V2

Governance and execution platform for supply chain workflows. Deterministic approval policies, mandatory enforcement gate, fail-closed architecture. Production backbone with PostgreSQL, Redis, and Docker runtime support.

## Current State

**Day 35 complete.** 669 tests across 14 suites. 0 failures. Chaos validation: 8/8 pass.

## Architecture

```
Request → Auth (verifyAccessToken: JWT signature + expiry + revocation blocklist) → Tenant Isolation → Redis Rate Limit → Redis Replay Protection
    → Governance Gate → Service (async) → DB Adapter → PostgreSQL or sql.js
                            ↓
              Audit Trail (append-only, DB-enforced)
              Structured Logger (JSON, correlation IDs)
              Durable Worker Queue (DB-backed, governed)
              Metrics (/api/metrics endpoint)
```

## Runtime Modes

| Mode | Trigger | Database | Redis | Use Case |
|------|---------|----------|-------|----------|
| Local dev | No DATABASE_URL | sql.js (in-memory) | Optional | Development, tests |
| Docker | docker-compose up | PostgreSQL 16 | Redis 7 | Staging, integration |
| Production | DATABASE_URL + REDIS_URL | PostgreSQL | Redis | Pilot, production |

## What Is Runtime-Wired and Proven

- **database.js** checks DATABASE_URL at startup → returns PG adapter or sql.js adapter
- **server.js** runs PG migrations via migrate-pg.js when in PostgreSQL mode
- **integration.js** wires Redis rate limiting + replay protection into live /api request chain when REDIS_URL is set
- **All services async** — approval, execution, governance gate, decision, audit, durable queue use async/await
- **pg-adapter.js** wraps pg Pool with prepare().run/get/all interface matching sql.js
- **redis-rate-limit.js** — per-org per-action sliding window via INCR + EXPIRE, fail-open on unavailability
- **redis-replay-protection.js** — nonce dedup via SET NX EX, timestamp window validation, fail-open fallback
- **durable-worker-queue.js** — DB-backed persistent jobs, idempotent, retry-safe, governance-gated
- **Docker** — Dockerfile + docker-compose.yml: postgres:16, redis:7, app with health checks
- Mandatory governance gate at every execution entry point (zero PASS_THROUGH)
- 7 DB triggers for state machine enforcement
- 531 tests across 11 suites

## What Is Not Yet Scale-Proven

- PostgreSQL under concurrent multi-instance load
- Redis under distributed rate-limit contention
- Docker container build validation
- Production latency benchmarks under network conditions

## What Does Not Exist

- Dashboard / visualization layer
- Digital twin / simulation
- AI inference layer
- External IdP (OIDC/SAML)
- Multi-region deployment

## Running

```bash
# Local development (sql.js)
npm install && AUTH_MODE=headers npm test && AUTH_MODE=headers npm start

# Docker (PostgreSQL + Redis)
docker-compose up --build

# Benchmarks
npm run benchmark
```

## Endpoints (13)

GET /health, GET /api, GET /api/metrics, GET /api/approvals, GET /api/approvals/summary, GET /api/approvals/:id, POST /api/approvals/:id/approve, POST /api/approvals/:id/reject, POST /api/approvals/:id/cancel, POST /api/workflows/:id/execute, POST /api/workflows/:id/replay, GET /api/workflows/executions, GET /api/workflows/executions/:id
