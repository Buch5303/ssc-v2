/**
 * FlowSeer structured logger.
 *
 * Emits one JSON line per call so logs are machine-parseable in Vercel's log
 * drain and align with the EQS auditability goal (100% auditable, structured
 * events — not free-text). Dependency-free and edge/serverless safe: it only
 * touches the global `console`, so it runs identically in Node and Edge
 * runtimes and never throws.
 *
 * Interface (consumed by app/api/rfq/route.ts and app/api/health/db/route.ts):
 *   logger.info(fields)
 *   logger.warn(fields)
 *   logger.error(fields)
 *   logger.debug(fields)
 *
 * Each method accepts a structured object (preferred) or a string. The logger
 * stamps `level` and `ts` automatically; caller-supplied fields are merged on
 * top, so an explicit `timestamp` in the payload is preserved alongside `ts`.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogFields = Record<string, unknown> | string;

function emit(level: LogLevel, fields: LogFields): void {
  try {
    const base =
      typeof fields === 'string' ? { message: fields } : { ...fields };

    const record = {
      level,
      ts: new Date().toISOString(),
      ...base,
    };

    const line = JSON.stringify(record);

    // Route to the matching console stream so Vercel categorizes severity.
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  } catch {
    // A logger must never break the request path. Swallow serialization
    // failures (e.g. circular refs) rather than throw.
  }
}

export const logger = {
  debug: (fields: LogFields) => emit('debug', fields),
  info: (fields: LogFields) => emit('info', fields),
  warn: (fields: LogFields) => emit('warn', fields),
  error: (fields: LogFields) => emit('error', fields),
};

export default logger;
