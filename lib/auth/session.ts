import { NextAuthOptions } from 'next-auth';
import { JWT } from 'next-auth/jwt';
import type { UserRole } from '../db/schema';

// Mock user database for demonstration
// In a real app, this would query your user database
const users = new Map([
  ['admin@flowseer.com', { id: '1', email: 'admin@flowseer.com', role: 'admin' as UserRole }],
  ['manager@flowseer.com', { id: '2', email: 'manager@flowseer.com', role: 'procurement_manager' as UserRole }],
  ['viewer@flowseer.com', { id: '3', email: 'viewer@flowseer.com', role: 'viewer' as UserRole }]
]);

export const authOptions: NextAuthOptions = {
  providers: [
    // Add your auth providers here
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // First time JWT is created, add role from user
        const userData = users.get(user.email as string);
        if (userData) {
          token.role = userData.role;
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Send role to the client
      if (token.role) {
        (session.user as any).role = token.role;
      }
      return session;
    }
  },
  pages: {
    signIn: '/login'
  }
};