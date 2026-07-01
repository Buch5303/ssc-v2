import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'FlowSeer',
      credentials: {
        password: { label: 'Access Code', type: 'password' },
      },
      async authorize(credentials) {
        const validPassword = process.env.FLOWSEER_PASSWORD || 'tg20-borderplex-2026';
        if (credentials?.password === validPassword) {
          return { id: '1', name: 'FlowSeer User', email: 'user@flowseer.internal' };
        }
        return null;
      },
    }),
  ],
  callbacks: {
    // Single shared access-code login: every authenticated session is a full admin.
    // Without this, the JWT carries no `role`, so route-permissions denies all
    // /dashboard and gated /api routes with a 403.
    async jwt({ token }) {
      token.role = 'admin';
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET || 'flowseer-dev-secret-change-in-production',
});

export { handler as GET, handler as POST };
