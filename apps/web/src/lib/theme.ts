/**
 * The two palettes of the whole product — dark (the original) and light.
 *
 * HOW THEMING WORKS HERE
 *
 * This codebase styles with inline `style={{...}}` objects, which no external
 * stylesheet can override. So instead of overriding, every neutral colour
 * LITERAL in the source was rewritten to `var(--c<hex>)`, where <hex> is the
 * original dark value — e.g. `#0f172a` became `var(--c0f172a)`. The dark theme
 * defines each variable as itself, so dark mode is pixel-identical to what
 * shipped before. The light theme redefines the same variables.
 *
 * WHY THE VARIABLE IS NAMED AFTER THE DARK HEX
 *
 * Because it makes the sweep mechanical and reversible, and because in the
 * source you can still read what the designer chose ("this was slate-900").
 * A semantic rename (--bg-panel and friends) across 107 files of inline styles
 * would have been thousands of judgement calls; this is one find-and-replace
 * with zero judgement, which is the only kind of change that big that can be
 * trusted.
 *
 * THE CONTRACT (enforced by theme.spec.ts, not by good intentions):
 *   - every TEXT token keeps WCAG contrast against every SURFACE token it sits
 *     on, in BOTH themes;
 *   - tokens that differ in dark must not collapse into one value in light —
 *     two things distinguishable tonight stay distinguishable tomorrow morning.
 *
 * Accent colours (indigo #6366f1, green #22c55e, red #ef4444, amber #f59e0b…)
 * are NOT themed: they read correctly on both backgrounds, and they carry
 * meaning (status, brand, deltas) that must not drift between modes. Colored
 * chips built from a dark accent bg + pale accent text ARE themed as pairs —
 * both halves flip together (#312e81/#c7d2fe becomes #e0e7ff/#3730a3), so the
 * pair keeps its contrast in either world.
 */

/** dark hex (as written in the source) → light equivalent. */
export const TOKENS: Record<string, string> = {
  // ---- neutral surfaces, deepest → lightest --------------------------------
  '#0b1120': '#eef2f8', // page background
  '#0b1220': '#eef2f8', // inbox rail
  '#0f172a': '#ffffff', // panel / input background
  '#111827': '#ffffff', // card / sticky header background
  '#1f2937': '#e6ebf4', // header borders, deep chips
  '#1e293b': '#f1f4fa', // raised chip bg AND hairline borders
  '#334155': '#cfd9e8', // borders
  '#475569': '#aab8cb', // strong borders / faint strokes

  // ---- neutral text, faintest → brightest ----------------------------------
  '#64748b': '#64748b', // muted — legible on white and on slate-900 alike
  '#94a3b8': '#5b6d85', // secondary text
  '#cbd5e1': '#324258', // body text
  '#e2e8f0': '#182a42', // primary text
  '#f1f5f9': '#101f36', // emphatic text
  '#f8fafc': '#0b1830', // brightest text

  // ---- indigo family (chip bg ↔ chip text flip together) -------------------
  '#1e1b4b': '#eef2ff',
  '#312e81': '#e0e7ff',
  '#3730a3': '#c7d2fe',
  '#c7d2fe': '#3730a3',
  '#a5b4fc': '#4f46e5',
  '#818cf8': '#4f46e5',
  '#e0e7ff': '#3730a3',

  // ---- pale text that had no token, and therefore could not flip ----------
  //
  // Every one of these was written as a raw hex in a style object — pale green
  // words on a chip whose background DID flip, so at night they read and by
  // day they vanished into it. A raw hex cannot flip; only a token can.
  '#a7f3d0': '#047857',
  '#a5f3fc': '#0e7490',
  '#cffafe': '#155e75',
  '#dbeafe': '#1d4ed8',
  '#fed7aa': '#c2410c',
  '#fbbf24': '#b45309',
  '#eab308': '#a16207',

  // ---- green family --------------------------------------------------------
  '#052e16': '#e8f8ee',
  '#064e3b': '#d7f2e4',
  '#14532d': '#dcf3e4',
  '#166534': '#bbe9cd',
  '#6ee7b7': '#047857',
  '#86efac': '#15803d',
  '#bbf7d0': '#166534',
  '#4ade80': '#16a34a',
  '#d1fae5': '#065f46',

  // ---- red family ----------------------------------------------------------
  '#450a0a': '#fdecec',
  '#7f1d1d': '#fbdcdc',
  '#991b1b': '#f5c6c6',
  '#fca5a5': '#b91c1c',
  '#f87171': '#dc2626',
  '#fecaca': '#a51d1d',

  // ---- amber family --------------------------------------------------------
  '#451a03': '#fdf3e0',
  '#78350f': '#fbeacc',
  '#92400e': '#f3ddb8',
  '#fcd34d': '#713f06',
  '#fde68a': '#92400e',
  '#fef3c7': '#78350f',

  // ---- calendar's own neutrals ---------------------------------------------
  // The calendar grew a private slate ramp (grid lines, weekend cells, the
  // today tint, dimmed cancelled chips) that the first sweep never saw — which
  // is why light mode showed a patchwork of white cells inside night-blue
  // gaps. Same rule as everything else: dark value IS the current pixel,
  // light value follows Google Calendar's grammar — today gets an indigo
  // tint, out-of-month and weekends get a barely-greyer white, never a
  // different theme.
  '#223047': '#dfe6f0', // tracks / deep borders
  '#243044': '#dfe6f0', // month-grid lines
  '#263041': '#e3e9f2',
  '#273449': '#e8edf5', // hover rows, dividers
  '#0b1322': '#f3f6fb', // cells outside the month
  '#0d1526': '#f7f9fd', // weekend cells
  '#111a2c': '#ffffff', // event cards
  '#151f38': '#eef2ff', // TODAY — indigo-tinted, both themes say "you are here"
  '#161f30': '#eef1f6', // cancelled/no-show chip
  '#18202f': '#eef1f6', // dimmed events in the day views
  '#8ea2c4': '#607399', // weekend column header
  '#93a4bd': '#5f7189', // small chip text
  '#dbe2ea': '#26374d', // customer name inside an event chip
  '#7c5c22': '#e2c684', // amber border on the unassigned-staff picker

  // ---- blue family ---------------------------------------------------------
  '#172554': '#e3edfd',
  '#1e3a8a': '#dbeafe',
  '#93c5fd': '#1d4ed8',
  '#bfdbfe': '#1e40af',
  '#60a5fa': '#2563eb',
};

