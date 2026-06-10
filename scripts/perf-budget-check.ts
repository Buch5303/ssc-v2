#!/usr/bin/env node
/**
 * Performance budget check script for CI/CD pipeline
 * Enforces EQS v1.0 API response < 500ms requirement
 * 
 * Usage: npm run perf:check
 * Exit codes:
 *   0 = Pass (response time < 500ms)
 *   1 = Fail (response time >= 500ms or HTTP error)
 *   2 = Configuration error (missing BASE_URL)
 */

// Node.js 18+ has native fetch support (Vercel default runtime)
const fetch = globalThis.fetch;

async function checkPerformanceBudget(): Promise<void> {
  // Read base URL from environment
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  
  if (!baseUrl) {
    console.error('[perf:check] ERROR: NEXT_PUBLIC_APP_URL environment variable not set');
    process.exit(2);
  }
  
  const targetUrl = `${baseUrl}/api/rfq`;
  
  try {
    // Create AbortController for 10-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    console.log(`[perf:check] Testing ${targetUrl}...`);
    
    // Measure request duration
    const start = Date.now();
    
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    const end = Date.now();
    clearTimeout(timeoutId);
    
    const duration = end - start;
    
    console.log(`[perf:check] GET /api/rfq responded in ${duration}ms`);
    
    // Check HTTP status
    if (!response.ok) {
      console.error(`[perf:check] FAIL: HTTP ${response.status} ${response.statusText}`);
      process.exit(1);
    }
    
    // Check performance budget (EQS API response < 500ms)
    if (duration >= 500) {
      console.error(
        `[perf:check] FAIL: response time ${duration}ms exceeds 500ms budget (EQS: API response < 500ms)`
      );
      process.exit(1);
    }
    
    console.log('[perf:check] PASS');
    process.exit(0);
    
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('[perf:check] FAIL: Request timed out after 10 seconds');
    } else {
      console.error(`[perf:check] FAIL: Request error - ${error}`);
    }
    process.exit(1);
  }
}

// Execute performance check
checkPerformanceBudget().catch((error) => {
  console.error(`[perf:check] Unexpected error: ${error}`);
  process.exit(1);
});