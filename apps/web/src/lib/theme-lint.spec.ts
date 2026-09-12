import * as fs from 'fs';
import * as path from 'path';
import { contrast, resolve, EXTRA } from './theme';

/**
 * The lint that keeps light mode honest — forever.
 *
 * The bug family this hunts: hard-coded white text sitting on a THEMED neutral
 * surface. In dark mode it looks perfect, which is why it keeps being written;
 * the moment someone flips to light, the surface turns white and the text
 * vanishes. It has now been found by a human screenshot three times (POS cart,
 * walk-in turn counters, the pricing table). Humans should not be the linter.
 *
 * The rule: within four lines of a neutral `var(--c…)` background, `color:
 * '#fff'` is forbidden — use var(--cf8fafc), which is white at night and ink by
 * day. White on ACCENT backgrounds (indigo buttons, green badges) is exempt:
 * those backgrounds do not flip.
 */

const ROOT = path.join(__dirname, '..');
const NEUTRAL_BG = /background:\s*'var\(--c(0b1120|0b1220|0f172a|111827|1e293b|1f2937|334155|475569|0b1322|0d1526|111a2c|151f38|161f30|18202f|223047|243044|263041|273449)\)'/;
const WHITE = /color:\s*'(#fff(?:fff)?|white)'/;
const ACCENT_SAMELINE = /background:\s*'(#[0-9a-fA-F]{3,6}|linear-gradient|rgba\()/;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.spec.ts')) yield p;
  }
}

test('no hard-coded white text on themed neutral surfaces, anywhere', () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!WHITE.test(line) || ACCENT_SAMELINE.test(line)) return;
      const ctx = lines.slice(Math.max(0, i - 4), i + 4).join('\n');
      if (NEUTRAL_BG.test(ctx)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  // Every entry here is text that will disappear in light mode. The fix is
  // one word: var(--cf8fafc).
  expect(offenders).toEqual([]);
});

/**
 * The same bug family, one member further out — and the one that got through.
 *
 * The check above hunts `color: '#fff'` on a neutral surface. It did not catch
 * this, written the same week:
 *
 *     background: 'var(--c14532d)',   // dark green at night, PALE green by day
 *     color: '#bbf7d0',               // pale green, always
 *
 * The background flips and the text cannot, so at night it is pale-on-dark and
 * by day it is pale-on-pale: a contrast ratio of 1.04, which is text you cannot
 * see. White was never the point. The point is that a HARD-CODED colour cannot
 * follow a themed surface, whatever shade it happens to be.
 *
 * So this one does not pattern-match on a list of colours. It resolves the
 * background into its LIGHT value and computes the actual contrast, with the
 * same arithmetic theme.spec uses. Under 2:1 is not "low contrast", it is
 * invisible; above that the saturated accents (#22c55e, #ef4444) that the
 * palette deliberately does not theme are left alone.
 *
 * It reads only the style object the colour is IN, not a window of nearby
 * lines. A window found backgrounds belonging to the next element and reported
 * text that was perfectly fine — and a guard that cries wolf gets ignored,
 * which costs more than it saves.
 */
