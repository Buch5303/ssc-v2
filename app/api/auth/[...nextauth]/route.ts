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
  pages: { signIn: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  secret: process.env.NEXTAUTH_SECRET || 'flowseer-dev-secret-change-in-production',
});

export { handler as GET, handler as POST };
