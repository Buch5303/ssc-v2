/**
 * Performance timing utility for EQS v1.0 compliance
 * Provides auditable latency measurements via performance.now() API
 * 
 * @see EQS v1.0 requirement: 100% auditable latency data on all mutations
 */

// Module-scoped timing marks storage
const _marks = new Map<string, number>();

/**
 * Start a performance timing mark
 * 
 * @param label - Unique identifier for the timing measurement
 * @throws Error if label already exists (prevents timing conflicts)
 */
export function markStart(label: string): void {
  if (_marks.has(label)) {
    throw new Error(`Performance mark '${label}' already started. Call markEnd() first or use a different label.`);
  }
  _marks.set(label, performance.now());
}

/**
 * End a performance timing mark and return elapsed milliseconds
 * 
 * @param label - Identifier for the timing measurement started with markStart()
 * @returns Elapsed time in milliseconds (float, rounded to 2 decimal places)
 * @throws Error if label was not previously started with markStart()
 */
export function markEnd(label: string): number {
  const startTime = _marks.get(label);
  
  if (startTime === undefined) {
    throw new Error(`Performance mark '${label}' not found. Call markStart('${label}') first.`);
  }
  
  const elapsed = performance.now() - startTime;
  
  // Clean up the mark to prevent memory leaks in long-running processes
  _marks.delete(label);
  
  // Round to 2 decimal places for consistent Server-Timing header format
  return Math.round(elapsed * 100) / 100;
}