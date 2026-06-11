/**
 * Layer 2c Tailwind-token gate regression test (2026-06-11).
 * AUTO-048 shipped `border-border` / `bg-card` utilities with no matching
 * tailwind.config tokens and broke the Vercel build at 88/100 PASS. This
 * verifies the gate's validator catches undefined color tokens while not
 * flagging defined tokens or non-color utilities.
 *
 * The validator lives inside the route module; we re-implement the exported
 * surface by importing the functions via a thin re-export shim is not
 * possible (route file has no test exports), so this test documents and
 * locks the contract through a local copy kept in sync. If the gate logic
 * changes, update both.
 */
import { validateTailwindTokens } from "@/lib/tailwind-gate";

const CONFIG_WITH_TOKENS = `
  colors: {
    brand: { blue: '#1E6FCC' },
    border: 'hsl(var(--border))',
    card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
    muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
    bg: 'hsl(var(--bg))',
  },
`;
const CONFIG_BRAND_ONLY = `
  colors: {
    brand: { blue: '#1E6FCC', red: '#CC2020' },
  },
`;

describe("validateTailwindTokens", () => {
  test("flags undefined token (AUTO-048 regression)", () => {
    const files = [{ path: "styles/globals.css", content: "* { @apply border-border; }" }];
    const bad = validateTailwindTokens(files, CONFIG_BRAND_ONLY);
    expect(bad.some(b => b.cls === "border-border")).toBe(true);
  });
  test("passes when token is defined", () => {
    const files = [{ path: "styles/globals.css", content: "* { @apply border-border; } body { @apply bg-card text-muted-foreground; }" }];
    const bad = validateTailwindTokens(files, CONFIG_WITH_TOKENS);
    expect(bad).toHaveLength(0);
  });
  test("does not flag non-color utilities sharing a prefix", () => {
    const files = [{ path: "components/X.tsx", content: "<div className='text-sm border-2 border-t shadow-lg text-left' />" }];
    const bad = validateTailwindTokens(files, CONFIG_BRAND_ONLY);
    expect(bad).toHaveLength(0);
  });
  test("does not flag built-in palette colors", () => {
    const files = [{ path: "components/X.tsx", content: "<div className='bg-red-500 text-white border-slate-700' />" }];
    const bad = validateTailwindTokens(files, CONFIG_BRAND_ONLY);
    expect(bad).toHaveLength(0);
  });
  test("fails open when config unavailable", () => {
    const files = [{ path: "styles/globals.css", content: "@apply border-border;" }];
    expect(validateTailwindTokens(files, null)).toHaveLength(0);
  });
});
