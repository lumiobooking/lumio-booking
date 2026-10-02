/**
 * The printed bill — one builder for every place that prints one (the till
 * after a sale, "In lại", the Orders screen), shaped by the owner's design
 * (Settings → Hoá đơn in).
 *
 * Two outputs from the same data:
 *   - text, for the reception thermal printer (32 or 48 characters wide);
 *   - HTML, for printing from the phone / iPad / computer.
 *
 * What the owner can NOT remove: the salon's name, address and phone at the
 * top. A receipt that does not say who issued it is not a receipt. The owner
 * may reword them for paper; when they leave a line empty the salon profile
 * fills it.
 *
 * Pure (no React, no fetch) so it is tested directly in receipt.spec.ts —
 * except printHtml at the bottom, which only hands a built page to the printer.
 */

export interface ReceiptDesign {
  title: string;
  language: 'en' | 'vi';
  paper: '58' | '80';
  fontSize: 'normal' | 'large';
  showLogo: boolean;
  nameOverride: string;
  addressOverride: string;
  phoneOverride: string;
  headerNote: string;
  showWebsite: boolean;
  showOrderNumber: boolean;
  showDateTime: boolean;
  showCustomer: boolean;
  showTechnician: boolean;
  showLineTips: boolean;
  showSavings: boolean;
  showPayments: boolean;
  showBookingQr: boolean;
  footer: string;
}

export const DEFAULT_RECEIPT_DESIGN: ReceiptDesign = {
  title: '', language: 'en', paper: '80', fontSize: 'normal', showLogo: true,
  nameOverride: '', addressOverride: '', phoneOverride: '', headerNote: '',
  showWebsite: true, showOrderNumber: true, showDateTime: true, showCustomer: true,
  showTechnician: true, showLineTips: true, showSavings: true, showPayments: true,
  showBookingQr: false, footer: '',
};

export interface ReceiptShop { name: string; address: string; phone: string; website: string; logoUrl: string; bookingSlug?: string }
export interface ReceiptProfile { shop: ReceiptShop; design: ReceiptDesign }

export interface ReceiptLine {
  qty: number;
  name: string;
  amountCents: number;
  /** Before the line's own discount, when it had one. */
  origAmountCents?: number;
  discountPercent?: number;
  isAddon?: boolean;
  tech?: string | null;
  tipCents?: number;
}

export interface ReceiptData {
  orderNumber: string | number;
  /** Already formatted in the salon's timezone. */
  when: string;
  customer?: string | null;
  voided?: boolean;
  lines: ReceiptLine[];
  subtotal: number;
  discount?: number;
  tax?: number;
  tip?: number;
  cardFee?: number;
  cardFeePct?: number;
  savings?: number;
  total: number;
  /** Method keys (CASH, CARD, TRANSFER, GIFT, VIETQR…) or a ready label. */
  paid?: { method: string; cents: number }[];
  change?: number;
  feedbackLink?: string | null;
  bookingUrl?: string | null;
}

type Money = (cents: number) => string;

