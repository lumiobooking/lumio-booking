import { readFileSync } from 'fs';
import { join } from 'path';
import { readerHowTo } from './reader-howto';

/**
 * "Không có chỗ nhập mã" (31 Oct): the add-reader row was four grey boxes with
 * no heading, so salons did not see where the terminal's code goes — and the
 * Square button stayed greyed until something was typed in a code box Square
 * does not even use.
 */
describe('adding a card reader', () => {
  it('Helcim: type the code the Smart Terminal shows in Paired mode', () => {
    const h = readerHowTo('helcim', true);
    expect(h.needsCode).toBe(true);
    expect(h.codeLabel).toBe('Mã trên màn hình máy');
    expect(h.steps.join(' ')).toMatch(/Paired/);
    expect(h.steps.join(' ')).toMatch(/nhờ Helcim bật/);
  });

  it('Square: nothing to type — Lumio makes the pairing code', () => {
    const s = readerHowTo('square', true);
    expect(s.needsCode).toBe(false);
    expect(s.button).toBe('Tạo mã ghép');
    expect(readerHowTo('square', false).steps.join(' ')).toMatch(/device code/);
  });

  it('every provider has steps in both languages; Dejavoo asks for the TPN', () => {
    for (const p of ['helcim', 'square', 'stripe', 'dejavoo', 'adyen', 'sumup', 'mock']) {
      expect(readerHowTo(p, true).steps.length).toBeGreaterThan(0);
      expect(readerHowTo(p, false).steps.length).toBeGreaterThan(0);
    }
    expect(readerHowTo('dejavoo', false).codeLabel).toBe('TPN');
  });

  it('the page shows a titled box with labelled fields, and Square is not blocked by an empty code', () => {
    const page = readFileSync(join(__dirname, '..', 'app', 'salon', 'payment-terminals', 'page.tsx'), 'utf8');
    expect(page).toMatch(/＋ Thêm máy cà thẻ/);
    expect(page).toMatch(/how\.needsCode && \(/);
    expect(page).toMatch(/disabled=\{how\.needsCode && !code\.trim\(\)\}/);
    expect(page).not.toMatch(/<p style=\{\{ color: 'var\(--c64748b\)', fontSize: 13 \}\}>—<\/p>/);
  });
});
