import {
  cleanText, cleanVisitor, cleanWebChatConfig, embedSnippet, isWebPage, turnsSince, webPageId, WEB_CHAT_DEFAULTS,
} from './web-chat';
import { widgetSource } from './web-chat-widget';

describe('website chat — the pure parts', () => {
  it('names the mouth by tenant and recognises it', () => {
    expect(webPageId('t1')).toBe('web:t1');
    expect(isWebPage('web:t1')).toBe(true);
    expect(isWebPage('1088037331054060')).toBe(false);
    expect(isWebPage(null)).toBe(false);
  });

  it('accepts only a visitor id the browser could have minted', () => {
    expect(cleanVisitor('abcDEF0123456789xyz_-')).toBe('abcDEF0123456789xyz_-');
    expect(cleanVisitor('short')).toBeNull();
    expect(cleanVisitor('has spaces in it and more')).toBeNull();
    expect(cleanVisitor(undefined)).toBeNull();
  });

  it('trims, squashes and bounds a line, and refuses an empty one', () => {
    expect(cleanText('  xin   chào \n ')).toBe('xin chào');
    expect(cleanText('   ')).toBeNull();
    expect(cleanText('a'.repeat(2000))?.length).toBe(1000);
  });

  it('ships OFF, and a settings write moves only what it names', () => {
    expect(WEB_CHAT_DEFAULTS.enabled).toBe(false);
    const on = cleanWebChatConfig({ enabled: true, color: '#22C55E', greeting: '  Chào  bạn ' }, null);
    expect(on).toEqual({ enabled: true, color: '#22c55e', greeting: 'Chào bạn', position: 'right' });
    // Saving the greeting alone must not flip the switch; a bad colour is ignored.
    const later = cleanWebChatConfig({ greeting: 'Hi', color: 'red', position: 'left', junk: 1 }, on);
    expect(later).toEqual({ enabled: true, color: '#22c55e', greeting: 'Hi', position: 'left' });
  });

  it('returns only what the browser does not have, skipping failed and empty turns', () => {
    const h = [
      { role: 'user', content: 'hi', at: '2026-09-10T01:00:00.000Z' },
      { role: 'assistant', content: 'Hello!', at: '2026-09-10T01:00:05.000Z' },
      { role: 'assistant', content: 'never went', at: '2026-09-10T01:00:06.000Z', failed: true },
      { role: 'assistant', content: 'from a person', at: '2026-09-10T01:00:09.000Z', manual: true },
      { role: 'assistant', content: '   ', at: '2026-09-10T01:00:10.000Z' },
      { role: 'assistant', content: 'old turn without a clock' },
    ];
    const all = turnsSince(h, null);
    expect(all.map((t) => t.text)).toEqual(['hi', 'Hello!', 'from a person', 'old turn without a clock']);
    expect(all[2].human).toBe(true);
    const fresh = turnsSince(h, '2026-09-10T01:00:05.000Z');
    expect(fresh.map((t) => t.text)).toEqual(['from a person']);
  });

  it('writes the one line the salon pastes', () => {
    expect(embedSnippet('https://api.example.com/api', 'lux-nail-spa'))
      .toBe('<script src="https://api.example.com/api/public/chat/widget.js" data-salon="lux-nail-spa" async></script>');
  });

  it('serves a widget that parses as JavaScript and talks only to its own prefix', () => {
    const js = widgetSource();
    expect(() => new Function(js)).not.toThrow();
    expect(js).toContain("'/public/chat/'");
    expect(js).not.toMatch(/\$\{/);
  });
});
