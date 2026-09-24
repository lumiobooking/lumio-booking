import { shortLabel, splitLinks, unwrapRedirect } from './linkify';

describe('links in notes', () => {
  it('unwraps the Facebook redirect to the real address', () => {
    const inner = 'https://drive.google.com/file/d/1Dbly/view?usp=drivesdk';
    const wrapped = 'https://l.facebook.com/l.php?u=' + encodeURIComponent(inner + '&fbclid=abc') + '&h=AT1';
    expect(unwrapRedirect(wrapped)).toBe(inner + '&fbclid=abc');
  });
  it('leaves an ordinary link alone', () => {
    expect(unwrapRedirect('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
  it('shortens a long link to host + path start', () => {
    const s = shortLabel('https://www.drive.google.com/file/d/1DblyXTJqgUWFKtteF1ypPEh7j3ZXmNeU/view?usp=drivesdk');
    expect(s.startsWith('drive.google.com/file/d/')).toBe(true);
    expect(s.length).toBeLessThanOrEqual(48);
  });
  it('splits a note into text and links, keeping the sentence punctuation outside', () => {
    const runs = splitLinks('xem ảnh này: https://example.com/a. cảm ơn');
    expect(runs).toEqual([
      { kind: 'text', text: 'xem ảnh này: ' },
      { kind: 'link', url: 'https://example.com/a', label: 'example.com/a' },
      { kind: 'text', text: '. cảm ơn' },
    ]);
  });
});
