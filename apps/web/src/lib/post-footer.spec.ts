import { swapFooter, hasFooter } from './post-footer';

const DIV = '─────────────';
const BLOCK = '📍 516 Junction Hwy, Kerrville, TX 78028\n📞 +1 830-496-3214\n📷 @luxnailspa_tx';
const TAGS = '#luxnailspa #kerrville #nailart';
const STARTER = `\n\n${DIV}\n${BLOCK}\n\n${TAGS}`;
const NEXT = `Walk-ins welcome 💅\n${BLOCK}\n\n${TAGS} #gelx`;

describe('replacing the footer under a caption', () => {
  it('swaps the built footer for the saved one, once — never two addresses', () => {
    const msg = `Jelly French is having a moment.${STARTER}`;
    const out = swapFooter(msg, STARTER, BLOCK, NEXT);
    expect(out).toBe(`Jelly French is having a moment.\n\n${NEXT}`);
    expect(out.split('📞').length).toBe(2);          // one phone line
    expect(out).not.toContain(DIV);                    // the old divider went with the old footer
  });
  it('falls back to the contact lines when the person already trimmed the divider', () => {
    const msg = `Caption\n\n${BLOCK}`;
    expect(swapFooter(msg, STARTER, BLOCK, NEXT)).toBe(`Caption\n\n${NEXT}`);
  });
  it('appends when the caption has no footer at all', () => {
    expect(swapFooter('Caption only', STARTER, BLOCK, NEXT)).toBe(`Caption only\n\n${NEXT}`);
    expect(swapFooter('', STARTER, BLOCK, NEXT)).toBe(NEXT);
  });
  it('removes the footer when the new one is empty', () => {
    expect(swapFooter(`Caption${STARTER}`, STARTER, BLOCK, '')).toBe('Caption');
  });
  it('knows whether the caption already carries a footer', () => {
    expect(hasFooter(`x${STARTER}`, STARTER)).toBe(true);
    expect(hasFooter('x', STARTER)).toBe(false);
    expect(hasFooter('x', '')).toBe(false);
  });
});
