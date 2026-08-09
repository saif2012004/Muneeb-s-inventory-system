/**
 * GET  /api/settings  -> the one settings row
 * PATCH /api/settings -> save the owner's shop details
 *
 * Conventions (CLAUDE.md -> API Route Conventions): `{ data, error }` envelope,
 * `requireOwner()` first, zod before Prisma, no raw Prisma error ever reaches
 * the owner, and `runtime = "nodejs"` because this touches Prisma.
 *
 * No `[id]` segment and no POST: there is exactly one settings row, created by
 * the migration. Nothing here can create or delete it.
 */
import { fail, firstIssue, ok, requireOwner, serverError } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validations/settings";

export const runtime = "nodejs";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  try {
    return ok(await getSettings());
  } catch (error) {
    return serverError("settings:get", error);
  }
}

export async function PATCH(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("That request wasn't valid JSON.", 400);
  }

  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) return fail(firstIssue(parsed.error), 400);

  try {
    return ok(await updateSettings(parsed.data));
  } catch (error) {
    return serverError("settings:patch", error);
  }
}
