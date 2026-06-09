/**
 * Canonical `@/db` entry point.
 *
 * The Drizzle client + pool live in `@/lib/db`. Generated routes (e.g.
 * app/api/audit/route.ts) import `{ db }` from `@/db`, so this module
 * re-exports the singleton client and helpers under that canonical path.
 *
 * Table schemas live under `@/db/schema/*` (e.g. `@/db/schema/auditLog`).
 */
export { db, pool, closePool } from "@/lib/db";
