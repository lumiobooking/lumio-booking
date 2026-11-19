import { blockedLabel, blockedTone, filterItems, kindLabel, modesFor, parseTags, payLine, type LibraryItem, type PayRequest } from './photo-library';

const it0 = (o: Partial<LibraryItem>): LibraryItem => ({
  id: 'x', url: 'https://x/a.jpg', kind: 'sample', title: '', serviceId: null, serviceName: null, tags: [], aiAllowed: true, expiresAt: null,
  flags: [], consent: false, status: 'ready', source: 'upload', sentCount: 0, lastSentAt: null, createdAt: '', blocked: null, ...o,
});

describe('photo library screen helpers', () => {
  const items = [
    it0({ id: 'fr', title: 'French trắng', tags: ['french', 'trắng'] }),
    it0({ id: 'pl', kind: 'price_list', blocked: 'price_stale' }),
    it0({ id: 'po', status: 'pending', blocked: 'pending' }),
    it0({ id: 're', kind: 'result', blocked: 'no_consent' }),
    it0({ id: 'off', aiAllowed: false, blocked: 'ai_off' }),
  ];
  it('filters by kind; samples include customer results', () => {
    expect(filterItems(items, 'sample', '').map((i) => i.id)).toEqual(['fr', 'po', 're', 'off']);
    expect(filterItems(items, 'price_list', '').map((i) => i.id)).toEqual(['pl']);
  });
  it('"needs you" collects pending, stale and privacy — not pictures merely switched off for the AI', () => {
    expect(filterItems(items, 'review', '').map((i) => i.id)).toEqual(['pl', 'po', 're']);
  });
  it('search ignores Vietnamese marks', () => {
    expect(filterItems(items, 'all', 'trang').map((i) => i.id)).toEqual(['fr']);
  });
  it('labels and tones', () => {
    expect(kindLabel('price_list', true)).toBe('Bảng giá');
    expect(blockedTone('flagged')).toBe('bad');
    expect(blockedTone('expired')).toBe('warn');
    expect(blockedLabel(null, true)).toBeNull();
    expect(modesFor('result')).toEqual(['approve', 'off']);
  });
  it('tags from a comma list', () => {
    expect(parseTags(' French, trắng ,french,, vuông ')).toEqual(['french', 'trắng', 'vuông']);
  });
  it('deposit lines never say received from a picture alone', () => {
    const r: PayRequest = { code: 'LB482913', threadId: 't', appointmentId: null, amountCents: 100000, at: '', by: null, status: 'sent' };
    expect(payLine(r, true).text).toMatch(/Chờ khách chuyển/);
    const claimed = payLine({ ...r, status: 'claimed', claim: { amountCents: 100000, codeSeen: true, at: '' } }, true);
    expect(claimed.text).toMatch(/chưa đối chiếu ngân hàng/);
    expect(claimed.text).not.toMatch(/đã nhận/i);
    expect(payLine({ ...r, status: 'paid', bank: { amountCents: 100000, ref: 'x', at: '' } }, true)).toMatchObject({ tone: 'ok' });
    expect(payLine({ ...r, status: 'partial', bank: { amountCents: 50000, ref: 'x', at: '' } }, true).text).toMatch(/chưa đủ/);
  });
});