const LABELS = {
  en: {
    title: 'RECEIPT', order: 'Order', customer: 'Customer', subtotal: 'Subtotal', discount: 'Discount', tax: 'Tax',
    tip: 'Tip', cardFee: 'Card fee', saved: 'You saved', total: 'TOTAL', paid: 'Paid', change: 'Change', addon: 'add-on',
    voided: 'VOID', feedback: 'How was your visit?', feedbackCta: 'Scan to tell us', book: 'Book your next visit', thanks: 'Thank you!',
    phone: 'Tel',
    methods: { CASH: 'Cash', CARD: 'Card', TRANSFER: 'Transfer', GIFT: 'Gift card', GIFT_CARD: 'Gift card', VIETQR: 'VietQR', MOMO: 'MoMo', ZALOPAY: 'ZaloPay', CHECK: 'Check', OTHER: 'Other' } as Record<string, string>,
  },
  vi: {
    title: 'HOÁ ĐƠN', order: 'Số', customer: 'Khách', subtotal: 'Tạm tính', discount: 'Giảm giá', tax: 'Thuế',
    tip: 'Tip', cardFee: 'Phí thẻ', saved: 'Tiết kiệm', total: 'TỔNG CỘNG', paid: 'Đã trả', change: 'Tiền thối', addon: 'thêm',
    voided: 'ĐÃ HUỶ', feedback: 'Dịch vụ hôm nay thế nào?', feedbackCta: 'Quét để góp ý', book: 'Đặt lịch lần sau', thanks: 'Cảm ơn quý khách!',
    phone: 'ĐT',
    methods: { CASH: 'Tiền mặt', CARD: 'Thẻ', TRANSFER: 'Chuyển khoản', GIFT: 'Thẻ quà tặng', GIFT_CARD: 'Thẻ quà tặng', VIETQR: 'VietQR', MOMO: 'MoMo', ZALOPAY: 'ZaloPay', CHECK: 'Séc', OTHER: 'Khác' } as Record<string, string>,
  },
};

export function receiptLabels(lang: 'en' | 'vi') { return LABELS[lang] ?? LABELS.en; }

/** A design from settings, completed with defaults (old salons have none). */
export function withDefaults(d: Partial<ReceiptDesign> | null | undefined): ReceiptDesign {
  return { ...DEFAULT_RECEIPT_DESIGN, ...(d ?? {}) };
}

/** The three lines a bill must carry, as this salon prints them. */
export function receiptHeader(shop: ReceiptShop, design: ReceiptDesign): { name: string; address: string; phone: string } {
  return {
    name: design.nameOverride.trim() || shop.name.trim(),
    address: design.addressOverride.trim() || shop.address.trim(),
    phone: design.phoneOverride.trim() || shop.phone.trim(),
  };
}

/** What the header is still missing — the editor warns about these. */
export function missingHeader(shop: ReceiptShop, design: ReceiptDesign): ('name' | 'address' | 'phone')[] {
  const h = receiptHeader(shop, design);
  return (['name', 'address', 'phone'] as const).filter((k) => !h[k]);
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function methodLabel(m: string, lang: 'en' | 'vi'): string {
  return LABELS[lang].methods[m.toUpperCase()] ?? m;
}

// ------------------------------------------------------------------ text

/** Word-wrap one line to the paper width. */
export function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of s.split(/\s+/).filter(Boolean)) {
    if (word.length > w) { if (cur) { out.push(cur); cur = ''; } for (let i = 0; i < word.length; i += w) out.push(word.slice(i, i + w)); continue; }
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= w) cur += ' ' + word;
    else { out.push(cur); cur = word; }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildReceiptText(data: ReceiptData, shop: ReceiptShop, design0: Partial<ReceiptDesign>, money: Money): string {
  const d = withDefaults(design0);
  const L = receiptLabels(d.language);
  const W = d.paper === '58' ? 32 : 48;
  const row = (l: string, r: string) => {
    const left = l.length > W - r.length - 1 ? l.slice(0, W - r.length - 1) : l;
    return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
  };
  const center = (s: string) => wrap(s, W).map((x) => ' '.repeat(Math.max(0, Math.floor((W - x.length) / 2))) + x).join('\n');
  const sep = '-'.repeat(W);
  const h = receiptHeader(shop, d);
  const out: string[] = [];
  out.push(center(h.name.toUpperCase()));
  if (h.address) out.push(center(h.address));
  if (h.phone) out.push(center(`${L.phone}: ${h.phone}`));
  if (d.showWebsite && shop.website) out.push(center(shop.website));
  for (const n of lines(d.headerNote)) out.push(center(n));
  out.push(sep);
  out.push(center((d.title.trim() || L.title) + (data.voided ? ` · ${L.voided}` : '')));
  if (d.showOrderNumber) out.push(center(`${L.order} #${data.orderNumber}`));
  if (d.showDateTime) out.push(center(data.when));
  if (d.showCustomer && data.customer) out.push(center(`${L.customer}: ${data.customer}`));
  out.push(sep);
  for (const l of data.lines) {
    out.push(row(`${l.qty}x ${l.name}${l.isAddon ? ` (${L.addon})` : ''}`, money(l.amountCents)));
    if (d.showTechnician && l.tech) out.push(`  ${l.tech}`);
    if (d.showLineTips && l.tipCents) out.push(`  ${L.tip}: ${money(l.tipCents)}`);
  }
  out.push(sep);
  out.push(row(L.subtotal, money(data.subtotal)));
  if (data.discount) out.push(row(L.discount, '-' + money(data.discount)));
  if (data.tax) out.push(row(L.tax, money(data.tax)));
  if (data.tip) out.push(row(L.tip, money(data.tip)));
  if (data.cardFee) out.push(row(`${L.cardFee}${data.cardFeePct ? ` (${data.cardFeePct}%)` : ''}`, money(data.cardFee)));
  if (d.showSavings && data.savings) out.push(row(L.saved, '-' + money(data.savings)));
  out.push(row(L.total, money(data.total)));
  if (d.showPayments) for (const p of data.paid ?? []) out.push(row(`${L.paid} · ${methodLabel(p.method, d.language)}`, money(p.cents)));
  if (data.change) out.push(row(L.change, money(data.change)));
  out.push(sep);
  const foot = lines(d.footer);
  for (const f of foot.length ? foot : [L.thanks]) out.push(center(f));
  if (data.feedbackLink) out.push('', center(L.feedback), center(data.feedbackLink));
  if (d.showBookingQr && data.bookingUrl) out.push('', center(L.book), center(data.bookingUrl));
  return out.join('\n') + '\n';
}