const HEX_COLOR = /color:\s*'(#[0-9a-fA-F]{3,6})'/;
const THEMED_BG = /background:\s*'var\(--c([0-9a-f]{6})\)'/;
const OBJECT_START = /style=\{\{|:\s*(React\.)?CSSProperties\s*=\s*\{/;

/** The style object a line belongs to: from its opening brace to its close. */
function styleObjectAround(lines: string[], at: number): string {
  let start = at;
  while (start > 0 && !OBJECT_START.test(lines[start])) {
    // A blank line or a closing brace means we left the object without finding
    // its start — the colour is not inside a style literal we can reason about.
    if (/^\s*$/.test(lines[start]) || /\}\}/.test(lines[start]) && start !== at) return lines[at];
    start -= 1;
  }
  let end = start;
  let depth = 0;
  let opened = false;
  for (; end < lines.length && end < start + 40; end += 1) {
    const opens = (lines[end].match(/\{/g) ?? []).length;
    depth += opens - (lines[end].match(/\}/g) ?? []).length;
    opened = opened || opens > 0;
    // An object that opens and closes on ONE line must stop there. Reading on
    // swallowed the next element's background and reported perfectly readable
    // text — the false positive that makes a guard get ignored.
    if (opened && depth <= 0) break;
  }
  return lines.slice(start, end + 1).join('\n');
}

test('no hard-coded text colour that disappears on a themed surface in light mode', () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const c = HEX_COLOR.exec(line);
      if (!c) return;
      const obj = styleObjectAround(lines, i);
      // A raw background in the same object does not flip either, so the pair
      // keeps whatever contrast it was drawn with.
      if (/background:\s*'(#|linear-gradient|rgba\()/.test(obj)) return;
      const bg = THEMED_BG.exec(obj);
      if (!bg) return;
      const light = resolve(`#${bg[1]}`, 'light');
      const ratio = contrast(c[1], light);
      if (ratio < 2) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1} — ${c[1]} on ${light} = ${ratio.toFixed(2)}:1`);
      }
    });
  }
  // Each of these is text a salon cannot read by day. The fix is to write the
  // colour as its token — var(--c<hex>) — so it flips with the surface.
  expect(offenders).toEqual([]);
});

/**
 * THE INVISIBLE DIVIDER.
 *
 * `#1e293b` does two jobs in the source: a raised chip's background, and a 1px
 * rule. At night one value serves both. By day it cannot - a surface pale
 * enough to sit under text is not a line you can see on white. 125 dividers
 * across 38 screens were drawn and none of them were visible, which is why
 * light mode read as one undifferentiated sheet with no panels on it.
 *
 * Borders use `var(--line)` (or `--line-strong`), whose dark value is that same
 * `#1e293b` and whose light value is an actual line.
 */
test('no divider drawn in a colour that vanishes on white', () => {
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      // Only `#1e293b`. A ring drawn in the PAGE colour (`--c111827`,
      // `--c0f172a`) is the opposite pattern and a correct one: it punches a
      // badge out of whatever it overlaps, and it is meant to flip to white.
      if (/solid var\(--c1e293b\)/.test(line)) {
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  expect(offenders).toEqual([]);
});

/**
 * THE WASH THAT CANNOT FLIP.
 *
 * `rgba(120,53,15,.12)` is amber-900 at twelve percent. Over `#0f172a` it is a
 * whisper; over white it is mud - the tan smear the internal-notes box showed
 * in light mode. A translucent DARK colour is the same bug as a raw dark hex:
 * the thing underneath flips and the thing on top cannot.
 *
 * Tints written as `var(--wash-…)` flip with everything else. Accent hues
 * (indigo, green, red-500, amber-500) are exempt: they are the same colour on
 * both grounds and carry meaning that must not drift.
 */
const DARK_FAMILY = [
  '120,53,15', '69,26,3', '146,64,14',      // amber 900 / 950 / 800
  '127,29,29', '69,10,10', '153,27,27',     // red 900 / 950 / 800
  '30,58,138', '23,37,84',                  // blue 900 / 950
  '6,78,59', '5,46,22', '20,83,45',         // green 900 / 950
  '49,46,129', '30,27,75',                  // indigo 900 / 950
];

test('no translucent dark-palette wash used as a surface', () => {
  const offenders: string[] = [];
  const re = new RegExp(`rgba\\(\\s*(?:${DARK_FAMILY.map((t) => t.split(',').join('\\s*,\\s*')).join('|')})\\s*,`);
  for (const file of walk(ROOT)) {
    // The palette file is where these values are DECLARED, paired with the
    // light colour that replaces them. That is the fix, not the bug.
    if (path.relative(ROOT, file).replace(/\\/g, '/') === 'lib/theme.ts') continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (re.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

/**
 * THE TYPEWRITER.
 *
 * A browser does not hand form controls the page font: <textarea> defaults to
 * monospace. The search box, the message composer and the notes box were all
 * typing in a different face from every other word on screen. globals.css now
 * says so once, for all of them; this is the guard that it keeps saying it.
 */
test('form controls inherit the app typeface', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');
  const rule = /(^|\})[^{}]*\btextarea\b[^{}]*\{[^}]*font-family:\s*inherit/m;
  expect(rule.test(css)).toBe(true);
  for (const tag of ['input', 'select', 'button']) {
    expect(new RegExp(`(^|\\})[^{}]*\\b${tag}\\b[^{}]*\\{[^}]*font-family:\\s*inherit`, 'm').test(css)).toBe(true);
  }
});

/**
 * ONE HALF FLIPS, THE OTHER CANNOT.
 *
 * A style object whose BACKGROUND is a fixed hex and whose TEXT is a themed
 * token is wrong by construction: the background stays put while the text
 * moves, so one of the two themes is always unreadable. It is how the bot's
 * message bubble came to be white-on-lavender at 1.43:1 - the salon could see
 * that the bot had answered and could not read what it said.
 *
 * The rule: a fixed background takes a fixed text colour. Write the hex.
 */
const HEX6 = "#[0-9a-fA-F]{6}";

test('a fixed background never carries text that flips with the theme', () => {
  const offenders: string[] = [];
  const objRe = /\{[^{}]*\}/g;
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(objRe)) {
      const obj = m[0];
      const bg = new RegExp(`background(?:Color)?:\\s*'(${HEX6})'`).exec(obj);
      const fg = /color:\s*'var\(--c([0-9a-f]{6})\)'/.exec(obj);
      if (!bg || !fg) continue;
      const dark = `#${fg[1]}`;
      const light = resolve(dark, 'light');
      if (light === dark) continue;               // that token does not flip
      const onLight = contrast(bg[1].toLowerCase(), light);
      const onDark = contrast(bg[1].toLowerCase(), dark);
      // A saturated accent is always a button or a badge - bold text at button
      // size, where 3:1 is the bar. Everything else is prose, where it is 4.5.
      const accent = /^#(6366f1|4f46e5|ef4444|dc2626|22c55e|16a34a|f59e0b|0ea5e9|3b82f6|a855f7|8b5cf6|ec4899|db2777)$/i.test(bg[1]);
      const bar = accent ? 3 : 4.5;
      if (onLight >= bar && onDark >= bar) continue;
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(
        `${path.relative(ROOT, file)}:${line} - ${bg[1]} with var(--c${fg[1]}) = ${Math.min(onLight, onDark).toFixed(2)}:1`,
      );
    }
  }
  expect(offenders).toEqual([]);
});

/**
 * A SURFACE TOKEN IS NOT A TEXT COLOUR.
 *
 * The neutral ramp has two halves that look identical from the call site. One
 * half is what you paint a panel, a chip or a border with; the other is what
 * you write words in. Nothing in the name `var(--c475569)` says which half it
 * came from, and at night it does not matter — every one of them is some shade
 * of grey against a dark ground, and all of them read.
 *
 * By day the two halves move in OPPOSITE directions. A text token gets darker
 * (`#94a3b8` → `#5b6d85`); a surface token gets lighter (`#475569` → `#aab8cb`,
 * `#334155` → `#cfd9e8`). So a surface token used as text is a colour that was
 * legible in dark mode and is a divider in light mode: 2.0:1 and 1.4:1 on a
 * white card. That is how the week plan's tick boxes, step numbers and `↳`
 * arrows, the calendar's `|` separators and the unlit half of every star
 * rating came to be drawn in the colour of a rule.
 *
 * Neither lint above catches it: the colour is not a raw hex, and the surface
 * it sits on is declared by a PARENT element, so there is no pair to measure.
 * This one does not measure anything. It says: these eight tokens are
 * surfaces, and a surface is never `color:`.
 *
 * The exception, and the reason the style object is read at all: dark ink ON a
 * bright accent — white text's opposite — is correct, and there the surface is
 * a raw hex or a gradient in the same object.
 *
 * Scope: the app the salon and the team log into. The public pages
 * (/book, /appt, /display, /invoice …) carry the same mistake at larger scale
 * AND a second one under it — surfaces written as raw `#fff` that cannot flip
 * at all — so they are a change of their own, not a line in this list.
 */
const SURFACE_TOKENS = ['0b1120', '0b1220', '0f172a', '111827', '1f2937', '1e293b', '334155', '475569'];
const SURFACE_AS_TEXT = new RegExp(`color:\\s*'var\\(--c(${SURFACE_TOKENS.join('|')})\\)'`, 'g');
const ACCENT_BG = /background(?:Color)?:\s*'(#|linear-gradient|rgba\()/;
const APP_SHELL = ['components', 'app/salon', 'app/agency', 'app/super-admin', 'app/staff'];

test('no surface token used as a text colour in the app the team logs into', () => {
  const offenders: string[] = [];
  for (const sub of APP_SHELL) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(SURFACE_AS_TEXT)) {
          // Dark ink on a bright accent: the accent does not flip, so neither
          // should the ink — and that is written as a raw hex, not a token.
          if (ACCENT_BG.test(styleObjectAround(lines, i))) continue;
          offenders.push(`${path.relative(ROOT, file)}:${i + 1} — ${m[0]}`);
        }
      });
    }
  }
  // The fix is `var(--ink-faint)` for a faint mark, `var(--c64748b)` for muted
  // text, or a raw hex when the surface under it is raw too.
  //
  // PRINTED, not only asserted: Render truncates Jest's toEqual diff, so a red
  // build showed a file and a line number of THIS file and nothing whatsoever
  // about which colours in which components were wrong. Two deploys were spent
  // guessing. The list now arrives in the log.
  if (offenders.length) console.error(`\nSURFACE-TOKEN-AS-TEXT (${offenders.length}):\n${offenders.join('\n')}\n`);
  expect(offenders).toEqual([]);
});

