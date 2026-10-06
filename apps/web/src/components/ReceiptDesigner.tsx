'use client';

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ui, formatPrice, isZeroDecimalCurrency } from '../lib/ui';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import {
  buildReceiptHtml, buildReceiptText, DEFAULT_RECEIPT_DESIGN, missingHeader, printHtml, receiptLabels, withDefaults,
  type ReceiptData, type ReceiptDesign, type ReceiptShop,
} from '../lib/receipt';
import { ind } from '../lib/ui-industry';

/**
 * Settings → Hoá đơn in. The owner shapes the paper their customers take
 * home and sees it change as they type — the preview is built by the SAME
 * builder the till prints with, so what they see is what prints.
 *
 * The salon's name, address and phone are not switches: they are always on
 * the bill. The owner may only reword them for paper; an empty box falls back
 * to the salon profile (Settings → Company).
 */
export function ReceiptDesigner({ shop, design, currency, onSave, onOpenCompany }: {
  shop: ReceiptShop;
  design: Partial<ReceiptDesign> | undefined;
  currency: string;
  onSave: (path: string, body: unknown, label: string) => void | Promise<void>;
  onOpenCompany: () => void;
}) {
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => ind(vi ? v : e);
  const isMobile = useIsMobile();
  const [d, setD] = useState<ReceiptDesign>(() => withDefaults(design));
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<'paper' | 'thermal'>('paper');
  const [mobilePane, setMobilePane] = useState<'edit' | 'preview'>('edit');
  const set = <K extends keyof ReceiptDesign>(k: K, v: ReceiptDesign[K]) => setD((p) => ({ ...p, [k]: v }));
  const dirty = JSON.stringify(d) !== JSON.stringify(withDefaults(design));
  const missing = missingHeader(shop, d);

  const money = (c: number) => formatPrice(c, currency);
  const sample = useMemo<ReceiptData>(() => {
    // Believable amounts in the salon's own currency (a đồng price has no cents).
    const amt = (usd: number) => (isZeroDecimalCurrency(currency) ? Math.round((usd * 6250) / 1000) * 1000 : usd * 100);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      orderNumber: 1042,
      when: new Date().toLocaleString(d.language === 'vi' ? 'vi-VN' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }),
      customer: d.language === 'vi' ? 'Chị Lan' : 'Anna',
      lines: [
        { qty: 1, name: d.language === 'vi' ? 'Sơn gel tay' : 'Gel Manicure', amountCents: amt(40), origAmountCents: amt(50), discountPercent: 20, tech: 'Kim', tipCents: amt(5) },
        { qty: 1, name: d.language === 'vi' ? 'Vẽ đầu móng' : 'French tips', amountCents: amt(10), isAddon: true, tech: 'Kim' },
        { qty: 1, name: d.language === 'vi' ? 'Dầu dưỡng móng' : 'Cuticle oil', amountCents: amt(12) },
      ],
      subtotal: amt(62), tip: amt(5), savings: amt(10), total: amt(67),
      paid: [{ method: 'CASH', cents: amt(70) }], change: amt(3),
      bookingUrl: shop.bookingSlug ? `${origin}/book/${shop.bookingSlug}` : null,
    };
  }, [currency, d.language, shop.bookingSlug]);

  const html = useMemo(() => buildReceiptHtml(sample, shop, d, money), [sample, shop, d, currency]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useMemo(() => buildReceiptText(sample, shop, d, money), [sample, shop, d, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try { await onSave('receipt', d, 'Receipt'); } finally { setSaving(false); }
  }

  const labels = receiptLabels(d.language);

  const form = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {/* 1. What every bill carries */}
      <Group title={L('Thông tin tiệm', 'Salon details')} badge={L('Luôn in', 'Always printed')}
        hint={L('Tên, địa chỉ, số điện thoại luôn nằm đầu bill. Để trống = lấy từ hồ sơ tiệm.', 'Name, address and phone always head the bill. Leave a box empty to use your salon profile.')}>
        {missing.length > 0 && (
          <div style={{ background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '9px 11px', fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 200px' }}>
              ⚠️ {L('Bill đang thiếu', 'Your bill is missing')} {missing.map((k) => fieldName(k, vi)).join(', ')}.
            </span>
            <button type="button" onClick={onOpenCompany} style={{ border: 'none', background: '#92400e', color: '#ffffff', borderRadius: 7, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {L('Điền ở mục Công ty', 'Fill in Company')}
            </button>
          </div>
        )}
        <Input label={L('Tên tiệm', 'Salon name')} value={d.nameOverride} placeholder={shop.name} max={80} onChange={(v) => set('nameOverride', v)} />
        <Input label={L('Địa chỉ', 'Address')} value={d.addressOverride} placeholder={shop.address || L('Chưa có địa chỉ', 'No address yet')} max={200} onChange={(v) => set('addressOverride', v)} />
        <Input label={L('Số điện thoại', 'Phone')} value={d.phoneOverride} placeholder={shop.phone || L('Chưa có số điện thoại', 'No phone yet')} max={40} onChange={(v) => set('phoneOverride', v)} />
        <Switch on={d.showLogo} onChange={(v) => set('showLogo', v)} label={L('In logo', 'Print logo')} note={shop.logoUrl ? undefined : L('chưa có logo ở mục Thương hiệu', 'no logo in Branding yet')} />
        <Switch on={d.showWebsite} onChange={(v) => set('showWebsite', v)} label={L('In website', 'Print website')} note={shop.website ? undefined : L('chưa có website', 'no website yet')} />
        <Area label={L('Dòng thêm dưới đầu bill', 'Extra lines under the header')} value={d.headerNote} max={300}
          placeholder={L('VD: Mở cửa 9:00–19:00 mỗi ngày · Wi-Fi: LumioGuest', 'e.g. Open daily 9am–7pm · Wi-Fi: LumioGuest')} onChange={(v) => set('headerNote', v)} />
      </Group>

      {/* 2. Paper */}
      <Group title={L('Khổ giấy & chữ', 'Paper & type')}>
        <Seg label={L('Khổ giấy', 'Paper width')} value={d.paper} onChange={(v) => set('paper', v)}
          options={[{ v: '80', t: '80 mm' }, { v: '58', t: '58 mm' }]} />
        <Seg label={L('Cỡ chữ', 'Text size')} value={d.fontSize} onChange={(v) => set('fontSize', v)}
          options={[{ v: 'normal', t: L('Thường', 'Normal') }, { v: 'large', t: L('Lớn', 'Large') }]} />
        <Seg label={L('Ngôn ngữ trên bill', 'Bill language')} value={d.language} onChange={(v) => set('language', v)}
          options={[{ v: 'en', t: 'English' }, { v: 'vi', t: 'Tiếng Việt' }]} />
        <Input label={L('Tiêu đề', 'Title')} value={d.title} placeholder={labels.title} max={40} onChange={(v) => set('title', v)} />
      </Group>

      {/* 3. What shows */}
      <Group title={L('Nội dung trên bill', 'What the bill shows')}>
        <Switch on={d.showOrderNumber} onChange={(v) => set('showOrderNumber', v)} label={L('Số hoá đơn', 'Order number')} />
        <Switch on={d.showDateTime} onChange={(v) => set('showDateTime', v)} label={L('Ngày giờ', 'Date & time')} />
        <Switch on={d.showCustomer} onChange={(v) => set('showCustomer', v)} label={L('Tên khách', 'Customer name')} />
        <Switch on={d.showTechnician} onChange={(v) => set('showTechnician', v)} label={L('Tên thợ dưới mỗi dịch vụ', 'Technician under each service')} />
        <Switch on={d.showLineTips} onChange={(v) => set('showLineTips', v)} label={L('Tip của từng thợ', 'Each technician’s tip')} />
        <Switch on={d.showSavings} onChange={(v) => set('showSavings', v)} label={L('Giá gốc & số tiền khách tiết kiệm', 'Original price & “You saved”')} />
        <Switch on={d.showPayments} onChange={(v) => set('showPayments', v)} label={L('Hình thức thanh toán', 'How it was paid')} />
        <Switch on={d.showBookingQr} onChange={(v) => set('showBookingQr', v)} label={L('Mã QR đặt lịch lần sau', 'QR to book the next visit')} />
      </Group>

      {/* 4. Footer */}
      <Group title={L('Chân bill', 'Footer')}>
        <Area label={L('Lời cảm ơn, chính sách đổi trả…', 'Thank-you note, return policy…')} value={d.footer} max={500}
          placeholder={labels.thanks} onChange={(v) => set('footer', v)} />
      </Group>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={saving || !dirty} style={{ ...ui.primaryBtn, opacity: saving || !dirty ? 0.6 : 1 }}>
          {saving ? L('Đang lưu…', 'Saving…') : L('Lưu mẫu bill', 'Save receipt')}
        </button>
        <button type="button" onClick={() => printHtml(buildReceiptHtml(sample, shop, d, money))} style={ghost}>
          🖨 {L('In thử', 'Test print')}
        </button>
        <button type="button" onClick={() => setD({ ...DEFAULT_RECEIPT_DESIGN, footer: d.footer })} style={ghost}>
          {L('Về mặc định', 'Reset')}
        </button>
      </div>
    </div>
  );

  const preview = (
    <div style={{ position: isMobile ? 'static' : 'sticky', top: 12, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 999, padding: 3 }}>
        {(['paper', 'thermal'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setView(k)}
            style={{ border: 'none', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              background: view === k ? '#6366f1' : 'transparent', color: view === k ? '#ffffff' : 'var(--c94a3b8)' }}>
            {k === 'paper' ? L('Bản in thường', 'Printed page') : L('Máy in nhiệt quầy', 'Desk thermal printer')}
          </button>
        ))}
      </div>
      <Paper widthPx={d.paper === '58' ? 230 : 320}>
        {view === 'paper'
          ? <PreviewFrame html={html} />
          : <pre style={{ margin: 0, padding: '14px 10px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: d.paper === '58' ? 10.6 : 10.1, lineHeight: 1.35, color: '#111111', background: '#ffffff', whiteSpace: 'pre', overflowX: 'auto' }}>{text}</pre>}
      </Paper>
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--c64748b)', textAlign: 'center', maxWidth: 320 }}>
        {L('Bill mẫu với dữ liệu giả. Bill thật dùng đúng mẫu này cho cả máy POS, “In lại” và mục Đơn hàng.', 'Sample data. Real bills use this exact design at the till, on “Print again” and in Orders.')}
      </p>
    </div>
  );

  return (
    <div style={ui.card}>
      <h2 style={{ fontSize: 17, margin: '0 0 2px' }}>{L('Hoá đơn in', 'Printed receipt')}</h2>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 14px', fontSize: 13 }}>
        {L('Tự thiết kế bill đưa cho khách. Xem trước thay đổi ngay khi bạn chỉnh.', 'Design the bill your customers take home. The preview updates as you edit.')}
      </p>
      {isMobile && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: 3 }}>
          {(['edit', 'preview'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setMobilePane(k)}
              style={{ flex: 1, border: 'none', borderRadius: 8, padding: '9px 0', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                background: mobilePane === k ? '#6366f1' : 'transparent', color: mobilePane === k ? '#ffffff' : 'var(--c94a3b8)' }}>
              {k === 'edit' ? L('Chỉnh sửa', 'Edit') : L('Xem bill', 'Preview')}
            </button>
          ))}
        </div>
      )}
      {isMobile
        ? (mobilePane === 'edit' ? form : preview)
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 20, alignItems: 'start' }}>
            {form}
            {preview}
          </div>
        )}
      {isMobile && mobilePane === 'preview' && dirty && (
        <button type="button" onClick={save} disabled={saving} style={{ ...ui.primaryBtn, width: '100%', marginTop: 12, padding: '12px 14px', fontSize: 14 }}>
          {saving ? L('Đang lưu…', 'Saving…') : L('Lưu mẫu bill', 'Save receipt')}
        </button>
      )}
    </div>
  );
}

