// Database types with EQS v1.0 compliance
// Financial precision maintained with Decimal type handling

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user' | 'viewer';
  created_at: Date;
  updated_at: Date;
  is_active: boolean;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  account_type: 'checking' | 'savings' | 'investment' | 'credit';
  balance: string; // DECIMAL(15,4) as string to preserve precision
  currency: string;
  created_at: Date;
  updated_at: Date;
  version: number;
}

export interface Transaction {
  id: string;
  account_id: string;
  amount: string; // DECIMAL(15,4) as string to preserve precision
  transaction_type: 'debit' | 'credit' | 'transfer';
  description?: string;
  category?: string;
  transaction_date: Date;
  created_at: Date;
  reference_id?: string;
  metadata: Record<string, any>;
}

export interface AuditLog {
  id: string;
  table_name: string;
  record_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  user_id?: string;
  timestamp: Date;
  ip_address?: string;
  user_agent?: string;
  checksum: string;
}

export interface DashboardMetric {
  id: string;
  user_id: string;
  metric_type: string;
  metric_value?: string; // DECIMAL(15,4) as string
  metric_data: Record<string, any>;
  period_start?: Date;
  period_end?: Date;
  created_at: Date;
  expires_at?: Date;
}

// Financial calculation utilities with precision preservation
export class FinancialAmount {
  private value: string;
  
  constructor(amount: string | number) {
    if (typeof amount === 'number') {
      // Convert to string with 4 decimal places
      this.value = amount.toFixed(4);
    } else {
      // Validate decimal format
      if (!/^-?\d+(\.\d{1,4})?$/.test(amount)) {
        throw new Error(`Invalid financial amount format: ${amount}`);
      }
      // Ensure 4 decimal places
      const num = parseFloat(amount);
      this.value = num.toFixed(4);
    }
  }
  
  toString(): string {
    return this.value;
  }
  
  toNumber(): number {
    return parseFloat(this.value);
  }
  
  add(other: FinancialAmount): FinancialAmount {
    const sum = this.toNumber() + other.toNumber();
    return new FinancialAmount(sum.toFixed(4));
  }
  
  subtract(other: FinancialAmount): FinancialAmount {
    const diff = this.toNumber() - other.toNumber();
    return new FinancialAmount(diff.toFixed(4));
  }
  
  multiply(multiplier: number): FinancialAmount {
    const product = this.toNumber() * multiplier;
    return new FinancialAmount(product.toFixed(4));
  }
  
  divide(divisor: number): FinancialAmount {
    if (divisor === 0) {
      throw new Error('Division by zero');
    }
    const quotient = this.toNumber() / divisor;
    return new FinancialAmount(quotient.toFixed(4));
  }
  
  equals(other: FinancialAmount, tolerance: number = 0.0001): boolean {
    return Math.abs(this.toNumber() - other.toNumber()) <= tolerance;
  }
  
  isPositive(): boolean {
    return this.toNumber() > 0;
  }
  
  isNegative(): boolean {
    return this.toNumber() < 0;
  }
  
  isZero(): boolean {
    return Math.abs(this.toNumber()) < 0.0001;
  }
  
  format(currency = 'USD', locale = 'en-US'): string {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 4
    }).format(this.toNumber());
  }
}

// Query result types
export interface DatabaseHealthCheck {
  status: 'healthy' | 'unhealthy';
  latency: number;
  timestamp: string;
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  fields: Array<{ name: string; dataTypeID: number }>;
}

// Dashboard specific types
export interface AccountSummary {
  total_balance: string;
  account_count: number;
  checking_balance: string;
  savings_balance: string;
  investment_balance: string;
  credit_balance: string;
}

export interface TransactionSummary {
  total_transactions: number;
  total_debits: string;
  total_credits: string;
  net_flow: string;
  average_transaction: string;
}

export interface MonthlyTrend {
  month: string;
  income: string;
  expenses: string;
  net: string;
  transaction_count: number;
}

// Error types
export type DatabaseErrorType = 
  | 'CONNECTION_FAILED'
  | 'QUERY_FAILED'
  | 'TRANSACTION_FAILED'
  | 'VALIDATION_FAILED'
  | 'CONSTRAINT_VIOLATION'
  | 'MISSING_ENV'
  | 'TIMEOUT';

// Migration types
export interface Migration {
  version: number;
  applied_at: Date;
}

// Connection pool configuration
export interface PoolConfig {
  max: number;
  min: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

export const DEFAULT_POOL_CONFIG: PoolConfig = {
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
};