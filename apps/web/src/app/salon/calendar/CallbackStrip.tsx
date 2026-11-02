'use client';

/**
 * "Cần gọi lại" on the Calendar: every call back the AI promised (hotline,
 * chat) shows here for the desk — who, which number, what they wanted — with
 * a Call button and "Đã gọi". Before, it was only on the AI page, where the
 * desk never looks. A push notification opens the Calendar with this list open
 * (?callbacks=1).
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { fmtPhone } from '../../../lib/cal-card';

export interface DeskCallback {
  id: string; channel: string; reason: string; summary: string; phone: string | null; name: string | null;
  createdAt: string; dueAt: string | null; label: { vi: string; en: string } | null;
}

const CHANNEL: Record<string, string> = { voice: '📞', messenger: '💬', instagram: '💬', zalo: '💬', web: '💬' };

export function agoText(iso: string, now: number, vi: boolean): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return vi ? 'vừa xong' : 'just now';
  if (m < 60) return vi ? `${m} phút trước` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return vi ? `${h} giờ trước` : `${h} h ago`;
  const d = Math.round(h / 24);
  return vi ? `${d} ngày trước` : `${d} d ago`;
}

/** The line the desk reads: what the caller wanted, without the "Caller:/AI:" labels doubling up. */
export function callbackText(c: Pick<DeskCallback, 'summary' | 'label'>, vi: boolean): string {
  const s = String(c.summary ?? '').trim();
  if (s) return s;
  return c.label ? (vi ? c.label.vi : c.label.en) : (vi ? 'Khách cần được gọi lại' : 'Needs a call back');
}

export function CallbackStrip({ token, vi, isMobile }: { token: string | null; vi: boolean; isMobile: boolean }) {
  const [list, setList] = useState<DeskCallback[]>([]);
  const [open, setOpen] = useState(() => { try { return new URLSearchParams(window.location.search).get('callbacks') === '1'; } catch { return false; } });
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!token) return;
    try { setList(await apiFetch<DeskCallback[]>('/calendar-callbacks', { token })); setNow(Date.now()); } catch { /* no calendar right: nothing shown */ }
  }, [token]);
  useEffect(() => {
    void load();
    const iv = window.setInterval(() => { void load(); }, 60_000);
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const done = async (id: string) => {
    setBusy(id);
    try { await apiFetch(`/calendar-callbacks/${id}/done`, { method: 'PATCH', token }); setList((l) => l.filter((x) => x.id !== id)); } catch { /* stays in the list */ } finally { setBusy(null); }
  };

  if (!list.length) return null;
  const n = list.length;
  return (
    <div style={{ marginBottom: 12, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--wash-amber)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: '100%', minHeight: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
        <span aria-hidden="true" style={{ fontSize: 18 }}>📞</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: 'var(--ink-warn)' }}>
          {vi ? `${n} khách cần gọi lại` : `${n} ${n === 1 ? 'client needs' : 'clients need'} a call back`}
          <span style={{ fontWeight: 500, color: 'var(--c94a3b8)' }}> · {vi ? 'AI đã hẹn nhân viên gọi lại' : 'the AI promised a call back'}</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-link)', whiteSpace: 'nowrap' }}>{open ? (vi ? 'Thu gọn' : 'Hide') : (vi ? 'Xem' : 'Show')}</span>
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 8, padding: '0 10px 10px', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {list.map((c) => {
            const who = c.name || (c.phone ? fmtPhone(c.phone) : (vi ? 'Khách' : 'Client'));
            return (
              <div key={c.id} style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span aria-hidden="true">{CHANNEL[c.channel] ?? '📞'}</span>
                  <strong style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{who}</strong>
                  <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{agoText(c.createdAt, now, vi)}</span>
                </div>
                {c.name && c.phone && <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{fmtPhone(c.phone)}</span>}
                <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--ce2e8f0)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{callbackText(c, vi)}</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} style={{ flex: 1, minHeight: 40, borderRadius: 8, background: '#4f46e5', color: '#fff', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }}>
                      📞 {vi ? 'Gọi' : 'Call'}
                    </a>
                  )}
                  <button type="button" disabled={busy === c.id} onClick={() => { void done(c.id); }}
                    style={{ flex: 1, minHeight: 40, borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: busy === c.id ? 0.6 : 1 }}>
                    ✓ {vi ? 'Đã gọi xong' : 'Done'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
