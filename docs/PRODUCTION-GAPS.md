# SSC V2 — Production Gaps

| Environment | Status |
|-------------|--------|
| Local dev | ✅ GO |
| Internal staging | ⚠️ CONDITIONAL |
| Pilot customer | ❌ NO-GO |
| Enterprise production | ❌ NO-GO |

## Gap 1: Authentication
Header-based identity. No JWT. Any client can impersonate.

## Gap 2: PostgreSQL
sql.js in-memory with file persist. Data loss on restart. Single-writer.

## Gap 3: Tenant Isolation
Manual org_id filtering. No centralized proxy. No RLS.

## Gap 4: Structured Logging
console.log only. No JSON format. No correlation IDs.

## Gap 5: Observability
No metrics endpoint. No DB health check.

## Gap 6: Request-Level Idempotency
Replay idempotency exists. General POST idempotency does not.

## Gap 7: Concurrency Control
CAS-style updates only. No version columns. No advisory locks.

## Gap 8: Background Workers
All synchronous. No auto-replay on approval.

## Gap 9: Audit Log
Embedded in entity rows. No append-only event log.

## Gap 10: Rate Limiting
None implemented.
