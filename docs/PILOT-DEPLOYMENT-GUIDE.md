# FlowSeer SSC V2 — Pilot Deployment Guide
# Baseline: commit b78a49d | Updated: 2026-04-07

## Prerequisites

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20+ | Runtime |
| PostgreSQL | 16+ | Primary database |
| Redis | 7+ | Rate limiting, replay protection, token revocation blocklist |
| Docker | 24+ | Optional: use docker-compose for all-in-one |

---

## Required Environment Variables

All variables are defined in `.env.pilot-prep`. Copy to `.env` and fill real values before any deployment.

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | ✅ | Set to `production` |
| `PORT` | ✅ | Default `3000` |
| `AUTH_MODE` | ✅ | Must be `jwt` for pilot (not `headers`) |
| `JWT_SECRET` | ✅ | Minimum 32 random chars — never commit |
| `JWT_REFRESH_SECRET` | ✅ | Different from JWT_SECRET — never commit |
| `ACCESS_TOKEN_TTL` | ✅ | Seconds — default `900` (15 min) |
| `REFRESH_TOKEN_TTL` | ✅ | Seconds — default `604800` (7 days) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PG_POOL_MAX` | ✅ | Default `20` |
| `REDIS_URL` | ✅ | Redis connection string — required for distributed revocation |
| `LOG_EXPORT_PATH` | ✅ | NDJSON log file path — e.g. `/var/log/ssc-v2/app.ndjson` |

---

## Option A: Docker Compose (Recommended for Pilot)

```bash
# 1. Clone at baseline commit
git clone https://github.com/Buch5303/ssc-v2.git && cd ssc-v2
git checkout b78a49d

# 2. Configure
cp .env.pilot-prep .env
# Edit .env: set real JWT_SECRET, JWT_REFRESH_SECRET, DATABASE_URL password

# 3. Create log directory (NDJSON export)
mkdir -p /var/log/ssc-v2

# 4. Start
docker-compose up -d --build

# 5. Verify stack is up
docker-compose ps
# All three services (postgres, redis, app) must show healthy

# 6. Tail boot log
docker-compose logs app | grep -E "\[boot\]"
# Expected lines:
#   [boot] Database mode: postgres
#   [boot] Redis: connecting...
#   [boot] Auth mode: jwt
#   [boot] Listening on port 3000
```

---

## Option B: Direct Node.js

```bash
# 1. Clone and install
git clone https://github.com/Buch5303/ssc-v2.git && cd ssc-v2
git checkout b78a49d
npm ci --production

# 2. Set up PostgreSQL
createdb ssc_v2_pilot
# User must have: CREATE TABLE, CREATE INDEX, CREATE TRIGGER

# 3. Ensure Redis is running on configured host:port

# 4. Create log directory
mkdir -p /var/log/ssc-v2

# 5. Configure environment
cp .env.pilot-prep .env
# Edit .env with real values

# 6. Start
node src/server.js
# Migrations run automatically on boot
```

---

## Post-Deployment Verification Sequence

Run these in order. Each must pass before proceeding to the next.

### Step 1 — Health Check
```bash
curl http://localhost:3000/health
# Expected: {"status":"healthy","db_mode":"postgres","redis":"connected",...}
# FAIL if db_mode is "sqlite" or redis is "disabled"
```

### Step 2 — Token Issuance
```bash
curl -s -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"pilot-admin","org_id":"pilot-org","role":"admin"}' | tee /tmp/tokens.json
# Expected: {"access_token":"...","refresh_token":"...","expires_in":900}
export ACCESS_TOKEN=$(cat /tmp/tokens.json | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).access_token))")
export REFRESH_TOKEN=$(cat /tmp/tokens.json | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).refresh_token))")
```

### Step 3 — Authenticated Request
```bash
curl -s http://localhost:3000/api/approvals \
  -H "Authorization: Bearer $ACCESS_TOKEN"
# Expected: 200 with approvals array (may be empty — that is OK)
# FAIL if 401 or 500
```

### Step 4 — Token Refresh
```bash
curl -s -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}"
# Expected: new access_token issued, old refresh_token rotated
# Handler: src/routes/auth.js → tokenService.refreshTokens() in src/middleware/token-service.js
```

### Step 5 — Token Revocation (Redis blocklist)
```bash
# Revoke the current access token
curl -s -X POST http://localhost:3000/api/auth/revoke \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$ACCESS_TOKEN\"}"
# Expected: {"revoked":true,"jti":"..."}

# Confirm revoked token is rejected
curl -s http://localhost:3000/api/approvals \
  -H "Authorization: Bearer $ACCESS_TOKEN"
# Expected: 401 {"error":"token_revoked"}
# Handler: src/middleware/token-service.js → verifyAccessToken() → isRevoked(jti)
# Redis key written: revoked:<jti>
```

### Step 6 — Prometheus Metrics
```bash
curl -s http://localhost:3000/metrics | head -20
# Expected: Prometheus text format — lines beginning with ssc_ counters/gauges
# Handler: src/common/metrics-export.js → metricsEndpoint() → toPrometheus()
# FAIL if empty or returns JSON
```

### Step 7 — NDJSON Log Export
```bash
# Trigger some activity, then check log file
cat $LOG_EXPORT_PATH | head -5
# Expected: newline-delimited JSON objects with level, component, message, timestamp fields
# Handler: src/common/log-export.js → write() configured by LOG_EXPORT_PATH env var
# FAIL if file is absent or empty after traffic
```

### Step 8 — Chaos Validation
```bash
node scripts/chaos-validate.js
# Expected: 8/8 chaos scenarios pass
# Run against the deployed instance, not local dev
# FAIL if any scenario returns unexpected result
```

---

## Secret Management

| Secret | Where to Store | Rotation Policy |
|--------|---------------|-----------------|
| `JWT_SECRET` | Env var / Kubernetes Secret / AWS SSM | Rotate on compromise or quarterly |
| `JWT_REFRESH_SECRET` | Env var / Kubernetes Secret / AWS SSM | Rotate with JWT_SECRET |
| `DATABASE_URL` password | Secret store — never plaintext | Rotate quarterly |
| `REDIS_URL` password | Secret store — never plaintext | Rotate quarterly |

**Critical:** Never commit `.env` with real secrets. Use mounted secrets or a secrets manager.

---

## Monitoring Setup

| What | Endpoint / Path | Tool |
|------|----------------|------|
| Health check | `GET /health` | Any uptime monitor |
| Prometheus metrics | `GET /metrics` | Prometheus + Grafana |
| Structured NDJSON logs | File at `LOG_EXPORT_PATH` | Fluentd / Filebeat / Vector → Loki / Elasticsearch |
| Application stdout | Docker logs / journalctl | Any log aggregator |

---

## Known Limitations (Pilot)

- Single-instance only — no horizontal scaling validated
- No external IdP — JWT HS256 with local secret (RS256/OIDC not implemented)
- No dashboard UI — API-only
- Refresh token rotation implemented; automatic sliding-window renewal not wired
- Rate limiting is per-instance when Redis is unavailable (fail-open)
- No automated backup/restore procedure documented
