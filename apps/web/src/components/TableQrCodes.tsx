'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { byTableName, tillError } from '../lib/restaurant-till';

/**
 * One QR code per table: guests scan it to see the menu, order, call a server
 * or ask for the bill (the /t/<token> page). The token is random and unique
 * to that table of this restaurant; "New code" retires a printed one at once
 * (a code that walked off, a prank). Owner only, as on the server.
 */

interface QrRow { id: string; name: string; area: string | null; token: string }

const C = { panel: 'var(--c0f172a)', raised: 'var(--c1e293b)', line: 'var(--line)', border: 'var(--c334155)', text: 'var(--ce2e8f0)', muted: 'var(--c94a3b8)' };
const btn: CSSProperties = { minHeight: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.text, fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const qrImg = (url: string, px: number) => `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=1&data=${encodeURIComponent(url)}`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function TableQrCodes({ token, vi }: { token: string | null; vi: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [rows, setRows] = useState<QrRow[] | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState<string | null>(null);
  const [shop, setShop] = useState('');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const urlOf = (r: QrRow) => `${origin}/t/${r.token}`;

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [codes, s] = await Promise.all([
        apiFetch<QrRow[]>('/restaurant/qr-codes', { token }),
        apiFetch<{ qrOrdering?: string }>('/restaurant/settings', { token }).catch(() => null),
      ]);
      setRows([...codes].sort(byTableName)); setMode(s?.qrOrdering ?? null); setErr('');
    } catch (e) { setErr(tillError(e instanceof Error ? e.message : String(e), vi)); setRows([]); }
  }, [token, vi]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ name?: string }>('/me/tenant', { token }).then((t) => setShop(t?.name ?? '')).catch(() => undefined);
  }, [token]);

  async function reset(r: QrRow) {
    if (sure !== r.id) { setSure(r.id); return; }
    setSure(null);
    try {
      const n = await apiFetch<{ id: string; token: string }>(`/restaurant/tables/${r.id}/qr-reset`, { method: 'POST', token });
      setRows((xs) => (xs ?? []).map((x) => (x.id === r.id ? { ...x, token: n.token } : x)));
    } catch (e) { setErr(tillError(e instanceof Error ? e.message : String(e), vi)); }
  }

  function printAll(list: QrRow[]) {
    const w = window.open('', '_blank');
    if (!w) return;
    const cards = list.map((r) => `<div class="c"><div class="s">${esc(shop)}</div><div class="t">${esc(L('Bàn', 'Table'))} ${esc(r.name)}</div><img src="${esc(qrImg(urlOf(r), 480))}" alt=""><div class="h">${esc(L('Quét để xem thực đơn, gọi món, gọi nhân viên', 'Scan for the menu, to order or call a server'))}</div></div>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR</title><style>
      body{font-family:system-ui,sans-serif;margin:0;padding:12mm;color:#111}
      .g{display:grid;grid-template-columns:repeat(2,1fr);gap:10mm}
      .c{border:1px dashed #999;border-radius:6mm;padding:8mm;text-align:center;break-inside:avoid}
      .s{font-size:12pt;color:#555}.t{font-size:26pt;font-weight:800;margin:2mm 0 4mm}
      img{width:60mm;height:60mm}.h{font-size:11pt;margin-top:4mm}
    </style></head><body><div class="g">${cards}</div><script>window.onload=function(){setTimeout(function(){window.print()},400)}</script></body></html>`);
    w.document.close();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, color: C.text }}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <b>{L('Mã QR gọi món tại bàn', 'Table QR codes')}</b>
        <span style={{ fontSize: 13, color: C.muted }}>{L('In và dán lên từng bàn. Khách quét bằng camera điện thoại: xem thực đơn, gọi món, gọi nhân viên, xin thanh toán. Không cần cài app.', 'Print and stick one on each table. Guests scan with their phone camera to see the menu, order, call a server or ask for the bill. Nothing to install.')}</span>
        {mode === 'off' && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-warn)' }}>{L('Gọi món QR đang TẮT: khách quét sẽ thấy “gọi nhân viên”. Bật ở Thu ngân › Cài đặt nhà hàng.', 'QR ordering is OFF: guests who scan are told to ask a server. Turn it on under Checkout › Restaurant settings.')}</span>}
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" disabled={!rows?.length} onClick={() => printAll(rows ?? [])} style={{ ...btn, border: 'none', background: '#4f46e5', color: '#fff' }}>{L('In tất cả mã QR', 'Print all QR codes')}</button>
          <a href="/salon/pos" style={{ ...btn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{L('Mở thu ngân', 'Open the till')}</a>
        </span>
      </div>
      {err && <div role="alert" style={{ padding: '10px 14px', borderRadius: 12, fontWeight: 700, background: 'var(--c450a0a)', color: 'var(--cfca5a5)' }}>{err}</div>}
      {rows === null && <p style={{ color: C.muted }}>{L('Đang tải…', 'Loading…')}</p>}
      {rows && rows.length === 0 && !err && <p style={{ color: C.muted }}>{L('Chưa có bàn nào đang dùng.', 'No active tables yet.')}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        {(rows ?? []).map((r) => (
          <div key={r.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: 18 }}>{L('Bàn', 'Table')} {r.name}</b>
            {r.area && <span style={{ fontSize: 12, color: C.muted }}>{r.area}</span>}
            <img src={qrImg(urlOf(r), 220)} alt={`QR ${r.name}`} style={{ width: 150, height: 150, background: '#ffffff', borderRadius: 8, padding: 4 }} />
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" onClick={() => printAll([r])} style={btn}>{L('In', 'Print')}</button>
              <a href={urlOf(r)} target="_blank" rel="noreferrer" style={{ ...btn, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{L('Xem thử', 'Preview')}</a>
              <button type="button" onClick={() => void reset(r)} style={{ ...btn, ...(sure === r.id ? { borderColor: '#b91c1c', color: 'var(--ink-bad)' } : {}) }}>{sure === r.id ? L('Chắc chắn? Mã cũ hết dùng', 'Sure? Old code stops') : L('Đổi mã', 'New code')}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
