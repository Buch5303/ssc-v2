import { z } from 'zod';

// Pricing Schema
export const PricingSchema = z.object({
  product_id: z.string().min(1, 'Product ID is required'),
  price: z.number().positive('Price must be positive').max(999999.99, 'Price exceeds maximum'),
  currency: z.string().length(3, 'Currency must be 3 characters').regex(/^[A-Z]{3}$/, 'Currency must be uppercase'),
  effective_date: z.string().datetime('Invalid datetime format'),
  tier: z.enum(['standard', 'premium', 'enterprise']).optional(),
  region: z.string().min(1, 'Region is required'),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional()
});

export type PricingInput = z.infer<typeof PricingSchema>;

// Contacts Schema
export const ContactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name cannot exceed 100 characters'),
  email: z.string().email('Invalid email format').max(255, 'Email cannot exceed 255 characters'),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone format').optional(),
  company: z.string().min(1, 'Company is required').max(100, 'Company cannot exceed 100 characters'),
  position: z.string().max(100, 'Position cannot exceed 100 characters').optional(),
  country: z.string().length(2, 'Country must be 2-character code').regex(/^[A-Z]{2}$/, 'Country must be uppercase'),
  industry: z.string().max(50, 'Industry cannot exceed 50 characters').optional(),
  lead_source: z.enum(['website', 'referral', 'trade_show', 'cold_outreach', 'social_media']).optional(),
  notes: z.string().max(1000, 'Notes cannot exceed 1000 characters').optional()
});

export type ContactInput = z.infer<typeof ContactSchema>;

// RFQ Schema
export const RFQSchema = z.object({
  rfq_number: z.string().min(1, 'RFQ number is required').max(50, 'RFQ number cannot exceed 50 characters'),
  customer_id: z.string().min(1, 'Customer ID is required'),
  product_specs: z.array(z.object({
    product_id: z.string().min(1, 'Product ID is required'),
    quantity: z.number().int().positive('Quantity must be positive'),
    specifications: z.record(z.string(), z.any()).optional()
  })).min(1, 'At least one product specification required'),
  delivery_date: z.string().datetime('Invalid datetime format'),
  delivery_location: z.string().min(1, 'Delivery location is required').max(200, 'Delivery location cannot exceed 200 characters'),
  budget_range: z.object({
    min: z.number().nonnegative('Minimum budget cannot be negative'),
    max: z.number().positive('Maximum budget must be positive'),
    currency: z.string().length(3, 'Currency must be 3 characters').regex(/^[A-Z]{3}$/, 'Currency must be uppercase')
  }).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  contact_person: z.string().min(1, 'Contact person is required').max(100, 'Contact person cannot exceed 100 characters'),
  notes: z.string().max(2000, 'Notes cannot exceed 2000 characters').optional()
});

export type RFQInput = z.infer<typeof RFQSchema>;

// Audit Metadata Schema
export const AuditMetadataSchema = z.object({
  id: z.string().uuid(),
  table_name: z.string(),
  record_id: z.string(),
  operation: z.enum(['insert', 'update', 'delete']),
  before_snapshot: z.record(z.string(), z.any()).nullable(),
  after_snapshot: z.record(z.string(), z.any()),
  changed_fields: z.array(z.string()),
  timestamp: z.string().datetime(),
  source_ip: z.string(),
  user_agent: z.string().optional(),
  audit_trail_id: z.string().uuid()
});

export type AuditMetadata = z.infer<typeof AuditMetadataSchema>;

// API Response Schema
export const ApiResponseSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  audit_trail_id: z.string().uuid().optional(),
  error: z.object({
    message: z.string(),
    code: z.string(),
    details: z.any().optional()
  }).optional()
});

export type ApiResponse = z.infer<typeof ApiResponseSchema>;