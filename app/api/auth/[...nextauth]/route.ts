import { handlers } from "@/lib/auth";

// Prisma + bcryptjs in authorize() -> must not run on the Edge. See Gotcha 3.
export const runtime = "nodejs";

export const { GET, POST } = handlers;
