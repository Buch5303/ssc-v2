import type { NextApiRequest, NextApiResponse } from 'next';
import { validateCreateRFQ, validateRFQQuery } from '../../../schemas/rfq';
import { createRFQ, getRFQs, logPerformanceMetrics } from '../../../lib/db/rfq-queries';
import { generateRFQNumber, sanitizeErrorResponse } from '../../../lib/rfq-utils';
import type { RFQ, RFQListResponse, CreateRFQPayload } from '../../../types/rfq';

// Performance monitoring
const startTimer = () => process.hrtime();
const endTimer = (start: [number, number]) => {
  const [seconds, nanoseconds] = process.hrtime(start);
  return seconds * 1000 + nanoseconds / 1000000;
};

// Cache headers for GET requests
const setCacheHeaders = (res: NextApiResponse) => {
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('ETag', `"rfqs-${Date.now()}"`);
};

// Error response structure
interface ErrorResponse {
  error: string;
  message: string;
  code: number;
  timestamp: string;
  details?: any;
}

const createErrorResponse = (
  error: string,
  message: string,
  code: number,
  details?: any
): ErrorResponse => ({
  error,
  message,
  code,
  timestamp: new Date().toISOString(),
  details: sanitizeErrorResponse(details)
});

// GET /api/rfqs - List RFQs with pagination and filtering
const handleGetRFQs = async (req: NextApiRequest, res: NextApiResponse) => {
  const timer = startTimer();
  
  try {
    // Validate query parameters
    const queryValidation = validateRFQQuery(req.query);
    if (!queryValidation.success) {
      return res.status(400).json(
        createErrorResponse(
          'VALIDATION_ERROR',
          'Invalid query parameters',
          400,
          queryValidation.error
        )
      );
    }

    const queryParams = queryValidation.data;
    const result = await getRFQs(queryParams);

    // Set cache headers for GET requests
    setCacheHeaders(res);

    const duration = endTimer(timer);
    
    // Log performance metrics
    await logPerformanceMetrics({
      rfqId: 'list',
      queryDuration: duration,
      responseSize: JSON.stringify(result).length,
      cacheHit: false,
      timestamp: new Date()
    });

    // EQS compliance check - must be under 300ms
    if (duration > 300) {
      console.warn(`RFQ list query exceeded 300ms threshold: ${duration}ms`);
    }

    const response: RFQListResponse = {
      data: result.data,
      pagination: result.pagination,
      filters: result.filters
    };

    return res.status(200).json(response);
  } catch (error) {
    const duration = endTimer(timer);
    console.error('GET /api/rfqs error:', error);
    
    return res.status(500).json(
      createErrorResponse(
        'INTERNAL_SERVER_ERROR',
        'Failed to fetch RFQs',
        500,
        process.env.NODE_ENV === 'development' ? error : undefined
      )
    );
  }
};

// POST /api/rfqs - Create new RFQ
const handleCreateRFQ = async (req: NextApiRequest, res: NextApiResponse) => {
  const timer = startTimer();
  
  try {
    // Validate request body
    const validation = validateCreateRFQ(req.body);
    if (!validation.success) {
      return res.status(400).json(
        createErrorResponse(
          'VALIDATION_ERROR',
          'Invalid RFQ data',
          400,
          validation.error
        )
      );
    }

    const rfqData = validation.data as CreateRFQPayload;
    
    // Generate RFQ number
    const rfqNumber = await generateRFQNumber(rfqData.organizationId);
    
    // Create RFQ
    const createdRFQ = await createRFQ({
      ...rfqData,
      rfqNumber
    });

    const duration = endTimer(timer);
    
    // Log performance metrics
    await logPerformanceMetrics({
      rfqId: createdRFQ.id,
      queryDuration: duration,
      responseSize: JSON.stringify(createdRFQ).length,
      cacheHit: false,
      timestamp: new Date()
    });

    // EQS compliance check
    if (duration > 300) {
      console.warn(`RFQ creation exceeded 300ms threshold: ${duration}ms`);
    }

    return res.status(201).json({
      success: true,
      data: createdRFQ,
      message: 'RFQ created successfully'
    });
  } catch (error) {
    const duration = endTimer(timer);
    console.error('POST /api/rfqs error:', error);
    
    // Handle specific database errors
    if (error && typeof error === 'object' && 'code' in error) {
      switch (error.code) {
        case '23505': // Unique constraint violation
          return res.status(409).json(
            createErrorResponse(
              'CONFLICT',
              'RFQ with this identifier already exists',
              409
            )
          );
        case '23503': // Foreign key violation
          return res.status(400).json(
            createErrorResponse(
              'FOREIGN_KEY_ERROR',
              'Invalid reference to organization or department',
              400
            )
          );
        default:
          break;
      }
    }
    
    return res.status(500).json(
      createErrorResponse(
        'INTERNAL_SERVER_ERROR',
        'Failed to create RFQ',
        500,
        process.env.NODE_ENV === 'development' ? error : undefined
      )
    );
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Add request logging for audit trail
  console.log(`${req.method} /api/rfqs - ${new Date().toISOString()}`);
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  switch (req.method) {
    case 'GET':
      return handleGetRFQs(req, res);
    case 'POST':
      return handleCreateRFQ(req, res);
    default:
      return res.status(405).json(
        createErrorResponse(
          'METHOD_NOT_ALLOWED',
          `Method ${req.method} not allowed`,
          405
        )
      );
  }
}