/**
 * THE SECOND HALF OF THE SAME BUG, AND THE HALF THE LINT ABOVE COULD NOT SEE.
 *
 * That test watches for SURFACE TOKENS used as text. The accents are not
 * tokens at all — they are raw hex, picked years ago against a very dark
 * panel, and raw hex does not flip. Measured on white:
 *
 *     #86efac  1.40 : 1      #fbbf24  1.67 : 1      #fca5a5  1.90 : 1
 *     #a5b4fc  1.99 : 1      #38bdf8  2.14 : 1      #22c55e  2.28 : 1
 *
 * So in light mode the break-even figure, every "Vì sao" toggle, the LUMIO
 * chip and "Mẹo quay cho đẹp (không bắt buộc)" were all painted and none of
 * them could be read. The fix is --ink-good / --ink-warn / --ink-bad /
 * --ink-link / --ink-sky, which keep tonight's hex and darken by day.
 *
 * BORDERS AND BACKGROUNDS ARE NOT COVERED, deliberately. A green border or a
 * tinted panel made of the same hex is fine in both themes; it is only as INK
 * that these fail.
 */
const ACCENT_HEX = [
  '22c55e', '4ade80', '86efac', 'bbf7d0',   // greens
  'fbbf24', 'fde68a', 'f59e0b',             // ambers
  'fca5a5', 'f87171', 'fecaca', 'ef4444',   // reds
  'a5b4fc', 'c7d2fe', '6366f1',             // indigos
  '38bdf8', '93c5fd',                       // skies
];
const ACCENT_AS_TEXT = new RegExp(`(?<![a-zA-Z])color:\\s*[^,\\n}]*?'#(${ACCENT_HEX.join('|')})'`, 'gi');

test('no light accent hex used as a text colour — it cannot flip, and by day it cannot be read', () => {
  const offenders: string[] = [];
  for (const sub of APP_SHELL) {
    const dir = path.join(ROOT, sub);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(ACCENT_AS_TEXT)) {
          // Ink on a bright accent GROUND is the one place a raw hex is right:
          // the ground does not flip, so the ink must not either.
          if (ACCENT_BG.test(styleObjectAround(lines, i))) continue;
          offenders.push(`${path.relative(ROOT, file)}:${i + 1} — ${m[0].trim()}`);
        }
      });
    }
  }
  if (offenders.length) console.error(`\nACCENT-HEX-AS-TEXT (${offenders.length}):\n${offenders.join('\n')}\n`);
  expect(offenders).toEqual([]);
});

test('the accent ink tokens are defined, and day is dark enough to read', () => {
  for (const name of ['--ink-good', '--ink-warn', '--ink-bad', '--ink-link', '--ink-sky']) {
    const pair = EXTRA[name];
    expect(pair).toBeTruthy();
    const [, light] = pair;
    // 4.5:1 on the page ground is the bar this whole file exists to hold.
    expect(contrast(light, '#eef2f8')).toBeGreaterThanOrEqual(4.5);
  }
});
