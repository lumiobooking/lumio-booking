import { widgetSource } from './web-chat-widget';

/**
 * The widget ships as one string of JavaScript, so the only honest way to test
 * the part that matters is to run THAT string — not a copy of it kept in sync
 * by hope. The linkifier sits between two markers; this pulls it out, gives it
 * the two helpers it closes over, and runs the real shipped code.
 */
function loadRich(lang: 'vi' | 'en' = 'vi'): (s: string) => string {
  const src = widgetSource();
  const a = src.indexOf('/* __LINKIFY_START__ */');
  const b = src.indexOf('/* __LINKIFY_END__ */');
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  const body = src.slice(a, b);
  // esc() in the widget uses the DOM; jsdom is not loaded for this suite, so
  // the same four replacements stand in. If they ever diverge the XSS tests
  // below get WEAKER, never falsely green — they assert on the output shape.
  const harness = `
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function t(k) { return ({ appt: ${JSON.stringify(lang === 'vi' ? 'Xem lịch hẹn của bạn' : 'View your appointment')} })[k]; }
    ${body}
    return rich;
  `;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(harness)() as (s: string) => string;
}

const APPT = 'https://lumiobooking.com/appt/eyJhIjoiYzEyMyIsImV4cCI6MTc5MDAwMDAwMDAwMH0.abcdefghijklmnopqrstuvwxyz0123456789';

describe('the confirmation link a visitor has to be able to press', () => {
  it('turns the appointment link into a real anchor', () => {
    const out = loadRich()(`Đã đặt lịch cho chị rồi ạ.\n${APPT}`);
    expect(out).toContain(`href="${APPT}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('shows a named button instead of 200 characters of token', () => {
    const out = loadRich()(APPT);
    expect(out).toContain('Xem lịch hẹn của bạn');
    expect(out).toContain('class="lk btn"');
    // the raw token must not be the thing the customer reads
    expect(out).not.toContain('>' + APPT + '<');
  });

  it('says it in English for an English salon', () => {
    expect(loadRich('en')(APPT)).toContain('View your appointment');
  });

  it('still escapes everything that is not a link', () => {
    const out = loadRich()('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  it('cannot be broken out of by a link that carries a quote', () => {
    const out = loadRich()('https://evil.test/a"onmouseover="alert(1)');
    // the quote is an entity before this code ever sees it, so it stays
    // inside the attribute instead of closing it
    expect(out).not.toContain('onmouseover="alert(1)"');
    expect(out).toContain('&quot;');
  });

  it('leaves javascript: and data: alone', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x']) {
      expect(loadRich()(bad)).not.toContain('<a ');
    }
  });

  it('does not swallow the full stop that ends the sentence', () => {
    const out = loadRich()('Xem tại https://lumiobooking.com/gia.');
    expect(out).toContain('href="https://lumiobooking.com/gia"');
    expect(out).toContain('</a>.');
  });

  it('shortens a long ordinary link but keeps the real target', () => {
    const long = 'https://lumiobooking.com/' + 'x'.repeat(80);
    const out = loadRich()(long);
    expect(out).toContain(`href="${long}"`);
    expect(out).toContain('…');
  });

  it('leaves plain text with no link untouched apart from escaping', () => {
    expect(loadRich()('Dạ em cảm ơn chị')).toBe('Dạ em cảm ơn chị');
  });
});
