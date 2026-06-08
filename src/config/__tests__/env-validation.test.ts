import { parseEnv, envSchema } from '../env';

describe('envSchema — Zod environment validation (EQS v1.0)', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@host.neon.tech/dbname',
    NEXTAUTH_SECRET: 'a-very-long-secret-that-is-at-least-32-chars!!',
    NEXTAUTH_URL: 'http://localhost:3000',
  };

  test('rejects config missing DATABASE_URL', () => {
    const input = {
      NEXTAUTH_SECRET: validBase.NEXTAUTH_SECRET,
      NEXTAUTH_URL: validBase.NEXTAUTH_URL,
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'DATABASE_URL')).toBe(true);
    }
  });

  test('rejects invalid DATABASE_URL (not a URL)', () => {
    const input = {
      ...validBase,
      DATABASE_URL: 'not-a-url',
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'DATABASE_URL')).toBe(true);
    }
  });

  test('rejects NEXTAUTH_SECRET shorter than 32 chars', () => {
    const input = {
      ...validBase,
      NEXTAUTH_SECRET: 'tooshort',
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'NEXTAUTH_SECRET')).toBe(true);
    }
  });

  test('rejects missing NEXTAUTH_SECRET', () => {
    const input = {
      DATABASE_URL: validBase.DATABASE_URL,
      NEXTAUTH_URL: validBase.NEXTAUTH_URL,
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'NEXTAUTH_SECRET')).toBe(true);
    }
  });

  test('rejects invalid NEXTAUTH_URL (not a URL)', () => {
    const input = {
      ...validBase,
      NEXTAUTH_URL: 'not-a-url',
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'NEXTAUTH_URL')).toBe(true);
    }
  });

  test('accepts fully valid environment', () => {
    const result = parseEnv(validBase);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
      expect(result.data.DB_POOL_MAX).toBe(10);
    }
  });

  test('applies NODE_ENV default of development when absent', () => {
    const result = parseEnv(validBase);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe('development');
    }
  });

  test('rejects NODE_ENV with invalid enum value', () => {
    const input = {
      ...validBase,
      NODE_ENV: 'staging',
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.field === 'NODE_ENV')).toBe(true);
    }
  });

  test('coerces DB_POOL_MAX from string to number', () => {
    const input = {
      ...validBase,
      DB_POOL_MAX: '25',
    };
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.DB_POOL_MAX).toBe(25);
    }
  });

  test('reports multiple validation errors simultaneously (not fail-fast)', () => {
    const input = {};
    
    const result = parseEnv(input);
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
      const fieldNames = result.errors.map(e => e.field);
      expect(fieldNames).toContain('DATABASE_URL');
      expect(fieldNames).toContain('NEXTAUTH_SECRET');
      expect(fieldNames).toContain('NEXTAUTH_URL');
    }
  });
});