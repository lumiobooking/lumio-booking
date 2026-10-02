import {
  buildReceiptHtml, buildReceiptText, DEFAULT_RECEIPT_DESIGN, missingHeader, receiptHeader, wrap,
  type ReceiptData, type ReceiptShop,
} from './receipt';

/**
 * The owner designs the bill — but the salon's name, address and phone are
 * always on it, and the till prints exactly what the editor previews.
 */

const shop: ReceiptShop = {
  name: 'Lumio Nails', address: '12 Main St, Islip NY 11751', phone: '(631) 320-3255',
  website: 'lumionails.com', logoUrl: 'https://cdn.test/logo.png', bookingSlug: 'lumio-nails',
};
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const sale: ReceiptData = {
  orderNumber: 1042, when: '10/1/26, 2:15 PM', customer: 'Anna',
  lines: [
    { qty: 1, name: 'Gel Manicure', amountCents: 4000, tech: 'Kim', tipCents: 500, discountPercent: 20, origAmountCents: 5000 },
    { qty: 1, name: 'French tips', amountCents: 1000, isAddon: true, tech: 'Kim' },
  ],
  subtotal: 5000, tax: 0, tip: 500, savings: 1000, total: 5500,
  paid: [{ method: 'CASH', cents: 6000 }], change: 500,
};

describe('the header a bill can never lose', () => {
  it('prints the salon’s name, address and phone even with every option off', () => {
    const off = { ...DEFAULT_RECEIPT_DESIGN, showLogo: false, showWebsite: false, showOrderNumber: false, showDateTime: false, showCustomer: false, showTechnician: false, showLineTips: false, showSavings: false, showPayments: false };
    const txt = buildReceiptText(sale, shop, off, money);
    expect(txt).toContain('LUMIO NAILS');
    expect(txt).toContain('12 Main St');
    expect(txt).toContain('(631) 320-3255');
    const html = buildReceiptHtml(sale, shop, off, money);
    expect(html).toContain('Lumio Nails');
    expect(html).toContain('12 Main St, Islip NY 11751');
    expect(html).toContain('(631) 320-3255');
  });

  it('uses the owner’s wording for paper, and the salon profile where they left it empty', () => {
    const h = receiptHeader(shop, { ...DEFAULT_RECEIPT_DESIGN, nameOverride: 'LUMIO NAILS & SPA', addressOverride: '  ' });
    expect(h).toEqual({ name: 'LUMIO NAILS & SPA', address: '12 Main St, Islip NY 11751', phone: '(631) 320-3255' });
  });

  it('tells the editor which of the three is still missing', () => {
    expect(missingHeader({ ...shop, address: '', phone: '' }, DEFAULT_RECEIPT_DESIGN)).toEqual(['address', 'phone']);
    expect(missingHeader({ ...shop, address: '' }, { ...DEFAULT_RECEIPT_DESIGN, addressOverride: '1 Elm' })).toEqual([]);
  });
});

describe('the owner’s choices', () => {
  it('hides what they turned off', () => {
    const d = { ...DEFAULT_RECEIPT_DESIGN, showTechnician: false, showLineTips: false, showPayments: false, showCustomer: false, showWebsite: false };
    const txt = buildReceiptText(sale, shop, d, money);
    expect(txt).not.toContain('Kim');
    expect(txt).not.toMatch(/^\s+Tip:/m);
    expect(txt).not.toContain('Paid');
    expect(txt).not.toContain('Anna');
    expect(txt).not.toContain('lumionails.com');
    expect(txt).toContain('TOTAL');
  });

  it('their own title, note and footer lines', () => {
    const d = { ...DEFAULT_RECEIPT_DESIGN, title: 'SALES RECEIPT', headerNote: 'Open 7 days', footer: 'No refunds after 7 days\nSee you soon!' };
    const txt = buildReceiptText(sale, shop, d, money);
    expect(txt).toContain('SALES RECEIPT');
    expect(txt).toContain('Open 7 days');
    expect(txt).toContain('No refunds after 7 days');
    expect(txt).toContain('See you soon!');
    expect(txt).not.toContain('Thank you!');
  });

  it('a Vietnamese bill', () => {
    const txt = buildReceiptText(sale, shop, { language: 'vi' }, money);
    expect(txt).toContain('HOÁ ĐƠN');
    expect(txt).toContain('TỔNG CỘNG');
    expect(txt).toContain('Đã trả · Tiền mặt');
    expect(txt).toContain('Tiền thối');
    expect(txt).toContain('ĐT: (631) 320-3255');
  });

  it('58mm paper is 32 characters wide and long lines wrap instead of running off', () => {
    const txt = buildReceiptText(sale, { ...shop, address: '12345 Very Long Boulevard Name, Suite 200, Islip NY 11751' }, { paper: '58' }, money);
    for (const l of txt.split('\n')) expect(l.length).toBeLessThanOrEqual(32);
    expect(txt).toContain('Suite 200');
    const wide = buildReceiptText(sale, shop, { paper: '80' }, money);
    expect(Math.max(...wide.split('\n').map((l) => l.length))).toBe(48);
  });

  it('booking QR only when the owner asks for it', () => {
    const data = { ...sale, bookingUrl: 'https://app.test/book/lumio-nails' };
    expect(buildReceiptHtml(data, shop, {}, money)).not.toContain('book%2Flumio-nails');
    expect(buildReceiptHtml(data, shop, { showBookingQr: true }, money)).toContain('book%2Flumio-nails');
  });

  it('paper size reaches the printer', () => {
    expect(buildReceiptHtml(sale, shop, { paper: '58' }, money)).toContain('size:58mm auto');
  });
});

describe('safety', () => {
  it('escapes everything the owner or a customer typed', () => {
    const html = buildReceiptHtml(
      { ...sale, customer: '<img src=x onerror=alert(1)>' },
      { ...shop, name: 'A & B <script>' },
      { footer: '<b>hi</b>', headerNote: '"quoted"' },
      money,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('A &amp; B &lt;script&gt;');
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
  });

  it('wrap never cuts a line wider than the paper', () => {
    expect(wrap('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bb', 32).every((l) => l.length <= 32)).toBe(true);
  });
});
