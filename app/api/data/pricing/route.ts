import { NextRequest, NextResponse } from 'next/server';
import { requireSessionOrInternal } from "@/lib/api-guard";
import { z } from 'zod';
import pool from '@/lib/db/connection';
import { validateAndSanitize, checkRateLimit } from '@/lib/db/validators';
import { executeWithAudit, getExistingRecord } from '@/lib/db/audit';
import { PricingSchema, type PricingInput, type ApiResponse } from '@/types/api-schemas';
import { v4 as uuidv4 } from 'uuid';

// Get client IP address
function getClientIP(request: NextRequest): string {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  const xRealIP = request.headers.get('x-real-ip');
  const remoteAddr = request.headers.get('remote-addr');
  
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  if (xRealIP) {
    return xRealIP;
  }
  if (remoteAddr) {
    return remoteAddr;
  }
  return '127.0.0.1';
}

export async function POST(request: NextRequest) {
  const denied = await requireSessionOrInternal(request);
  if (denied) return denied;
  const startTime = Date.now();
  const clientIP = getClientIP(request);
  const userAgent = request.headers.get('user-agent') || '';
  
  try {
    // Rate limiting check
    if (!checkRateLimit(clientIP)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
            details: 'Maximum 100 requests per minute allowed'
          }
        } as ApiResponse,
        { status: 429 }
      );
    }
    
    // Parse and validate JSON body
    let body: unknown;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Invalid JSON format',
            code: 'INVALID_JSON',
            details: 'Request body must be valid JSON'
          }
        } as ApiResponse,
        { status: 400 }
      );
    }
    
    // Validate and sanitize input
    const validation = validateAndSanitize(PricingSchema, body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: validation.error.errors
          }
        } as ApiResponse,
        { status: 400 }
      );
    }
    
    const pricingData = validation.data;
    const recordId = uuidv4();
    
    // Check if similar pricing record exists
    const existingQuery = `
      SELECT * FROM pricing 
      WHERE product_id = $1 AND region = $2 AND currency = $3
      ORDER BY created_at DESC LIMIT 1
    `;
    const existingResult = await pool.query(existingQuery, [
      pricingData.product_id,
      pricingData.region,
      pricingData.currency
    ]);
    
    const existingRecord = existingResult.rows[0] || null;
    
    // Execute database transaction with audit
    const { result, auditTrailId } = await executeWithAudit(
      pool,
      'pricing',
      recordId,
      existingRecord ? 'update' : 'insert',
      existingRecord,
      { ...pricingData, id: recordId },
      clientIP,
      userAgent,
      async (client) => {
        if (existingRecord) {
          // Update existing record
          const updateQuery = `
            UPDATE pricing 
            SET price = $2, effective_date = $3, tier = $4, notes = $5, updated_at = NOW()
            WHERE id = $1
            RETURNING *
          `;
          const updateResult = await client.query(updateQuery, [
            existingRecord.id,
            pricingData.price,
            pricingData.effective_date,
            pricingData.tier,
            pricingData.notes
          ]);
          return updateResult.rows[0];
        } else {
          // Insert new record
          const insertQuery = `
            INSERT INTO pricing (
              id, product_id, price, currency, effective_date, tier, region, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `;
          const insertResult = await client.query(insertQuery, [
            recordId,
            pricingData.product_id,
            pricingData.price,
            pricingData.currency,
            pricingData.effective_date,
            pricingData.tier,
            pricingData.region,
            pricingData.notes
          ]);
          return insertResult.rows[0];
        }
      }
    );
    
    // Check response time constraint
    const responseTime = Date.now() - startTime;
    if (responseTime > 2000) {
      console.warn(`Pricing API response time exceeded 2s: ${responseTime}ms`);
    }
    
    return NextResponse.json(
      {
        success: true,
        data: result,
        audit_trail_id: auditTrailId
      } as ApiResponse,
      { status: 200 }
    );
    
  } catch (error) {
    console.error('Pricing API error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: {
          message: 'Internal server error',
          code: 'INTERNAL_ERROR',
          details: process.env.NODE_ENV === 'development' ? error : undefined
        }
      } as ApiResponse,
      { status: 500 }
    );
  }
}