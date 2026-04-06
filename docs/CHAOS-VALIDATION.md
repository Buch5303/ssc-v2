# FlowSeer SSC V2 — Chaos & Resilience Validation

## Purpose

Document expected behavior and failure modes when infrastructure components restart or fail during active operations.

## Test Matrix

| Scenario | Expected Behavior | Recovery | Data Impact |
|----------|------------------|----------|-------------|
| **App restart during request** | In-flight requests fail with connection reset. No partial writes (transactions). | App restarts, PG migrations re-run (idempotent), Redis reconnects. | None — transactions rolled back. |
| **App restart during approval** | If mid-transaction: rolled back to previous state. If between transactions: last committed state preserved. | Approval can be retried. Idempotent operations safe. | None. |
| **App restart during queue processing** | Job in PROCESSING state. On restart, job remains PROCESSING. Worker picks it up on next cycle (CAS check). | Job reprocessed with incremented attempt counter. Idempotent. | None — CAS guards prevent double execution. |
| **PostgreSQL restart** | All in-flight queries fail. App logs connection errors. Health check returns unhealthy. | pg Pool reconnects automatically (connectionTimeoutMillis: 5000). Queries resume. | None — uncommitted transactions rolled back by PG. |
| **PostgreSQL data loss** | All data lost if no backup. | Restore from pg_dump backup. App re-runs migrations. | CRITICAL — backup required. |
| **Redis restart** | Rate limits reset. Nonce cache clears. Token revocation list lost. | Redis reconnects (ioredis retryStrategy). Rate limits rebuild from zero. | LOW — revoked tokens valid until natural expiry (max 15 min for access, 7 days for refresh). |
| **Redis unavailable** | Rate limiting fails open (allows all). Replay protection fails open. Token revocation falls back to in-memory. | No action needed. App continues with degraded security. | Rate limit window resets. Replay protection gap for duration of outage. |
| **Network partition (app ↔ PG)** | Queries timeout after 5s. Health check unhealthy. All writes fail. | Reconnects when network restores. | None — no partial writes. |
| **Network partition (app ↔ Redis)** | Fails open. Rate limits disabled. In-memory fallback for revocation. | Reconnects when network restores. | Temporary security degradation. |
| **Concurrent dual approval during restart** | If app restarts between first and second approval: first approval committed, second can be retried. | Second approval submitted again. CAS guard prevents corruption. | None. |

## Validation Commands (Docker Compose)

```bash
# 1. Start stack
docker-compose up -d

# 2. Create test data
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"chaos-user","org_id":"chaos-org"}'

# 3. Simulate app restart
docker-compose restart app
sleep 5
curl http://localhost:3000/health  # Should return healthy

# 4. Simulate PostgreSQL restart
docker-compose restart postgres
sleep 10
curl http://localhost:3000/health  # Should return healthy after reconnect

# 5. Simulate Redis restart
docker-compose restart redis
sleep 5
curl http://localhost:3000/health  # Should return healthy, redis_healthy may be false briefly

# 6. Simulate Redis kill (unavailability)
docker-compose stop redis
curl http://localhost:3000/health  # Should return healthy with redis: disabled
# Rate limiting and replay protection fail open
docker-compose start redis

# 7. Verify data integrity after chaos
curl http://localhost:3000/api/approvals \
  -H "Authorization: Bearer TOKEN"
# All previously committed data should be intact
```

## Failure Mode Summary

| Component | Failure Impact | Recovery Time | Data Risk |
|-----------|---------------|---------------|-----------|
| App | Request failures during restart | ~5s (boot time) | None |
| PostgreSQL | All writes fail | ~10s (restart + reconnect) | None if no data loss |
| Redis | Degraded security | ~3s (restart + reconnect) | Temporary rate limit gap |
| Network | Timeout errors | Variable | None |

## What This Does NOT Cover

- Multi-instance failover (not yet implemented)
- Automatic database backup/restore
- Automated health-based restart (need external orchestrator)
- Cross-region failover
- Load testing under chaos conditions
