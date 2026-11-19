'use client';

/**
 * Ai nhận thông báo gì — the owner's switches for the restaurant alerts
 * (19/11/2026, mockup "4 · Ai nhận thông báo gì"): per alert, owner and/or
 * managers; the thresholds; a second person's PIN to close a shift; and each
 * owner / manager's phones, with a test button.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { useLang } from '../../lib/i18n';
import { formatPrice } from '../../lib/ui';
import { PushEnable } from '../PushEnable';
import { C, Card, H2, num, one } from './rk';

type Key = 'shiftOpen' | 'shiftClose' | 'checkVoid' | 'itemVoids' | 'bigDiscount' | 'tableOpen' | 'paid' | 'nightly';
interface Settings {
  notify: Record<Key, { owner: boolean; manager: boolean }>;
  voidItems: number; voidWindowMin: number; discountPct: number; varianceCents: number; shiftMaxHours: number; witnessOnClose: boolean;
}
interface Resp { settings: Settings; people: { id: string; name: string; kind: 'owner' | 'manager'; devices: number }[] }

const ROWS: [Key, [string, string], [string, string]][] = [
  ['shiftOpen', ['Vào ca', 'Shift started'], ['Ai vào ca, tiền đầu ca', 'Who, opening float']],
  ['shiftClose', ['Đóng ca', 'Shift closed'], ['Phải có / đếm được / lệch', 'Should hold / counted / off']],
  ['checkVoid', ['Huỷ bill, hoàn tiền', 'Voided bill, refund'], ['Ai huỷ, ai duyệt, lý do', 'Who, approved by, why']],
  ['itemVoids', ['Huỷ món đã báo bếp', 'Dishes taken back'], ['Khi vượt ngưỡng bên dưới', 'Past the limit below']],
  ['bigDiscount', ['Giảm giá lớn', 'Big discount'], ['Từ mức % bên dưới', 'From the % below']],
  ['tableOpen', ['Mở bàn', 'Table opened'], ['Bàn, số khách, ai mở', 'Table, guests, who']],
  ['paid', ['Đã thu tiền', 'Bill paid'], ['Từng bill — nhiều, nên tắt', 'Every bill — many, best off']],
  ['nightly', ['Tóm tắt cuối đêm', 'Night summary'], ['Doanh thu, huỷ, ca chưa chốt', 'Takings, voids, open shift']],
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 46, height: 28, borderRadius: 14, border: 0, padding: 0, background: on ? '#4f46e5' : 'rgba(148,163,184,.45)', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: 11, background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}

export function AlertSettings() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [data, setData] = useState<Resp | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    apiFetch<Resp>('/restaurant/alerts', { token }).then((r) => { setData(r); setS(r.settings); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err && !s) return <div style={{ padding: 16, color: C.bad }}>{err}</div>;
  if (!s || !data) return <div style={{ padding: 24, color: C.muted }}>{L('Đang tải…', 'Loading…')}</div>;

  const set = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setMsg(null); };
  const setAud = (k: Key, who: 'owner' | 'manager', v: boolean) => set({ notify: { ...s.notify, [k]: { ...s.notify[k], [who]: v } } });
  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try { const r = await apiFetch<Settings>('/restaurant/alerts', { method: 'POST', token, body: s }); setS(r); setMsg(L('Đã lưu.', 'Saved.')); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function test() {
    setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ devices: number }>('/restaurant/alerts/test', { method: 'POST', token });
      setMsg(r.devices ? L(`Đã gửi tới ${r.devices} thiết bị của bạn.`, `Sent to ${r.devices} of your devices.`) : L('Bạn chưa bật thông báo trên thiết bị nào — bấm “Bật thông báo” bên dưới trên điện thoại.', 'No device of yours has alerts on — tap “Turn on alerts” below on your phone.'));
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }

  const numInput = (value: number, onChange: (n: number) => void, width = 76, suffix?: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input inputMode="numeric" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '') || 0))}
        style={{ width, height: 38, borderRadius: 10, border: `1px solid ${C.line}`, background: C.page, color: C.ink, textAlign: 'right', padding: '0 10px', font: 'inherit', fontWeight: 700, ...num }} />
      {suffix && <span style={{ color: C.ink2, fontSize: 14, whiteSpace: 'nowrap' }}>{suffix}</span>}
    </span>
  );
  const line = (label: string, control: React.ReactNode, first = false) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 52, borderTop: first ? 0 : `1px solid ${C.line}` }}>
      <span style={{ flex: 1, fontSize: 15, color: C.ink2, ...one }}>{label}</span>{control}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 6 }}>
          <h2 style={{ flex: 1, margin: 0, fontSize: 17, fontWeight: 700, color: C.ink }}>{L('Ai nhận gì', 'Who gets what')}</h2>
          <span style={{ width: 52, textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.muted }}>{L('Chủ', 'Owner')}</span>
          <span style={{ width: 52, textAlign: 'center', fontSize: 13, fontWeight: 700, color: C.muted }}>{L('Q.lý', 'Mgr')}</span>
        </div>
        {ROWS.map(([k, [tv, te], [sv, se]], i) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 60, borderTop: i ? `1px solid ${C.line}` : 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: C.ink, ...one }}>{L(tv, te)}</div>
              <div style={{ fontSize: 13, color: C.muted, ...one }}>{L(sv, se)}</div>
            </div>
            <div style={{ width: 52, display: 'flex', justifyContent: 'center' }}><Toggle on={s.notify[k].owner} onChange={(v) => setAud(k, 'owner', v)} label={`${L(tv, te)} · ${L('Chủ', 'Owner')}`} /></div>
            <div style={{ width: 52, display: 'flex', justifyContent: 'center' }}><Toggle on={s.notify[k].manager} onChange={(v) => setAud(k, 'manager', v)} label={`${L(tv, te)} · ${L('Quản lý', 'Manager')}`} /></div>
          </div>
        ))}
      </Card>

      <Card>
        <H2>{L('Ngưỡng cảnh báo', 'Limits')}</H2>
        {line(L('Huỷ món trong', 'Dishes taken back within'), numInput(s.voidWindowMin, (n) => set({ voidWindowMin: n }), 64, L('phút', 'min')), true)}
        {line(L('… từ số món', '… from this many'), numInput(s.voidItems, (n) => set({ voidItems: n }), 64, L('món', 'dishes')))}
        {line(L('Giảm giá từ', 'Discount from'), numInput(s.discountPct, (n) => set({ discountPct: n }), 64, '%'))}
        {line(L('Lệch két phải ghi lý do từ', 'Drawer off needs a reason from'), numInput(s.varianceCents, (n) => set({ varianceCents: n }), 120))}
        {line(L('Ca mở quá', 'Shift open longer than'), numInput(s.shiftMaxHours, (n) => set({ shiftMaxHours: n }), 64, L('giờ', 'h')))}
        {line(L('Đóng ca cần PIN người kiểm két', 'Closing needs a witness PIN'), <Toggle on={s.witnessOnClose} onChange={(v) => set({ witnessOnClose: v })} label={L('Người kiểm két', 'Witness')} />)}
        <div style={{ fontSize: 12.5, color: C.muted, marginTop: 4 }}>{L(`Lệch két tính theo tiền của tiệm: ${formatPrice(s.varianceCents)}.`, `In the salon’s money: ${formatPrice(s.varianceCents)}.`)}</div>
      </Card>

      <Card>
        <H2>{L('Người nhận', 'Recipients')}</H2>
        {data.people.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 50, borderTop: i ? `1px solid ${C.line}` : 0 }}>
            <span style={{ flex: 1, fontSize: 15, color: C.ink2, ...one }}>{p.kind === 'owner' ? L('Chủ', 'Owner') : L('Quản lý', 'Manager')} · {p.name}</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: p.devices ? C.good : C.warn, ...num }}>{p.devices ? L(`${p.devices} thiết bị ✓`, `${p.devices} device(s) ✓`) : L('Chưa bật thông báo', 'Alerts off')}</span>
          </div>
        ))}
        <div style={{ fontSize: 13, color: C.muted, margin: '8px 0 10px', lineHeight: 1.5 }}>{L('Mỗi người mở Lumio trên điện thoại của mình, đăng nhập bằng tài khoản riêng và bấm “Bật thông báo”. iPhone: thêm Lumio ra màn hình chính trước.', 'Each person opens Lumio on their own phone, signs in with their own login and taps “Turn on alerts”. iPhone: add Lumio to the home screen first.')}</div>
        <PushEnable />
        <button type="button" onClick={() => void test()} style={{ marginTop: 10, width: '100%', height: 46, borderRadius: 14, border: 0, background: 'rgba(99,102,241,.14)', color: C.link, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>{L('Gửi thử một thông báo cho tôi', 'Send me a test alert')}</button>
      </Card>

      {err && <div style={{ color: C.bad, fontSize: 14 }}>{err}</div>}
      {msg && <div style={{ color: C.good, fontSize: 14 }}>{msg}</div>}
      <button type="button" disabled={busy} onClick={() => void save()} style={{ height: 52, borderRadius: 14, border: 0, background: '#4f46e5', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>{busy ? '…' : L('Lưu cài đặt thông báo', 'Save alert settings')}</button>
    </div>
  );
}
