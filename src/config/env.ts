import { z } from 'zod';

// Zod schema for environment validation with SOC 2 compliance requirements
export const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .url('DATABASE_URL must be a valid URL')
    .refine(
      (url) => url.startsWith('postgresql://') || url.startsWith('postgres://'),
      {
        message: 'DATABASE_URL must begin with postgresql:// or postgres://',
      }
    ),
  NEXTAUTH_SECRET: z
    .string()
    .min(32, 'NEXTAUTH_SECRET must be at least 32 characters for SOC 2 compliance'),
  NEXTAUTH_URL: z
    .string()
    .url('NEXTAUTH_URL must be a valid URL'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL must be a valid URL')
    .optional(),
  DB_POOL_MAX: z
    .coerce
    .number()
    .int('DB_POOL_MAX must be an integer')
    .min(1, 'DB_POOL_MAX must be at least 1')
    .max(100, 'DB_POOL_MAX must not exceed 100')
    .default(10),
  DB_CONNECT_TIMEOUT_MS: z
    .coerce
    .number()
    .int('DB_CONNECT_TIMEOUT_MS must be an integer')
    .min(1000, 'DB_CONNECT_TIMEOUT_MS must be at least 1000ms')
    .max(30000, 'DB_CONNECT_TIMEOUT_MS must not exceed 30000ms')
    .default(5000),
});

// Inferred TypeScript type from the Zod schema
export type Env = z.infer<typeof envSchema>;

// Error structure for validation failures
interface ValidationError {
  field: string;
  message: string;
}

// Parse result structure
type ParseResult =
  | { success: true; data: Env }
  | { success: false; errors: ValidationError[] };

/**
 * Parse and validate environment variables using the Zod schema.
 * This function is pure and does not call process.exit or mutate process.env.
 * 
 * @param raw - The raw environment object (typically process.env)
 * @returns Parse result with either validated data or error array
 */
export function parseEnv(raw: NodeJS.ProcessEnv): ParseResult {
  const result = envSchema.safeParse(raw);
  
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  
  // Map ZodError issues to flat error array
  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
  
  return {
    success: false,
    errors,
  };
}