// ------------------------------------------------------------------ html

const qr = (url: string, px: number) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${px * 2}x${px * 2}&margin=1&data=${encodeURIComponent(url)}`;

export function buildReceiptHtml(data: ReceiptData, shop: ReceiptShop, design0: Partial<ReceiptDesign>, money: Money, opts: { autoPrint?: boolean } = {}): string {
  const d = withDefaults(design0);
  const L = receiptLabels(d.language);
  const h = receiptHeader(shop, d);
  const big = d.fontSize === 'large';
  const fs = big ? 15 : 13;
  const small = big ? 13 : 11;
  const widthMm = d.paper === '58' ? 48 : 72;
  const line = (label: string, val: string, bold = false) =>
    `<tr${bold ? ' class="b"' : ''}><td>${label}</td><td class="r">${val}</td></tr>`;
  const rows = data.lines.map((l) => {
    const disc = d.showSavings && l.discountPercent && l.origAmountCents
      ? `<div class="s"><s>${money(l.origAmountCents)}</s> &nbsp;-${l.discountPercent}%</div>` : '';
    const tech = d.showTechnician && l.tech ? `<div class="s">${esc(l.tech)}</div>` : '';
    const tip = d.showLineTips && l.tipCents ? `<div class="s">${L.tip}: ${money(l.tipCents)}</div>` : '';
    const addon = l.isAddon ? ` <span class="s">(${L.addon})</span>` : '';
    return `<tr><td>${l.qty}× ${esc(l.name)}${addon}${disc}${tech}${tip}</td><td class="r">${money(l.amountCents)}</td></tr>`;
  }).join('');
  const foot = lines(d.footer);
  const meta = [
    d.showOrderNumber ? `${L.order} #${esc(String(data.orderNumber))}` : '',
    d.showDateTime ? esc(data.when) : '',
  ].filter(Boolean).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title.trim() || L.title)} #${esc(String(data.orderNumber))}</title>
