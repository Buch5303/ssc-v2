/**
 * FlowSeer Design System Tokens
 * Silent State palette — 90% monochrome, color = action required.
 * Match to the HTML dashboard's proven visual standard.
 */

export const colors = {
  // Silent surfaces
  bg0:  '#080E18',   // page background
  bg1:  '#0B1220',   // panel surface (brand navy)
  bg2:  '#0F1A2C',   // raised elements, table headers
  bg3:  '#142236',   // hover, active states

  // Monochrome text scale
  t0:   '#DCE8F6',   // primary text
  t1:   '#8BA4BE',   // secondary text
  t2:   '#496175',   // tertiary / dim
  t3:   '#253A4E',   // ghost / disabled

  // Structure
  line: '#111E2D',   // dividers
  edge: '#192840',   // panel borders

  // Action colors — ONLY for states requiring decision
  red:    '#CC2020',
  redBg:  'rgba(204,32,32,0.07)',
  redBd:  'rgba(204,32,32,0.18)',
  amber:  '#C87800',
  ambBg:  'rgba(200,120,0,0.06)',
  ambBd:  'rgba(200,120,0,0.16)',

  // Brand identity — chrome only
  brandBlue:  '#1E6FCC',
  brandBlue2: '#2E8BE8',
  brandRed:   '#CC2020',
} as const;

export const font = {
  ui:   "'IBM Plex Sans', sans-serif",
  mono: "'IBM Plex Mono', monospace",
} as const;

/** Tailwind class helpers for confidence states */
export const confidenceBadge = {
  RFQ_VERIFIED:       'text-[--t0] border-[--edge]',
  MARKET_ANCHOR:      'text-[--t1] border-[--line]',
  COMPONENT_BUILDUPS: 'text-[--t2] border-[--line]',
  ESTIMATED:          'text-[--t2] border-[--line]',
} as const;

/** Status → action color */
export const rfqStatusColor: Record<string, string> = {
  RESPONDED: 'text-[--t0]',
  DRAFTED:   'text-[--t2]',
  BLOCKED:   'text-[--red]',
  SENT:      'text-[--t1]',
  AWARDED:   'text-[--t0]',
};

export const severityColor: Record<string, string> = {
  CRITICAL: 'text-[--red]',
  HIGH:     'text-[--amber]',
  MEDIUM:   'text-[--t2]',
  LOW:      'text-[--t2]',
};
