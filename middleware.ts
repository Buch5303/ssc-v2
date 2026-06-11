import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { checkPermission } from './lib/auth/route-permissions';
import { auditDenial } from './lib/auth/audit-denial';
import type { UserRole } from './lib/db/schema';

const secret = process.env.NEXTAUTH_SECRET;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  
  // Skip middleware for static assets and API routes that don't need protection
  if (pathname.startsWith('/_next/static/') || 
      pathname.startsWith('/_next/image/') || 
      pathname === '/favicon.ico' ||
      pathname.startsWith('/api/auth/') ||
      pathname === '/login' ||
      pathname === '/') {
    return NextResponse.next();
  }

  const requestId = crypto.randomUUID();
  
  try {
    // Get token from request
    const token = await getToken({ req: request, secret });
    
    if (!token) {
      // No token - redirect to login for dashboard routes, 401 for API routes
      if (pathname.startsWith('/dashboard')) {
        return NextResponse.redirect(new URL('/login', request.url));
      } else {
        await auditDenial({
          userId: null,
          role: null,
          pathname,
          method,
          timestamp: new Date().toISOString(),
          requestId
        });
        return NextResponse.json(
          { error: 'Unauthorized', requestId },
          { status: 401 }
        );
      }
    }

    const userRole = token.role as UserRole;
    const userId = token.sub as string;
    
    // Check permissions
    if (!checkPermission(userRole, pathname, method)) {
      await auditDenial({
        userId,
        role: userRole,
        pathname,
        method,
        timestamp: new Date().toISOString(),
        requestId
      });
      
      return NextResponse.json(
        { error: 'Forbidden', requestId },
        { status: 403 }
      );
    }

    return NextResponse.next();
  } catch (error) {
    console.error('Middleware error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', requestId },
      { status: 500 }
    );
  }
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/api/admin/:path*',
    '/api/procurement/:path*',
    '/api/reports/:path*'
  ]
};