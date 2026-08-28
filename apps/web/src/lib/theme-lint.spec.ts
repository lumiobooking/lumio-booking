import * as fs from 'fs';
import * as path from 'path';

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
