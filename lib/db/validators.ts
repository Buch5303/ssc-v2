import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

// Input sanitization to prevent SQL injection
export function sanitizeString(input: string): string {
  if (typeof input !== 'string') return '';
  
  // Remove potential SQL injection patterns
  const sqlPatterns = [
    /('|(\-\-)|;|\||\*|\%)/gi,
    /(union|select|insert|update|delete|drop|create|alter|exec|execute)/gi,
    /(script|javascript|vbscript|onload|onerror|onclick)/gi
  ];
  
  let sanitized = input;
  sqlPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  
  // Additional HTML sanitization
  sanitized = DOMPurify.sanitize(sanitized, { ALLOWED_TAGS: [] });
  
  return sanitized.trim();
}

// Deep sanitize object recursively
export function sanitizeObject<T extends Record<string, any>>(obj: T): T {
  const sanitized = { ...obj };
  
  Object.keys(sanitized).forEach(key => {
    const value = sanitized[key];
    
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? sanitizeString(item) :
        typeof item === 'object' ? sanitizeObject(item) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    }
  });
  
  return sanitized;
}

// Validate and sanitize input data
export function validateAndSanitize<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: z.ZodError } {
  try {
    // First sanitize if it's an object
    const sanitizedData = typeof data === 'object' && data !== null 
      ? sanitizeObject(data as Record<string, any>)
      : data;
    
    // Then validate with schema
    const result = schema.safeParse(sanitizedData);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return { success: false, error: result.error };
    }
  } catch (error) {
    // Create a ZodError for consistency
    const zodError = new z.ZodError([
      {
        code: 'custom',
        message: 'Validation failed during sanitization',
        path: []
      }
    ]);
    return { success: false, error: zodError };
  }
}

// Rate limiting cache (in-memory for simplicity)
const rateLimitCache = new Map<string, { count: number; resetTime: number }>();

// Rate limiting: 100 requests per minute per IP
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 100;
  
  const current = rateLimitCache.get(ip);
  
  if (!current || now > current.resetTime) {
    rateLimitCache.set(ip, {
      count: 1,
      resetTime: now + windowMs
    });
    return true;
  }
  
  if (current.count >= maxRequests) {
    return false;
  }
  
  current.count++;
  return true;
}

// Clean up rate limit cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitCache.entries()) {
    if (now > data.resetTime) {
      rateLimitCache.delete(ip);
    }
  }
}, 60000); // Clean every minute