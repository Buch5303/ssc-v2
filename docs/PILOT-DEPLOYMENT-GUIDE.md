# FlowSeer SSC V2 — Pilot Deployment Guide

## Prerequisites

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | 20+ | Runtime |
| PostgreSQL | 16+ | Primary database |
| Redis | 7+ | Rate limiting, replay protection, token revocation |
| Docker | 24+ | Optional: use docker-compose for all-in-one |

## Option A: Docker Compose (Recommended for Pilot)

```bash
# 1. Clone
git clone https://github.com/Buch5303/ssc-v2.git && cd ssc-v2

# 2. Configure
cp .env.pilot-prep .env
# Edit .env: set real JWT_SECRET, JWT_REFRESH_SECRET, database password

# 3. Start
docker-compose up -d --build

# 4. Verify
curl http://localhost:3000/health
# Expected: {"status":"healthy","db_mode":"postgres","redis":"connected",...}

# 5. Run migrations (automatic on boot)
# Check logs: docker-compose logs app | grep "migration"
```

## Option B: Direct Node.js

```bash
# 1. Clone and install
git clone https://github.com/Buch5303/ssc-v2.git && cd ssc-v2
npm ci --production

# 2. Set up PostgreSQL
createdb ssc_v2_pilot
# Ensure user has CREATE TABLE, CREATE INDEX, CREATE TRIGGER permissions

# 3. Set up Redis
# Ensure Redis is running on the configured host:port

# 4. Configure environment
cp .env.pilot-prep .env
# Edit .env with real values

# 5. Start
node src/server.js
# Migrations run automatically on boot
```

## Post-Deployment Verification

```bash
# Health check
curl http://localhost:3000/health

# Issue a token pair
curl -X POST http://localhost:3000/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"user_id":"pilot-admin","org_id":"pilot-org"}'

# Use access_token for authenticated requests
curl http://localhost:3000/api/approvals \
  -H "Authorization: Bearer ACCESS_TOKEN_HERE"

# Metrics (Prometheus format)
curl http://localhost:3000/metrics

# Metrics (JSON)
curl -H "Accept: application/json" http://localhost:3000/api/metrics
```

## Secret Management

| Secret | Where to Store | Rotation Policy |
|--------|---------------|-----------------|
| JWT_SECRET | Env var / Kubernetes Secret / AWS SSM | Rotate on compromise or quarterly |
| JWT_REFRESH_SECRET | Env var / Kubernetes Secret / AWS SSM | Rotate with JWT_SECRET |
| DATABASE_URL password | Env var / secret store | Rotate quarterly |
| REDIS_URL password | Env var / secret store | Rotate quarterly |

**Critical:** Never commit secrets to git. Use `.env` (gitignored) or mounted secrets.

## Monitoring Setup

| What | Endpoint | Tool |
|------|----------|------|
| Health check | GET /health | Any uptime monitor |
| Prometheus metrics | GET /metrics | Prometheus + Grafana |
| Structured logs | File at LOG_EXPORT_PATH | Fluentd / Filebeat / Vector → Elasticsearch/Loki |
| Application logs | stdout | Docker logs / journalctl |

## Known Limitations (Pilot)

- Single-instance only (no horizontal scaling validated)
- No external IdP integration (JWT HS256 with local secret)
- No dashboard UI (API-only)
- No automated backup/restore procedure documented
- Rate limiting is per-instance when Redis unavailable
