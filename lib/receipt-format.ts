/**
 * Fixed-width line building for the thermal receipt.
 *
 * Dependency-free (no Prisma, no React) so the loader, the renderer and any
 * future test can all use it.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RECEIPT IS BUILT AS AN ARRAY OF EXACTLY-32-CHAR LINES
 * ---------------------------------------------------------------------------
 * A receipt is a fixed-width document, not a responsive layout. Building it as
 * real text lines and printing them in a `<pre>` means alignment is decided HERE,
 * in code that can be checked, instead of emerging from CSS at print time — where
 * the only way to find out it was wrong is to look at a printed roll.
 *
 * Width comes from `RECEIPT_LINE_CHARS` (58mm -> 32). Never hardcode 32: if the
 * owner's printer turns out to be 80mm, that one constant becomes 48 and every
 * line below re-flows. See "Receipt printing" in CLAUDE.md.
 */
import { RECEIPT_LINE_CHARS } from "@/lib/settings-display";

/** A full-width rule. */
export function divider(char = "-", width = RECEIPT_LINE_CHARS): string {
  return char.repeat(width);
}

/**
 * Break text onto as many full-width lines as it needs, on word boundaries.
 *
 * A word longer than the line (a 40-character product name with no spaces) is
 * hard-split rather than allowed to overflow — an overflowing line is what
 * breaks the alignment of everything after it on a real roll.
 */
export function wrapText(text: string, width = RECEIPT_LINE_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > width) {
      // Flush what we have, then hard-split the oversized word.
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += width) {
        const chunk = word.slice(i, i + width);
        if (chunk.length === width) lines.push(chunk);
        else current = chunk;
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

/** Centre text, wrapping first so a long shop name still centres line by line. */
export function centreLines(text: string, width = RECEIPT_LINE_CHARS): string[] {
  return wrapText(text, width).map((line) => {
    const pad = Math.max(0, Math.floor((width - line.length) / 2));
    return " ".repeat(pad) + line;
  });
}

/**
 * `left ............ right` — right-hand side flush to the right margin.
 *
 * This is the money row, and it is where a receipt visibly goes wrong. If the
 * two sides cannot both fit, the LEFT is truncated with an ellipsis and the
 * right is kept whole: the amount is the part that must never be clipped, and a
 * shortened description is still recognisable while a shortened price is a
 * different number.
 */
export function padRow(
  left: string,
  right: string,
  width = RECEIPT_LINE_CHARS
): string {
  // At least one space between the two halves, always.
  const available = width - right.length - 1;

  if (available < 1) {
    // Pathological: the amount alone fills the line. Print it on its own,
    // right-aligned, rather than producing a line longer than the roll.
    return right.slice(-width).padStart(width);
  }

  const trimmedLeft =
    left.length <= available ? left : `${left.slice(0, Math.max(0, available - 1))}…`;

  return trimmedLeft + " ".repeat(width - trimmedLeft.length - right.length) + right;
}

/**
 * A `Label            value` meta row that never eats the LABEL.
 *
 * `padRow` truncates the left when the two halves collide, which is right for a
 * money row (the amount must stay whole) and WRONG here: a customer row that
 * renders `Custo… ZZ_TEST_ Receipt Customer` has clipped the one word that says
 * what the line is. When the pair does not fit, the label keeps its own line and
 * the value wraps beneath it, indented.
 */
export function metaRow(
  label: string,
  value: string,
  width = RECEIPT_LINE_CHARS
): string[] {
  if (label.length + 1 + value.length <= width) return [padRow(label, value, width)];
  return [label, ...indent(wrapText(value, width - 2))];
}

/** Two spaces in front of already-wrapped lines. */
export function indent(lines: string[], by = 2): string[] {
  const prefix = " ".repeat(by);
  return lines.map((line) => prefix + line);
}

/**
 * Every line the document is made of, guaranteed to fit.
 *
 * The renderer joins these with newlines inside a `<pre>`. Anything that would
 * exceed the width has already been wrapped or truncated by the helpers above;
 * this is the final backstop so one missed case cannot ruin the column
 * alignment of the whole receipt.
 */
export function clampLines(lines: string[], width = RECEIPT_LINE_CHARS): string[] {
  return lines.map((line) => (line.length <= width ? line : line.slice(0, width)));
}
