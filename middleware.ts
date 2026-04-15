import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET || 'J/gLVeAgbmn79XvlkG9qOUcS5m9LXM9hpO92zPyIbSM=',
});

export const config = {
  matcher: ['/dashboard/:path*'],
};
