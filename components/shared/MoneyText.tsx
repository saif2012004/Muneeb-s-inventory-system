import { formatPKR } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Design System semantic money colors:
 *   emerald = money owed to others / positive receivable
 *   rose    = money owed by others / debt
 *   zinc    = neutral / settled
 *
 * `auto` picks emerald/rose/zinc from the sign — handy for a running balance
 * where the direction, not the caller, decides the color.
 */
export type MoneyTone = "emerald" | "rose" | "zinc" | "auto";

const TONE_CLASS: Record<Exclude<MoneyTone, "auto">, string> = {
  emerald: "text-emerald-600",
  rose: "text-rose-600",
  zinc: "text-zinc-900",
};

function resolveTone(tone: MoneyTone, value: number) {
  if (tone !== "auto") return TONE_CLASS[tone];
  if (value > 0) return TONE_CLASS.emerald;
  if (value < 0) return TONE_CLASS.rose;
  return TONE_CLASS.zinc;
}

export function MoneyText({
  value,
  tone = "zinc",
  precise = false,
  className,
}: {
  /** Already serialized to a number — never pass a raw Prisma Decimal. */
  value: number | null | undefined;
  tone?: MoneyTone;
  /** Show paise (two decimals). */
  precise?: boolean;
  className?: string;
}) {
  const amount = value ?? 0;

  return (
    <span
      className={cn("num", resolveTone(tone, amount), className)}
      // Screen readers otherwise read "Rs" as letters.
      aria-label={`${formatPKR(amount, { precise })} rupees`}
    >
      {formatPKR(amount, { precise })}
    </span>
  );
}
