import { buttonLook, buttonVars, inkOn, contrast, socialLook, safeSocial, socialStyleOf } from './booking-buttons';

describe('booking-page buttons in the salon’s colours', () => {
  it('no setting = exactly as before: the accent, white text', () => {
    expect(buttonLook({}, '#6366f1')).toMatchObject({ bg: '#6366f1', ink: '#ffffff', readable: true });
    expect(buttonLook({ buttonColor: '', buttonTextColor: '' }, '#e11d48').bg).toBe('#e11d48');
  });
  it('a chosen colour with automatic text that reads', () => {
    expect(buttonLook({ buttonColor: '#fde68a' }, '#6366f1').ink).toBe('#0f172a'); // pale gold → dark text
    expect(buttonLook({ buttonColor: '#111827' }, '#6366f1').ink).toBe('#ffffff');
    expect(inkOn('#ffffff')).toBe('#0f172a');
  });
  it('a text colour that cannot be read is replaced, and flagged for the settings screen', () => {
    const l = buttonLook({ buttonColor: '#ffffff', buttonTextColor: '#fefefe' }, '#6366f1');
    expect(l.readable).toBe(false);
    expect(contrast(l.bg, l.ink)).toBeGreaterThan(4.5);
    expect(buttonLook({ buttonColor: '#000000', buttonTextColor: '#fbbf24' }, '#6366f1').ink).toBe('#fbbf24');
  });
  it('junk in settings never reaches the page', () => {
    expect(buttonVars({ buttonColor: 'red;background:url(x)' }, 'nope')['--btn']).toBe('#6366f1');
  });
});

describe('follow buttons', () => {
  const btn = buttonLook({ buttonColor: '#be185d' }, '#6366f1');
  it('brand colours, the salon’s colour, or outline', () => {
    expect(socialLook('facebook', 'brand', btn).bg).toBe('#1877f2');
    expect(socialLook('tiktok', 'salon', btn)).toEqual({ bg: '#be185d', ink: btn.ink, border: '#be185d' });
    expect(socialLook('google', 'outline', btn)).toEqual({ bg: '#ffffff', ink: '#be185d', border: '#be185d' });
    expect(socialStyleOf('weird')).toBe('brand');
  });
  it('draws only real platform links', () => {
    expect(safeSocial([
      { channel: 'facebook', url: 'https://www.facebook.com/102938475610293' },
      { channel: 'instagram', url: 'https://www.instagram.com/onglessteustache/' },
      { channel: 'facebook', url: 'javascript:alert(1)' },
      { channel: 'tiktok', url: 'https://evil.com/@x' },
      { channel: 'other', url: 'https://x.com' },
    ]).map((l) => l.channel)).toEqual(['facebook', 'instagram']);
    expect(safeSocial(null)).toEqual([]);
  });
});