/** var name for a dark hex: '#0f172a' → '--c0f172a'. */
export const varName = (darkHex: string) => `--c${darkHex.slice(1).toLowerCase()}`;

/**
 * The stylesheet injected once in the root layout.
 *
 * Dark is written on :root (not behind a [data-theme] guard) so that the page
 * is correct even before the boot script has run or if it never runs — no
 * theme attribute means exactly what shipped last month. `color-scheme` flips
 * the browser's OWN chrome with us: date pickers, selects, scrollbars, the
 * autofill tint — the parts of "light mode" no app stylesheet can reach.
 */
export function themeCss(): string {
  const dark = Object.keys(TOKENS).map((k) => `${varName(k)}:${k}`).join(';');
  const light = Object.entries(TOKENS).map(([k, v]) => `${varName(k)}:${v}`).join(';');
  return `:root{${dark};--glass:rgba(11,17,32,.82);color-scheme:dark}\nhtml[data-theme='light']{${light};--glass:rgba(255,255,255,.86);color-scheme:light}`;
}

// ---- contrast arithmetic (WCAG 2.x), used by the spec ----------------------

export function relLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [relLuminance(a), relLuminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Resolve a token for one theme. Unknown hexes pass through (accents). */
export function resolve(hex: string, theme: 'dark' | 'light'): string {
  return theme === 'dark' ? hex : (TOKENS[hex] ?? hex);
}

/** The pairs the product actually draws — the spec walks every one. */
export const TEXT_TOKENS = ['#94a3b8', '#cbd5e1', '#e2e8f0', '#f1f5f9', '#f8fafc', '#dbe2ea'] as const;
export const MUTED_TOKENS = ['#64748b', '#8ea2c4', '#93a4bd'] as const;
export const SURFACE_TOKENS = ['#0b1120', '#0b1220', '#0f172a', '#111827', '#1e293b', '#0b1322', '#0d1526', '#111a2c', '#151f38', '#161f30'] as const;
export const CHIP_PAIRS: [string, string][] = [
  ['#312e81', '#c7d2fe'], ['#1e1b4b', '#a5b4fc'],
  ['#064e3b', '#6ee7b7'], ['#052e16', '#86efac'], ['#14532d', '#bbf7d0'],
  ['#7f1d1d', '#fecaca'], ['#7f1d1d', '#fca5a5'], ['#450a0a', '#fca5a5'],
  ['#78350f', '#fcd34d'], ['#78350f', '#fde68a'], ['#451a03', '#fcd34d'],
  ['#1e3a8a', '#93c5fd'], ['#172554', '#93c5fd'],
];
