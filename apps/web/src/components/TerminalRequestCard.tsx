'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { BRAND_CHOICES, brandKeyOf, guideFor, type TerminalBrand } from '../lib/terminal-guides';

interface Req { id: string; brand: string; brandKey: TerminalBrand; model: string; serial: string; note: string; status: 'open' | 'sent' | 'done'; reply: string; createdAt: string }

/**
 * "MY MACHINE ISN'T ON THE LIST": the salon sends the brand, model and the
 * serial / device code on the machine, and gets the steps to connect it by
 * itself right away (lib/terminal-guides.ts). Lumio sees the request too.
 */
export function TerminalRequestCard({ token, vi }: { token: string | null; vi: boolean }) {
  const T = (v: string, e: string) => (vi ? v : e);
  const [brand, setBrand] = useState<TerminalBrand>('clover');
  const [other, setOther] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<Req | null>(null);
  const [mine, setMine] = useState<Req[]>([]);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<Req[]>('/payments-hub/terminal-requests', { token }).then(setMine).catch(() => setMine([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const name = brand === 'other' ? other.trim() : (BRAND_CHOICES.find((b) => b.key === brand)?.name ?? brand);
  const key = brand === 'other' ? brandKeyOf(other, model) : brand;
  const guide = guideFor(sent?.brandKey ?? key, vi);

  const submit = async () => {
    if (!name && !model.trim()) { setErr(T('Chọn hoặc nhập hãng máy.', 'Pick or type the brand.')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ item: Req }>('/payments-hub/terminal-requests', { method: 'POST', token, body: { brand: name, model: model.trim(), serial: serial.trim(), note: note.trim() } });
      setSent(r.item); setModel(''); setSerial(''); setNote(''); load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };

  const label: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--c94a3b8)', margin: '10px 0 4px' };
  return (
    <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, padding: 16, marginTop: 14, background: 'var(--c0f172a)' }}>
      <strong style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{T('Máy quẹt thẻ của tiệm không có trong danh sách?', 'Your card machine is not in the list?')}</strong>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
        {T('Gửi tên máy và mã máy (in ở mặt sau / trong Cài đặt của máy). Lumio hiện ngay hướng dẫn để tiệm tự kết nối, và đội Lumio cũng nhận được yêu cầu.',
          'Send the machine\'s name and code (on the back or in its settings). Lumio shows the steps to connect it yourself right away, and the Lumio team gets the request too.')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <div>
          <label style={label}>{T('Hãng máy', 'Brand')}</label>
          <select style={ui.input} value={brand} onChange={(e) => { setBrand(e.target.value as TerminalBrand); setSent(null); }}>
            {BRAND_CHOICES.map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}
          </select>
        </div>
        {brand === 'other' && (
          <div>
            <label style={label}>{T('Tên hãng', 'Brand name')}</label>
            <input style={ui.input} value={other} onChange={(e) => setOther(e.target.value)} placeholder="Valor, Ingenico…" />
          </div>
        )}
        <div>
          <label style={label}>{T('Tên / đời máy', 'Model')}</label>
          <input style={ui.input} value={model} onChange={(e) => setModel(e.target.value)} placeholder={T('VD: Clover Flex, PAX A920', 'e.g. Clover Flex, PAX A920')} />
        </div>
        <div>
          <label style={label}>{T('Mã máy (serial / TPN / device code)', 'Machine code (serial / TPN / device code)')}</label>
          <input style={ui.input} value={serial} onChange={(e) => setSerial(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <label style={label}>{T('Ghi chú (không bắt buộc)', 'Note (optional)')}</label>
      <input style={ui.input} value={note} onChange={(e) => setNote(e.target.value)} placeholder={T('Đơn vị cấp máy, số điện thoại liên hệ…', 'Who supplied it, a phone number…')} />
      {err && <div style={{ ...ui.banner, marginTop: 10 }}>{err}</div>}
      <button onClick={submit} disabled={busy} style={{ ...ui.primaryBtn, marginTop: 12, opacity: busy ? 0.6 : 1 }}>{busy ? '…' : T('Gửi & xem hướng dẫn', 'Send & see the steps')}</button>

      <div style={{ marginTop: 14, background: 'var(--c1e293b)', border: `1px solid ${guide.driven ? '#22c55e' : '#f59e0b'}`, borderRadius: 10, padding: 14 }}>
        {sent && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-good)', marginBottom: 6 }}>✓ {T('Đã gửi cho Lumio. Trong lúc chờ, tiệm làm theo các bước sau:', 'Sent to Lumio. Meanwhile, follow these steps:')}</div>}
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{guide.title}</div>
        <ol style={{ margin: '8px 0 0', paddingLeft: 20, color: 'var(--ccbd5e1)', fontSize: 13, lineHeight: 1.6 }}>
          {guide.steps.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
        </ol>
      </div>

      {mine.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', marginBottom: 6 }}>{T('Yêu cầu đã gửi', 'Your requests')}</div>
          {mine.slice(0, 5).map((r) => (
            <div key={r.id} style={{ fontSize: 13, color: 'var(--ccbd5e1)', padding: '6px 0', borderTop: '1px solid var(--c334155)' }}>
              <b style={{ color: 'var(--ce2e8f0)' }}>{r.brand}{r.model ? ` · ${r.model}` : ''}</b>{r.serial ? ` · ${r.serial}` : ''}
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: r.status === 'done' ? 'var(--ink-good)' : r.status === 'sent' ? 'var(--ink-sky)' : 'var(--ink-warn)' }}>
                {r.status === 'done' ? T('Đã xong', 'Done') : r.status === 'sent' ? T('Lumio đã trả lời', 'Lumio replied') : T('Đang xem', 'Open')}
              </span>
              {r.reply && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 3, whiteSpace: 'pre-line' }}>💬 {r.reply}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