<style>
@page{size:${d.paper}mm auto;margin:0}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;width:${widthMm}mm;margin:0 auto;padding:4mm 0;color:#000;font-size:${fs}px;line-height:1.35}
.c,.center{text-align:center}.r{text-align:right;white-space:nowrap;vertical-align:top;padding-left:6px}
.name{font-size:${fs + 5}px;font-weight:700;letter-spacing:.02em}
.s{font-size:${small}px;color:#333}
.t{font-size:${fs + 1}px;font-weight:700;letter-spacing:.08em;margin-top:2px}
table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
tr.b td{font-weight:700;font-size:${fs + 2}px;padding-top:4px}
hr{border:none;border-top:1px dashed #000;margin:6px 0}
img.logo{display:block;margin:0 auto 4px;max-width:60%;max-height:${big ? 70 : 56}px}
img.qr{display:block;margin:4px auto 0}
</style></head><body>
${d.showLogo && shop.logoUrl ? `<img class="logo" src="${esc(shop.logoUrl)}" alt="">` : ''}
<div class="c name">${esc(h.name)}</div>
${h.address ? `<div class="c">${esc(h.address)}</div>` : ''}
${h.phone ? `<div class="c">${L.phone}: ${esc(h.phone)}</div>` : ''}
${d.showWebsite && shop.website ? `<div class="c s">${esc(shop.website)}</div>` : ''}
${lines(d.headerNote).map((n) => `<div class="c s">${esc(n)}</div>`).join('')}
<hr>
<div class="c t">${esc(d.title.trim() || L.title)}${data.voided ? ` · ${L.voided}` : ''}</div>
${meta ? `<div class="c s">${meta}</div>` : ''}
${d.showCustomer && data.customer ? `<div class="c s">${L.customer}: ${esc(data.customer)}</div>` : ''}
<hr>
<table>${rows}</table>
<hr>
<table>
${line(L.subtotal, money(data.subtotal))}
${data.discount ? line(L.discount, '-' + money(data.discount)) : ''}
${data.tax ? line(L.tax, money(data.tax)) : ''}
${data.tip ? line(L.tip, money(data.tip)) : ''}
${data.cardFee ? line(`${L.cardFee}${data.cardFeePct ? ` (${data.cardFeePct}%)` : ''}`, money(data.cardFee)) : ''}
${d.showSavings && data.savings ? line(L.saved, '-' + money(data.savings)) : ''}
${line(L.total, money(data.total), true)}
${d.showPayments ? (data.paid ?? []).map((p) => line(`${L.paid} · ${esc(methodLabel(p.method, d.language))}`, money(p.cents))).join('') : ''}
${data.change ? line(L.change, money(data.change)) : ''}
</table>
<hr>
${(foot.length ? foot : [L.thanks]).map((f) => `<div class="c">${esc(f)}</div>`).join('')}
${data.feedbackLink ? `<hr><div class="c"><b>${L.feedback}</b><img class="qr" src="${qr(data.feedbackLink, 110)}" width="110" height="110" alt=""><div class="s">${L.feedbackCta}</div></div>` : ''}
${d.showBookingQr && data.bookingUrl ? `<hr><div class="c"><b>${L.book}</b><img class="qr" src="${qr(data.bookingUrl, 100)}" width="100" height="100" alt=""><div class="s">${esc(data.bookingUrl.replace(/^https?:\/\//, ''))}</div></div>` : ''}
${opts.autoPrint ? '<script>window.onload=function(){window.print();}</script>' : ''}
</body></html>`;
}

// ------------------------------------------------------------------ print

/**
 * Print a built receipt through a hidden same-page iframe. Reliable on iOS
 * Safari and Android Chrome (popups are blocked on phones) and uses the
 * device's own print sheet (AirPrint / Android Print / desktop dialog).
 */
export function printHtml(html: string): void {
  if (typeof document === 'undefined') return;
  const prev = document.getElementById('lumio-print-frame');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'lumio-print-frame';
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) return;
  doc.open(); doc.write(html); doc.close();
  let printed = false;
  const fire = () => { if (printed) return; printed = true; try { win.focus(); win.print(); } catch { /* ignore */ } };
  iframe.onload = () => setTimeout(fire, 60);
  setTimeout(fire, 400); // some mobile browsers never fire onload
  setTimeout(() => iframe.remove(), 60000);
}
