import {
  TOKENS, resolve, contrast, themeCss, varName,
  TEXT_TOKENS, MUTED_TOKENS, SURFACE_TOKENS, CHIP_PAIRS,
} from './theme';

/**
 * "Không được trùng màu khiến mất nội dung" — as a test, not a promise.
 *
 * Every failure mode of a second theme is a CONTRAST failure somewhere nobody
 * looked: grey text that was fine on slate lands on a grey card; two statuses
 * that differed at night become the same colour by day. A person cannot check
 * five text tones against five surfaces against two themes across 107 files.
 * This file can, and does, on every build.
 */

const themes = ['dark', 'light'] as const;

describe('text is readable on every surface it sits on, in both themes', () => {
  for (const theme of themes) {
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACE_TOKENS) {
        it(`${theme}: ${text} on ${surface} ≥ 4.5:1`, () => {
          expect(contrast(resolve(text, theme), resolve(surface, theme))).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    // Muted text is allowed the large-text threshold — it is captions and
    // hints, never the content itself — but it must still be READABLE.
    for (const text of MUTED_TOKENS) {
      for (const surface of SURFACE_TOKENS) {
        it(`${theme}: muted ${text} on ${surface} ≥ 3:1`, () => {
          expect(contrast(resolve(text, theme), resolve(surface, theme))).toBeGreaterThanOrEqual(3);
        });
      }
    }
  }
});

describe('coloured chips keep their two halves apart in both themes', () => {
  // A chip is a bg + text pair drawn from one colour family. In dark it is a
  // deep bg with a pale text; in light both halves flip. The pair must hold
  // 4.5:1 on BOTH sides of the flip, or a status badge goes blank at sunrise.
  for (const theme of themes) {
    for (const [bg, fg] of CHIP_PAIRS) {
      it(`${theme}: ${fg} on ${bg} ≥ 4.5:1`, () => {
        expect(contrast(resolve(fg, theme), resolve(bg, theme))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe('distinct things stay distinct', () => {
  it('no two dark tokens collapse into one light value within a role group', () => {
    // Surfaces may share white; TEXT tones may not merge with each other, or
    // the hierarchy (primary vs secondary vs muted) flattens.
    const lights = [...TEXT_TOKENS, ...MUTED_TOKENS].map((t) => TOKENS[t]);
    expect(new Set(lights).size).toBe(lights.length);
  });

  it('text and surfaces never swap sides — light text tokens stay dark-on-light', () => {
    for (const text of TEXT_TOKENS) {
      for (const surface of SURFACE_TOKENS) {
        // In light mode the surface must be LIGHTER than the text, always.
        const s = resolve(surface, 'light');
        const t = resolve(text, 'light');
        expect(contrast('#ffffff', s)).toBeLessThan(contrast('#ffffff', t));
      }
    }
  });
});

describe('the stylesheet itself', () => {
  const css = themeCss();

  it('defines every token in both themes', () => {
    for (const dark of Object.keys(TOKENS)) {
      const occurrences = css.split(varName(dark)).length - 1;
      expect(occurrences).toBeGreaterThanOrEqual(2);
    }
  });

  it('dark values are the original hexes — dark mode is pixel-identical', () => {
    const darkBlock = css.split('\n')[0];
    expect(darkBlock).toContain('--c0f172a:#0f172a');
    expect(darkBlock).toContain('--ce2e8f0:#e2e8f0');
  });

  it('flips the browser chrome too (native pickers, scrollbars, autofill)', () => {
    expect(css).toContain('color-scheme:dark');
    expect(css).toContain('color-scheme:light');
  });

  it('every value is a real 6-digit hex — a typo here paints nothing anywhere', () => {
    for (const [k, v] of Object.entries(TOKENS)) {
      expect(k).toMatch(/^#[0-9a-f]{6}$/);
      expect(v).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
