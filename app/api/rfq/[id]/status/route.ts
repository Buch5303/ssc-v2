import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { rfqs, auditLogs } from '@/lib/db/schema';

// State machine transitions: enforces financial integrity gating
const TRANSITIONS: Record<string, string[]> = {
  pending: ['active'],
  active: ['closed', 'awarded'],
  closed: [],
  awarded: []
};

const VALID_STATUSES = ['pending', 'active', 'closed', 'awarded'];

interface StatusUpdateRequest {
  status: string;
  actor_id: string;
}

interface IllegalTransitionError {
  code: 'ILLEGAL_TRANSITION';
  from: string;
  to: string;
}

interface NotFoundError {
  code: 'NOT_FOUND';
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rfqId = params.id;
    
    if (!rfqId) {
      return Response.json(
        { error: 'RFQ ID is required' },
        { status: 400 }
      );
    }

    // Parse and validate request body
    let body: StatusUpdateRequest;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Validate status value
    if (!body.status || !VALID_STATUSES.includes(body.status)) {
      return Response.json(
        { error: 'Invalid status value' },
        { status: 422 }
      );
    }

    // Validate actor_id
    if (!body.actor_id || typeof body.actor_id !== 'string' || body.actor_id.trim() === '') {
      return Response.json(
        { error: 'actor_id is required' },
        { status: 422 }
      );
    }

    const toStatus = body.status;
    const actorId = body.actor_id;
    const now = new Date();

    // Execute atomic transaction
    try {
      const result = await db.transaction(async (tx) => {
        // Get current RFQ
        const existingRfqs = await tx
          .select()
          .from(rfqs)
          .where(eq(rfqs.id, rfqId))
          .limit(1);

        if (existingRfqs.length === 0) {
          const notFoundError: NotFoundError = { code: 'NOT_FOUND' };
          throw notFoundError;
        }

        const currentRfq = existingRfqs[0];
        const fromStatus = currentRfq.status;

        // Validate state transition
        if (!TRANSITIONS[fromStatus]?.includes(toStatus)) {
          const illegalTransition: IllegalTransitionError = {
            code: 'ILLEGAL_TRANSITION',
            from: fromStatus,
            to: toStatus
          };
          throw illegalTransition;
        }

        // Update RFQ status
        const updatedRfqs = await tx
          .update(rfqs)
          .set({
            status: toStatus,
            updated_at: now
          })
          .where(eq(rfqs.id, rfqId))
          .returning({
            id: rfqs.id,
            status: rfqs.status,
            updated_at: rfqs.updated_at
          });

        // Insert audit log
        await tx.insert(auditLogs).values({
          entity_type: 'rfq',
          entity_id: rfqId,
          action: 'status_transition',
          payload: {
            from: fromStatus,
            to: toStatus,
            actor_id: actorId
          },
          created_at: now
        });

        return updatedRfqs[0];
      });

      return Response.json({
        id: result.id,
        status: result.status,
        updated_at: result.updated_at.toISOString()
      });

    } catch (error) {
      // Handle sentinel errors from transaction
      if (error && typeof error === 'object') {
        if ('code' in error) {
          if (error.code === 'ILLEGAL_TRANSITION') {
            const illegalError = error as IllegalTransitionError;
            return Response.json(
              { error: `Illegal transition from '${illegalError.from}' to '${illegalError.to}'` },
              { status: 422 }
            );
          }
          if (error.code === 'NOT_FOUND') {
            return Response.json(
              { error: 'RFQ not found' },
              { status: 404 }
            );
          }
        }
      }

      // Log unexpected errors
      console.error('[RFQ-STATUS-PATCH-001] Unexpected error:', error);
      return Response.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[RFQ-STATUS-PATCH-001] Handler error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
