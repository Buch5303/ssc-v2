import type { UserRole } from '../db/schema';

interface RouteRule {
  pattern: RegExp;
  roles: {
    [K in UserRole]?: string[];
  };
}

const ROUTE_RULES: RouteRule[] = [
  // Admin routes - admin only
  {
    pattern: /^\/dashboard\/admin\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    }
  },
  {
    pattern: /^\/api\/admin\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    }
  },
  // Procurement routes
  {
    pattern: /^\/dashboard\/procurement\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      viewer: ['GET']
    }
  },
  {
    pattern: /^\/api\/procurement\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      viewer: ['GET']
    }
  },
  // Reports routes
  {
    pattern: /^\/dashboard\/reports\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET'],
      viewer: ['GET']
    }
  },
  {
    pattern: /^\/api\/reports\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET'],
      viewer: ['GET']
    }
  },
  // General dashboard routes (existing ones)
  {
    pattern: /^\/dashboard\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET'],
      viewer: ['GET']
    }
  },
  // General API routes (existing ones)
  {
    pattern: /^\/api\/.*/,
    roles: {
      admin: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
      procurement_manager: ['GET'],
      viewer: ['GET']
    }
  }
];

export function checkPermission(
  role: UserRole,
  pathname: string,
  method: string
): boolean {
  // Find the first matching rule
  for (const rule of ROUTE_RULES) {
    if (rule.pattern.test(pathname)) {
      const allowedMethods = rule.roles[role];
      return allowedMethods ? allowedMethods.includes(method) : false;
    }
  }
  
  // If no rule matches, deny access
  return false;
}