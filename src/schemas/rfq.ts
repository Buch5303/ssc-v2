import { z } from 'zod';
import { RFQStatus, RFQPriority, RFQCategory } from '../types/rfq';

// Currency validation regex - ISO 4217 codes
const CURRENCY_REGEX = /^[A-Z]{3}$/;

// Financial amount validation - string to prevent floating point issues
const financialAmountSchema = z.string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal number with up to 2 decimal places')
  .refine((val) => {
    const num = parseFloat(val);
    return num >= 0 && num <= 999999999.99;
  }, 'Amount must be between 0 and 999,999,999.99');

// RFQ requirement schema
export const rfqRequirementSchema = z.object({
  id: z.string().uuid().optional(),
  rfqId: z.string().uuid().optional(),
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().min(1, 'Description is required').max(2000, 'Description too long'),
  quantity: z.number().positive('Quantity must be positive'),
  unit: z.string().min(1, 'Unit is required').max(50, 'Unit too long'),
  estimatedUnitPrice: financialAmountSchema,
  specifications: z.record(z.any()).default({}),
  mandatory: z.boolean().default(true),
  weight: z.number().min(0).max(100).default(1),
  category: z.string().max(100).optional(),
  deliveryDate: z.coerce.date().optional()
});

// RFQ attachment schema
export const rfqAttachmentSchema = z.object({
  id: z.string().uuid().optional(),
  rfqId: z.string().uuid().optional(),
  filename: z.string().min(1, 'Filename required'),
  originalName: z.string().min(1, 'Original name required'),
  mimeType: z.string().min(1, 'MIME type required'),
  size: z.number().positive('Size must be positive'),
  url: z.string().url('Valid URL required'),
  uploadedBy: z.string().uuid('Valid user ID required'),
  uploadedAt: z.coerce.date().default(() => new Date()),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(false)
});

// Create RFQ schema
export const createRFQSchema = z.object({
  title: z.string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  description: z.string()
    .min(1, 'Description is required')
    .max(5000, 'Description must be less than 5000 characters'),
  category: z.nativeEnum(RFQCategory, {
    errorMap: () => ({ message: 'Invalid category' })
  }),
  priority: z.nativeEnum(RFQPriority, {
    errorMap: () => ({ message: 'Invalid priority' })
  }),
  estimatedBudget: financialAmountSchema,
  maxBudget: financialAmountSchema,
  currency: z.string().regex(CURRENCY_REGEX, 'Invalid currency code'),
  publishDate: z.coerce.date().refine(
    (date) => date >= new Date(),
    'Publish date cannot be in the past'
  ),
  submissionDeadline: z.coerce.date(),
  organizationId: z.string().uuid('Valid organization ID required'),
  departmentId: z.string().uuid().optional(),
  requirements: z.array(rfqRequirementSchema).min(1, 'At least one requirement is needed'),
  invitedVendors: z.array(z.string().uuid()).default([]),
  tags: z.array(z.string().max(50)).default([]),
  complianceRequired: z.boolean().default(false),
  regulatoryFramework: z.string().max(100).optional()
}).refine(
  (data) => new Date(data.submissionDeadline) > new Date(data.publishDate),
  {
    message: 'Submission deadline must be after publish date',
    path: ['submissionDeadline']
  }
).refine(
  (data) => parseFloat(data.maxBudget) >= parseFloat(data.estimatedBudget),
  {
    message: 'Max budget must be greater than or equal to estimated budget',
    path: ['maxBudget']
  }
);

// Update RFQ schema
export const updateRFQSchema = createRFQSchema.partial().extend({
  status: z.nativeEnum(RFQStatus).optional(),
  assignedTo: z.string().uuid().optional(),
  evaluationDate: z.coerce.date().optional(),
  awardDate: z.coerce.date().optional()
}).refine(
  (data) => {
    if (data.publishDate && data.submissionDeadline) {
      return new Date(data.submissionDeadline) > new Date(data.publishDate);
    }
    return true;
  },
  {
    message: 'Submission deadline must be after publish date',
    path: ['submissionDeadline']
  }
).refine(
  (data) => {
    if (data.estimatedBudget && data.maxBudget) {
      return parseFloat(data.maxBudget) >= parseFloat(data.estimatedBudget);
    }
    return true;
  },
  {
    message: 'Max budget must be greater than or equal to estimated budget',
    path: ['maxBudget']
  }
);

// Query parameters schema
export const rfqQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.array(z.nativeEnum(RFQStatus)).optional(),
  category: z.array(z.nativeEnum(RFQCategory)).optional(),
  priority: z.array(z.nativeEnum(RFQPriority)).optional(),
  organizationId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  tags: z.array(z.string().max(50)).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'submissionDeadline', 'estimatedBudget']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
}).refine(
  (data) => {
    if (data.dateFrom && data.dateTo) {
      return data.dateTo >= data.dateFrom;
    }
    return true;
  },
  {
    message: 'End date must be after start date',
    path: ['dateTo']
  }
);

// RFQ ID parameter schema
export const rfqIdSchema = z.object({
  id: z.string().uuid('Valid RFQ ID required')
});

// Validation helper functions
export const validateCreateRFQ = (data: unknown) => {
  try {
    return {
      success: true,
      data: createRFQSchema.parse(data)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof z.ZodError ? error.errors : [{ message: 'Invalid data' }]
    };
  }
};

export const validateUpdateRFQ = (data: unknown) => {
  try {
    return {
      success: true,
      data: updateRFQSchema.parse(data)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof z.ZodError ? error.errors : [{ message: 'Invalid data' }]
    };
  }
};

export const validateRFQQuery = (data: unknown) => {
  try {
    return {
      success: true,
      data: rfqQuerySchema.parse(data)
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof z.ZodError ? error.errors : [{ message: 'Invalid query parameters' }]
    };
  }
};