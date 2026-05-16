// TypeScript types matching the database schema exactly
// EQS compliance: financial fields use string representation to maintain precision

export interface Company {
  id: string;
  name: string;
  code: string;
  industry: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FinancialMetric {
  id: string;
  company_id: string;
  metric_type: string;
  value: string; // DECIMAL stored as string to prevent precision loss
  currency: string;
  period_start: Date;
  period_end: Date;
  fiscal_year: number;
  fiscal_quarter: number;
  created_at: Date;
  updated_at: Date;
}

export interface CashFlow {
  id: string;
  company_id: string;
  operating_cash_flow: string; // DECIMAL as string
  investing_cash_flow: string; // DECIMAL as string
  financing_cash_flow: string; // DECIMAL as string
  free_cash_flow: string; // DECIMAL as string (computed)
  period_start: Date;
  period_end: Date;
  fiscal_year: number;
  fiscal_quarter: number;
  created_at: Date;
  updated_at: Date;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  changed_fields: string[] | null;
  user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

// Financial calculation utilities with precision preservation
export class FinancialCalculator {
  private static PRECISION_SCALE = 4;
  private static PRECISION_FACTOR = 10000; // 10^4 for 4 decimal places

  // Convert string decimal to integer for precise arithmetic
  private static toInteger(value: string): bigint {
    const [whole, fraction = ''] = value.split('.');
    const paddedFraction = fraction.padEnd(this.PRECISION_SCALE, '0');
    return BigInt(whole + paddedFraction);
  }

  // Convert integer back to decimal string
  private static toDecimal(value: bigint): string {
    const str = value.toString();
    const whole = str.slice(0, -this.PRECISION_SCALE) || '0';
    const fraction = str.slice(-this.PRECISION_SCALE).padStart(this.PRECISION_SCALE, '0');
    return `${whole}.${fraction}`.replace(/\.?0+$/, '') || '0';
  }

  // Addition with precision preservation
  static add(a: string, b: string): string {
    const aInt = this.toInteger(a);
    const bInt = this.toInteger(b);
    return this.toDecimal(aInt + bInt);
  }

  // Subtraction with precision preservation
  static subtract(a: string, b: string): string {
    const aInt = this.toInteger(a);
    const bInt = this.toInteger(b);
    return this.toDecimal(aInt - bInt);
  }

  // Multiplication with precision preservation
  static multiply(a: string, b: string): string {
    const aInt = this.toInteger(a);
    const bInt = this.toInteger(b);
    const result = (aInt * bInt) / BigInt(this.PRECISION_FACTOR);
    return this.toDecimal(result);
  }

  // Division with precision preservation
  static divide(a: string, b: string): string {
    if (b === '0' || b === '0.0000') throw new Error('Division by zero');
    const aInt = this.toInteger(a);
    const bInt = this.toInteger(b);
    const result = (aInt * BigInt(this.PRECISION_FACTOR)) / bInt;
    return this.toDecimal(result);
  }

  // Validate decimal precision (±0.1% accuracy)
  static isWithinTolerance(calculated: string, expected: string, tolerance = 0.001): boolean {
    const calc = parseFloat(calculated);
    const exp = parseFloat(expected);
    if (exp === 0) return calc === 0;
    const difference = Math.abs(calc - exp) / Math.abs(exp);
    return difference <= tolerance;
  }
}

// Database query result types
export interface DatabaseHealth {
  status: 'healthy' | 'unhealthy';
  latency?: number;
  error?: string;
}

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

// API response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Query filter types
export interface CompanyFilters {
  industry?: string;
  code?: string;
  search?: string;
}

export interface FinancialMetricFilters {
  company_id?: string;
  metric_type?: string;
  fiscal_year?: number;
  fiscal_quarter?: number;
  date_from?: string;
  date_to?: string;
}

export interface CashFlowFilters {
  company_id?: string;
  fiscal_year?: number;
  fiscal_quarter?: number;
  date_from?: string;
  date_to?: string;
}

export interface AuditLogFilters {
  table_name?: string;
  record_id?: string;
  action?: 'INSERT' | 'UPDATE' | 'DELETE';
  user_id?: string;
  date_from?: string;
  date_to?: string;
}