// Load environment variables before any imports
import 'dotenv/config';
import { parseEnv } from '../src/config/env';
import { neon } from '@neondatabase/serverless';

// Banner with timestamp
const startTime = new Date();
console.log(`\n=== FlowSeer W251 BOP — Environment Preflight (EQS v1.0) ===`);
console.log(`Timestamp: ${startTime.toISOString()}\n`);

/**
 * Timeout promise that rejects after specified milliseconds
 */
function createTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Database connection timeout after ${ms}ms`));
    }, ms);
  });
}

/**
 * Mask sensitive environment variables for display
 */
function maskValue(key: string, value: string): string {
  switch (key) {
    case 'DATABASE_URL':
      try {
        const url = new URL(value);
        return `${url.protocol}//***@${url.host}${url.pathname}`;
      } catch {
        return '*** (invalid URL)';
      }
    
    case 'NEXTAUTH_SECRET':
      if (value.length < 6) {
        return '****';
      }
      return `${value.slice(0, 4)}****${value.slice(-2)}`;
    
    case 'NEXTAUTH_URL':
    case 'NODE_ENV':
      return value;
    
    case 'NEXT_PUBLIC_APP_URL':
      return value || 'not set (optional)';
    
    case 'DB_POOL_MAX':
    case 'DB_CONNECT_TIMEOUT_MS':
      return value;
    
    default:
      return value;
  }
}

/**
 * Format table row with consistent spacing
 */
function formatTableRow(variable: string, status: string, value: string): string {
  const variableCol = variable.padEnd(25);
  const statusCol = status.padEnd(10);
  return `  ${variableCol} | ${statusCol} | ${value}`;
}

async function main(): Promise<void> {
  // STEP 1 - Environment Validation
  const parseResult = parseEnv(process.env);
  
  if (!parseResult.success) {
    console.error('❌ PREFLIGHT FAILED — Environment Validation Errors:');
    parseResult.errors.forEach((error) => {
      console.error(`  • ${error.field}: ${error.message}`);
    });
    console.error(`\nTotal errors: ${parseResult.errors.length}`);
    process.exit(1);
  }
  
  const env = parseResult.data;
  
  // STEP 2 - Database Ping
  console.log('Checking database connectivity...');
  
  let dbLatency: number;
  try {
    const sql = neon(env.DATABASE_URL);
    const pingStart = Date.now();
    
    // Use Promise.race with timeout
    await Promise.race([
      sql`SELECT 1 AS ping`,
      createTimeout(env.DB_CONNECT_TIMEOUT_MS)
    ]);
    
    dbLatency = Date.now() - pingStart;
  } catch (error) {
    console.error('❌ PREFLIGHT FAILED — Database Connectivity:');
    console.error(`  ${error instanceof Error ? error.message : 'Unknown database error'}`);
    process.exit(1);
  }
  
  // STEP 3 - Success Summary Table
  console.log('\n✅ PREFLIGHT VALIDATION RESULTS\n');
  console.log(formatTableRow('VARIABLE', 'STATUS', 'MASKED VALUE'));
  console.log('  ' + '-'.repeat(70));
  
  // Environment variables
  const envVars = [
    'DATABASE_URL',
    'NEXTAUTH_SECRET', 
    'NEXTAUTH_URL',
    'NODE_ENV',
    'NEXT_PUBLIC_APP_URL',
    'DB_POOL_MAX',
    'DB_CONNECT_TIMEOUT_MS'
  ];
  
  envVars.forEach((key) => {
    const value = key === 'NEXT_PUBLIC_APP_URL' 
      ? env.NEXT_PUBLIC_APP_URL 
      : String(env[key as keyof typeof env]);
    const maskedValue = maskValue(key, value || '');
    console.log(formatTableRow(key, '✅ OK', maskedValue));
  });
  
  // Database ping result
  console.log(formatTableRow('DB_PING', '✅ OK', `${dbLatency}ms`));
  
  // Footer with counts
  const totalDuration = Date.now() - startTime.getTime();
  console.log(`\n✅ PREFLIGHT PASSED — All 8 variables validated. DB ping ${dbLatency}ms. Safe to proceed.\n`);
  
  // Audit log line
  const dbHost = new URL(env.DATABASE_URL).host;
  console.log(`AUDIT: preflight_passed | timestamp=${new Date().toISOString()} | node_env=${env.NODE_ENV} | db_host=${dbHost} | duration=${totalDuration}ms`);
  
  process.exit(0);
}

// Execute main function with error handling
main().catch((error) => {
  console.error('❌ PREFLIGHT FAILED — Unexpected Error:');
  console.error(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
});