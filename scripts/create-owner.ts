/**
 * One-time owner account seeder.
 *
 *   npm run create-owner -- owner@example.com "your-password"
 *
 * Re-running with the same email updates the password instead of erroring,
 * so this doubles as a password reset. Reads DATABASE_URL from .env.
 */
import { hash } from "bcryptjs";

import { prisma } from "../lib/prisma";

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const [email, password, name] = process.argv.slice(2);

  if (!email || !password) {
    throw new Error(
      'Usage: npm run create-owner -- <email> "<password>" [name]'
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`"${email}" is not a valid email address.`);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  // Stored lowercase because authorize() looks the user up lowercased.
  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    update: { password: passwordHash, ...(name ? { name } : {}) },
    create: {
      email: normalizedEmail,
      password: passwordHash,
      name: name ?? "Owner",
    },
  });

  console.log(`✔ Owner account ready: ${user.email} (id ${user.id})`);
}

main()
  .catch((error: unknown) => {
    console.error(
      `✖ ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
