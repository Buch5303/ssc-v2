/**
 * Layer 2c — Tailwind token validation (2026-06-11).
 *
 * Extracted so the auto-build compile gate and its regression test share one
 * implementation. AUTO-048 rewrote globals.css to `@apply border-border` plus
 * bg-card / text-muted-foreground / bg-bg utilities while tailwind.config
 * carried only `brand.*` tokens; `next build` died ("The `border-border`
 * class does not exist") at 88/100 PASS because imports resolved and the
 * Auditor had no token-existence lens.
 *
 * Conservative by design: validates a fixed set of color-utility prefixes
 * against the config's color keys plus Tailwind's built-in palette. Numeric
 * scales (bg-red-500), arbitrary values (bg-[#fff]), and non-color utilities
 * (text-sm, border-2) are not flagged. Fails open when the config is absent.
 */

export const TW_COLOR_PREFIXES = [
  "bg", "text", "border", "ring", "fill", "stroke", "from", "to", "via",
  "divide", "outline", "ring-offset", "accent", "caret", "decoration",
  "placeholder", "shadow",
];

const TW_BUILTIN_PALETTE = [
  "white", "black", "transparent", "current", "inherit", "slate", "gray",
  "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime",
  "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet",
  "purple", "fuchsia", "pink", "rose",
];

const NON_COLOR_ROOTS =
  /^(xs|sm|base|lg|xl|left|right|center|justify|top|bottom|solid|dashed|dotted|none|0|1|2|4|8|t|b|l|r|x|y)$/;

export function extractTailwindColorTokens(configSrc: string): Set<string> | null {
  const colorsIdx = configSrc.indexOf("colors:");
  if (colorsIdx === -1) return null;
  const slice = configSrc.slice(colorsIdx, colorsIdx + 4000);
  const tokens = new Set<string>();
  const keyRe = /(?:^|[\s{,])([a-zA-Z][\w-]*)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(slice))) {
    const k = m[1];
    if (k === "colors" || k === "DEFAULT") continue;
    tokens.add(k);
  }
  for (const t of TW_BUILTIN_PALETTE) tokens.add(t);
  return tokens;
}

export function validateTailwindTokens(
  files: Array<{ path: string; content: string }>,
  configSrc: string | null
): Array<{ file: string; cls: string }> {
  if (!configSrc) return [];
  const tokens = extractTailwindColorTokens(configSrc);
  if (!tokens || tokens.size === 0) return [];
  const bad: Array<{ file: string; cls: string }> = [];
  const seen = new Set<string>();
  const prefixAlt = TW_COLOR_PREFIXES.join("|");
  const clsRe = new RegExp(
    `(?:^|[\\s"'\\\`:.{(])(?:(?:hover|focus|active|disabled|dark|sm|md|lg|xl|2xl|group-hover|peer):)*(${prefixAlt})-([a-z][a-z0-9-]*)`,
    "g"
  );
  for (const f of files) {
    if (!/\.(tsx|jsx|css|scss)$/.test(f.path)) continue;
    let m: RegExpExecArray | null;
    clsRe.lastIndex = 0;
    while ((m = clsRe.exec(f.content || ""))) {
      const root = m[2].split("-")[0];
      if (tokens.has(root)) continue;
      if (NON_COLOR_ROOTS.test(root)) continue;
      const key = `${m[1]}-${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bad.push({ file: f.path, cls: key });
    }
  }
  return bad;
}
