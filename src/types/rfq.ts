import { z } from 'zod';

// Core RFQ status enum
export enum RFQStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  IN_PROGRESS = 'in_progress',
  EVALUATION = 'evaluation',
  AWARDED = 'awarded',
  CANCELLED = 'cancelled',
  CLOSED = 'closed'
}

// Priority levels
export enum RFQPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

// RFQ Category
export enum RFQCategory {
  GOODS = 'goods',
  SERVICES = 'services',
  CONSTRUCTION = 'construction',
  CONSULTING = 'consulting',
  MAINTENANCE = 'maintenance',
  SOFTWARE = 'software',
  OTHER = 'other'
}

// Base RFQ interface
export interface RFQ {
  id: string;
  rfqNumber: string;
  title: string;
  description: string;
  category: RFQCategory;
  status: RFQStatus;
  priority: RFQPriority;
  
  // Financial fields - using string to prevent floating point drift
  estimatedBudget: string;
  maxBudget: string;
  currency: string;
  
  // Dates
  publishDate: Date;
  submissionDeadline: Date;
  evaluationDate?: Date;
  awardDate?: Date;
  
  // Organization
  organizationId: string;
  departmentId?: string;
  createdBy: string;
  assignedTo?: string;
  
  // Requirements
  requirements: RFQRequirement[];
  attachments: RFQAttachment[];
  
  // Vendor management
  invitedVendors: string[];
  submissionCount: number;
  
  // Audit fields
  createdAt: Date;
  updatedAt: Date;
  version: number;
  
  // Additional metadata
  tags: string[];
  isTemplate: boolean;
  templateId?: string;
  
  // Compliance
  complianceRequired: boolean;
  regulatoryFramework?: string;
}

// RFQ requirement line item
export interface RFQRequirement {
  id: string;
  rfqId: string;
  title: string;
  description: string;
  quantity: number;
  unit: string;
  estimatedUnitPrice: string;
  specifications: Record<string, any>;
  mandatory: boolean;
  weight: number; // For scoring
  category?: string;
  deliveryDate?: Date;
}

// RFQ attachment
export interface RFQAttachment {
  id: string;
  rfqId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  uploadedBy: string;
  uploadedAt: Date;
  description?: string;
  isPublic: boolean;
}

// Create RFQ payload
export interface CreateRFQPayload {
  title: string;
  description: string;
  category: RFQCategory;
  priority: RFQPriority;
  estimatedBudget: string;
  maxBudget: string;
  currency: string;
  publishDate: Date;
  submissionDeadline: Date;
  organizationId: string;
  departmentId?: string;
  requirements: Omit<RFQRequirement, 'id' | 'rfqId'>[];
  invitedVendors?: string[];
  tags?: string[];
  complianceRequired?: boolean;
  regulatoryFramework?: string;
}

// Update RFQ payload
export interface UpdateRFQPayload extends Partial<CreateRFQPayload> {
  status?: RFQStatus;
  assignedTo?: string;
  evaluationDate?: Date;
  awardDate?: Date;
}

// RFQ list query parameters
export interface RFQQueryParams {
  page?: number;
  limit?: number;
  status?: RFQStatus[];
  category?: RFQCategory[];
  priority?: RFQPriority[];
  organizationId?: string;
  departmentId?: string;
  createdBy?: string;
  assignedTo?: string;
  search?: string;
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  sortBy?: 'createdAt' | 'updatedAt' | 'submissionDeadline' | 'estimatedBudget';
  sortOrder?: 'asc' | 'desc';
}

// RFQ list response
export interface RFQListResponse {
  data: RFQ[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    applied: Record<string, any>;
    available: {
      statuses: RFQStatus[];
      categories: RFQCategory[];
      priorities: RFQPriority[];
    };
  };
}

// Audit log entry
export interface RFQAuditLog {
  id: string;
  rfqId: string;
  action: string;
  field?: string;
  oldValue?: any;
  newValue?: any;
  userId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// Performance metrics
export interface RFQMetrics {
  rfqId: string;
  queryDuration: number;
  responseSize: number;
  cacheHit: boolean;
  timestamp: Date;
}