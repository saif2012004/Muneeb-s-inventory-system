import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare } from "bcryptjs";

import authConfig from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";
import { signInSchema } from "@/lib/validations/auth";

/**
 * FULL (Node runtime) Auth.js config. See Gotcha 3 in CLAUDE.md.
 *
 * Extends the edge-safe config with the Credentials provider, which needs
 * Prisma and bcryptjs — neither of which can run on the Edge. Import this from
 * server components and route handlers; middleware must import auth.config
 * instead.
 *
 * In v5 you read the session with `auth()`. There is no `getServerSession`.
 */

// A real bcrypt hash of a throwaway string. When the email doesn't exist we
// still run one comparison, so "unknown email" and "wrong password" take the
// same time and can't be told apart by an attacker enumerating accounts.
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.eS7.Q3ux0z7Ttw0iVj4nBpvpe9C7Hoy";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = signInSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
        });

        if (!user) {
          await compare(password, DUMMY_HASH);
          return null;
        }

        const passwordMatches = await compare(password, user.password);
        if (!passwordMatches) return null;

        // Never return the password hash — this object becomes the JWT payload.
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