function fieldName(k: 'name' | 'address' | 'phone', vi: boolean) {
  if (k === 'name') return vi ? 'tên tiệm' : 'the salon name';
  if (k === 'address') return vi ? 'địa chỉ' : 'the address';
  return vi ? 'số điện thoại' : 'the phone number';
}

const ghost: CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent',
  color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
};

function Group({ title, badge, hint, children }: { title: string; badge?: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ce2e8f0)' }}>{title}</span>
          {badge && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-good)', border: '1px solid currentColor', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>🔒 {badge}</span>}
        </div>
        {hint && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 3 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Input({ label, value, placeholder, max, onChange }: { label: string; value: string; placeholder?: string; max: number; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={ui.label}>{label}</span>
      <input style={ui.input} value={value} placeholder={placeholder} maxLength={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Area({ label, value, placeholder, max, onChange }: { label: string; value: string; placeholder?: string; max: number; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={ui.label}>{label}</span>
      <textarea style={{ ...ui.input, minHeight: 64, resize: 'vertical', fontFamily: 'inherit' }} value={value} placeholder={placeholder} maxLength={max} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Switch({ on, onChange, label, note }: { on: boolean; onChange: (v: boolean) => void; label: string; note?: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ce2e8f0)', fontSize: 14, padding: '3px 0', textAlign: 'left', minHeight: 30 }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : 'var(--c475569)', position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white', transition: 'left .15s' }} />
      </span>
      <span>{label}{note && <span style={{ color: 'var(--c64748b)', fontSize: 12 }}> · {note}</span>}</span>
    </button>
  );
}

function Seg<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <span style={ui.label}>{label}</span>
      <div style={{ display: 'flex', gap: 6 }}>
        {options.map((o) => {
          const on = o.v === value;
          return (
            <button key={o.v} type="button" onClick={() => onChange(o.v)}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
                border: '1px solid ' + (on ? '#6366f1' : 'var(--c475569)'), background: on ? 'var(--c312e81)' : 'transparent', color: 'var(--ce2e8f0)' }}>
              {o.t}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A strip of receipt paper with a torn bottom edge. */
function Paper({ widthPx, children }: { widthPx: number; children: ReactNode }) {
  return (
    <div style={{ width: widthPx, maxWidth: '100%', background: '#ffffff', borderRadius: '4px 4px 0 0', boxShadow: '0 10px 30px rgba(0,0,0,.28)', position: 'relative', transition: 'width .2s' }}>
      {children}
      <div aria-hidden style={{ height: 10, background: 'linear-gradient(135deg, #ffffff 50%, transparent 50%) 0 0 / 10px 10px repeat-x, linear-gradient(-135deg, #ffffff 50%, transparent 50%) 0 0 / 10px 10px repeat-x', position: 'absolute', left: 0, right: 0, bottom: -10 }} />
    </div>
  );
}

/** The real receipt page, rendered as the printer gets it (no scripts run). */
function PreviewFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(520);
  const fit = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setH(Math.max(200, doc.documentElement.scrollHeight + 4));
  };
  return (
    <iframe ref={ref} title="receipt-preview" srcDoc={html} sandbox="allow-same-origin" onLoad={fit}
      style={{ display: 'block', width: '100%', height: h, border: 0, background: '#ffffff' }} />
  );
}
