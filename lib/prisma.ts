// Prisma 6.x singleton — see the guardrail in CLAUDE.md.
// Import from "@prisma/client" directly: no generated output path, no adapter.
import { PrismaClient } from "@prisma/client";

// Next.js dev clears the module cache on every hot reload. Without stashing the
// client on globalThis, each reload opens a fresh connection pool and Supabase
// eventually rejects new connections.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
