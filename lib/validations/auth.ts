import { z } from "zod";

/**
 * Shared by the login form and by `authorize()` in lib/auth.ts, so the client
 * and the server agree on what a valid credential payload looks like.
 * Zod only — safe to import from the Edge runtime and from the browser.
 */
export const signInSchema = z.object({
  email: z
    .string()
    .min(1, { message: "Email is required" })
    .email({ message: "Enter a valid email address" }),
  password: z.string().min(1, { message: "Password is required" }),
});

export type SignInInput = z.infer<typeof signInSchema>;
