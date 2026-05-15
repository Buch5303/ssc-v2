import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { AuditMetadata } from '@/types/api-schemas';

// Deep object comparison for change detection
function deepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;
  
  if (typeof obj1 === 'object') {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!deepEqual(obj1[key], obj2[key])) return false;
    }
    
    return true;
  }
  
  return false;
}

// Detect changed fields between before and after snapshots
function getChangedFields(before: any, after: any): string[] {
  if (!before) return Object.keys(after || {});
  if (!after) return [];
  
  const changed: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  
  for (const key of allKeys) {
    if (!deepEqual(before[key], after[key])) {
      changed.push(key);
    }
  }
  
  return changed;
}

// Create audit metadata
export function createAuditMetadata({
  tableName,
  recordId,
  operation,
  beforeSnapshot = null,
  afterSnapshot,
  sourceIp,
  userAgent = ''
}: {
  tableName: string;
  recordId: string;
  operation: 'insert' | 'update' | 'delete';
  beforeSnapshot?: any;
  afterSnapshot: any;
  sourceIp: string;
  userAgent?: string;
}): AuditMetadata {
  const auditTrailId = uuidv4();
  const changedFields = getChangedFields(beforeSnapshot, afterSnapshot);
  
  return {
    id: uuidv4(),
    table_name: tableName,
    record_id: recordId,
    operation,
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    changed_fields: changedFields,
    timestamp: new Date().toISOString(),
    source_ip: sourceIp,
    user_agent: userAgent,
    audit_trail_id: auditTrailId
  };
}

// Save audit record to database
export async function saveAuditRecord(
  pool: Pool,
  auditData: AuditMetadata
): Promise<void> {
  const query = `
    INSERT INTO audit_log (
      id, table_name, record_id, operation, before_snapshot, after_snapshot,
      changed_fields, timestamp, source_ip, user_agent, audit_trail_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  `;
  
  const values = [
    auditData.id,
    auditData.table_name,
    auditData.record_id,
    auditData.operation,
    JSON.stringify(auditData.before_snapshot),
    JSON.stringify(auditData.after_snapshot),
    JSON.stringify(auditData.changed_fields),
    auditData.timestamp,
    auditData.source_ip,
    auditData.user_agent,
    auditData.audit_trail_id
  ];
  
  await pool.query(query, values);
}

// Execute database transaction with audit trail
export async function executeWithAudit<T>(
  pool: Pool,
  tableName: string,
  recordId: string,
  operation: 'insert' | 'update' | 'delete',
  beforeSnapshot: any | null,
  afterSnapshot: any,
  sourceIp: string,
  userAgent: string,
  dbOperation: (client: any) => Promise<T>
): Promise<{ result: T; auditTrailId: string }> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Execute the main database operation
    const result = await dbOperation(client);
    
    // Create audit metadata
    const auditData = createAuditMetadata({
      tableName,
      recordId,
      operation,
      beforeSnapshot,
      afterSnapshot,
      sourceIp,
      userAgent
    });
    
    // Save audit record
    const auditQuery = `
      INSERT INTO audit_log (
        id, table_name, record_id, operation, before_snapshot, after_snapshot,
        changed_fields, timestamp, source_ip, user_agent, audit_trail_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    
    const auditValues = [
      auditData.id,
      auditData.table_name,
      auditData.record_id,
      auditData.operation,
      JSON.stringify(auditData.before_snapshot),
      JSON.stringify(auditData.after_snapshot),
      JSON.stringify(auditData.changed_fields),
      auditData.timestamp,
      auditData.source_ip,
      auditData.user_agent,
      auditData.audit_trail_id
    ];
    
    await client.query(auditQuery, auditValues);
    
    await client.query('COMMIT');
    
    return {
      result,
      auditTrailId: auditData.audit_trail_id
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Get existing record for before snapshot
export async function getExistingRecord(
  pool: Pool,
  tableName: string,
  recordId: string
): Promise<any | null> {
  try {
    const query = `SELECT * FROM ${tableName} WHERE id = $1`;
    const result = await pool.query(query, [recordId]);
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching existing record:', error);
    return null;
  }
}