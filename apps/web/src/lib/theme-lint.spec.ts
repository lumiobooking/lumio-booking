import * as fs from 'fs';
import * as path from 'path';
import { contrast, resolve } from './theme';

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
