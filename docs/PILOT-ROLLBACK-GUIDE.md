# FlowSeer SSC V2 — Pilot Rollback Guide

## When to Roll Back

- Application fails health check after deployment
- Migrations fail (check logs for "FATAL" or "migration failed")
- Data corruption detected
- Security incident requiring immediate remediation

## Docker Compose Rollback

```bash
# 1. Stop current deployment
docker-compose down

# 2. Revert to previous version
git log --oneline -5                    # Find previous good commit
git checkout <previous-commit-hash>     # Revert code

# 3. Restart
docker-compose up -d --build

# 4. Verify
curl http://localhost:3000/health
```

## Direct Node.js Rollback

```bash
# 1. Stop the application
kill $(pgrep -f "node src/server.js")   # or systemctl stop ssc-v2

# 2. Revert code
git log --oneline -5
git checkout <previous-commit-hash>

# 3. Install dependencies for that version
npm ci --production

# 4. Restart
node src/server.js                      # or systemctl start ssc-v2
```

## Database Rollback

**Warning:** Database migrations are forward-only. There are no automatic down migrations.

If a migration causes data issues:

```sql
-- 1. Check applied migrations
SELECT * FROM schema_migrations ORDER BY id DESC;

-- 2. Manual rollback: drop new tables if safe
-- ONLY if the migration just added tables and no data has been written
DROP TABLE IF EXISTS <new_table_name>;
DELETE FROM schema_migrations WHERE filename = '<migration_file>';
```

**For data corruption:** Restore from most recent PostgreSQL backup.

## PostgreSQL Backup/Restore

```bash
# Backup (run before any deployment)
pg_dump -U ssc_pilot ssc_v2_pilot > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore
psql -U ssc_pilot ssc_v2_pilot < backup_YYYYMMDD_HHMMSS.sql
```

## Redis

Redis data is ephemeral (rate limits, nonce cache, revocation list). No backup needed. Flushing Redis will:
- Reset rate limit counters (users can make more requests temporarily)
- Clear nonce cache (replay protection resets — low risk for short window)
- Clear token revocation list (revoked tokens become valid until they expire naturally)

```bash
redis-cli FLUSHDB    # Clear current database
```

## Escalation

If rollback fails or data is corrupted beyond recovery:
1. Stop all application instances
2. Preserve PostgreSQL data directory and logs
3. Contact platform team with: timestamp of failure, logs, last known good state
