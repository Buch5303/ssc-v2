import type { UserRole } from '../db/schema';

export interface AuditDenialPayload {
  userId: string | null;
  role: UserRole | null;
  pathname: string;
  method: string;
  timestamp: string;
  requestId: string;
}

export function auditDenial(payload: AuditDenialPayload): void {
  // Fire-and-forget fetch to audit endpoint
  // Using keepalive to ensure the request completes even if the page unloads
  fetch('/api/internal/audit-denial', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(error => {
    // Log error but don't throw - this is fire-and-forget
    console.error('Failed to audit denial:', error);
  });
}