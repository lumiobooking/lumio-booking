'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

/**
 * ONE BOX INSTEAD OF FIVE: who is this booking for?
 *
 * The form used to open on five empty fields for everyone — the twelve-visit
 * regular and the first-timer alike — and the desk retyped a name it had
 * typed eleven times before. Now there is one box, "name or phone". Two
 * letters in, the salon's own customers appear with what the desk needs to
 * recognise her (visits, last visit, who did it, no-shows); picking one fills
 * everything and tells the form what she had last time. Nobody matching → one
 * tap makes a new customer with three short fields. The two states are told
 * apart by colour: green = known, blue = new.
 *
 * Reads GET /customers/lookup — this salon's customers only (the API scopes).
 */

export interface PickedCustomer {
  /** A customer on file, or null for a new one. */
  id: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  birthDate: string;
}
export const EMPTY_CUSTOMER: PickedCustomer = { id: null, firstName: '', lastName: '', phone: '', email: '', birthDate: '' };

export interface CustomerHistoryView {
  visits: number;
  noShows: number;
  upcomingAt: string | null;
  last: { at: string; services: { id: string; name: string }[]; staff: { id: string; name: string } | null } | null;
  favoriteStaff: { id: string; name: string } | null;
  topServices: { id: string; name: string; n: number }[];
}
export interface CustomerLookupRow {
  id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null;
  loyaltyPoints?: number; notes?: string | null; birthDate?: string | null; since?: string | null;
  history: CustomerHistoryView;
}

type Mode = 'search' | 'picked' | 'new';

export function CustomerPicker({ token, vi, value, onChange, allowAnonymous = false, autoFocus = false }: {
  token: string;
  vi: boolean;
  value: PickedCustomer;
  /** The fields to book with, plus the record picked (null for a new or anonymous customer). */
  onChange: (v: PickedCustomer, row: CustomerLookupRow | null) => void;
  /** Walk-ins: a blank name is a passer-by, not an error. */
  allowAnonymous?: boolean;
  autoFocus?: boolean;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [mode, setMode] = useState<Mode>(value.id ? 'picked' : (value.firstName || value.phone) ? 'new' : 'search');
  const [row, setRow] = useState<CustomerLookupRow | null>(null);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CustomerLookupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Type-ahead, 250 ms after the last key; two characters or a phone fragment.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    let live = true;
    const h = window.setTimeout(async () => {
      setBusy(true);
      try {
        const r = await apiFetch<CustomerLookupRow[]>(`/customers/lookup?q=${encodeURIComponent(term)}`, { token });
        if (live) { setRows(Array.isArray(r) ? r : []); setHi(0); }
      } catch { if (live) setRows([]); }
      finally { if (live) setBusy(false); }
    }, 250);
    return () => { live = false; window.clearTimeout(h); };
  }, [q, token]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pick = (r: CustomerLookupRow) => {
    setRow(r); setMode('picked'); setOpen(false); setQ('');
    onChange({ id: r.id, firstName: r.firstName, lastName: r.lastName ?? '', phone: r.phone ?? '', email: r.email ?? '', birthDate: r.birthDate ? String(r.birthDate).slice(0, 10) : '' }, r);
  };
  const startNew = () => {
    const term = q.trim();
    const digits = term.replace(/[^\d+]/g, '');
    const isPhone = digits.length >= 6 && digits.length >= term.length - 3;
    const [first, ...rest] = isPhone ? [''] : term.split(/\s+/);
    setRow(null); setMode('new'); setOpen(false); setQ('');
    onChange({ ...EMPTY_CUSTOMER, firstName: first ?? '', lastName: rest.join(' '), phone: isPhone ? term : '' }, null);
  };
  const reset = () => { setRow(null); setMode('search'); setQ(''); onChange(EMPTY_CUSTOMER, null); };
  const set = (k: keyof PickedCustomer, v: string) => onChange({ ...value, [k]: v }, null);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = rows.length + (q.trim() ? 1 : 0);
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((i) => Math.min(n - 1, i + 1)); setOpen(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi < rows.length) pick(rows[hi]); else if (q.trim()) startNew();
    } else if (e.key === 'Escape') setOpen(false);
  };

  if (mode === 'picked' && row) {
    const h = row.history;
    const lastAt = h.last ? relDay(h.last.at, vi) : null;
    const risky = h.noShows >= 2 || (h.noShows >= 1 && h.visits <= 1);
    return (
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 14px', borderRadius: 12, border: `1.5px solid ${risky ? 'rgba(245,158,11,.55)' : 'rgba(34,197,94,.45)'}`, background: risky ? 'var(--wash-amber)' : 'rgba(34,197,94,.08)' }}>
        <Avatar name={`${row.firstName} ${row.lastName ?? ''}`} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{row.firstName} {row.lastName ?? ''}</span>
            <Tag tone="good">{h.visits > 0 ? L(`Khách cũ · ${h.visits} lần`, `Returning · ${h.visits} visits`) : L('Có trong hệ thống', 'On file')}</Tag>
            {h.noShows > 0 && <Tag tone={risky ? 'warn' : 'muted'}>{L(`không đến ${h.noShows} lần`, `${h.noShows} no-show${h.noShows > 1 ? 's' : ''}`)}</Tag>}
            {(row.loyaltyPoints ?? 0) >= 100 && <Tag tone="muted">★ {row.loyaltyPoints} {L('điểm', 'pts')}</Tag>}
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 5, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
            {row.phone && <span>📞 <b style={{ color: 'var(--ccbd5e1)', fontWeight: 600 }}>{row.phone}</b></span>}
            {lastAt && <span>{L('lần cuối', 'last')} <b style={{ color: 'var(--ccbd5e1)', fontWeight: 600 }}>{lastAt}</b></span>}
            {h.favoriteStaff && <span>{L('thợ quen', 'usual tech')} <b style={{ color: 'var(--ccbd5e1)', fontWeight: 600 }}>{h.favoriteStaff.name}</b></span>}
            {h.upcomingAt && <span style={{ color: 'var(--ink-warn)' }}>⏳ {L('đã có lịch', 'already booked')} {relDay(h.upcomingAt, vi)}</span>}
          </div>
          {(h.last?.services.length || row.notes) ? (
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {h.last?.services.length ? <>{L('Lần trước', 'Last time')}: <b style={{ color: 'var(--ccbd5e1)', fontWeight: 600 }}>{h.last.services.map((s) => s.name).join(' + ')}</b>{h.last.staff ? ` · ${h.last.staff.name}` : ''}</> : null}
              {row.notes ? <span> · {L('Ghi chú', 'Note')}: {row.notes}</span> : null}
            </div>
          ) : null}
        </div>
        <button type="button" onClick={reset} style={ghost}>{L('Đổi', 'Change')}</button>
      </div>
    );
  }

  if (mode === 'new') {
    return (
      <div style={{ padding: '12px 14px', borderRadius: 12, border: '1.5px solid rgba(59,130,246,.45)', background: 'var(--wash-blue)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{allowAnonymous ? L('Khách mới / vãng lai', 'New or walk-in') : L('Khách mới', 'New customer')}</span>
          <Tag tone="blue">{L('chưa có trong hệ thống', 'not on file')}</Tag>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{allowAnonymous ? L('để trống tên = khách vãng lai', 'blank name = passer-by') : L('tên + SĐT là đủ, còn lại điền sau', 'name + phone is enough')}</span>
          <button type="button" onClick={reset} style={ghost}>{L('Tìm lại', 'Search')}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label><span style={ui.label}>{L('Tên', 'First name')}{!allowAnonymous && <span style={{ color: 'var(--ink-bad)' }}> *</span>}</span>
            <input style={ui.input} value={value.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder={allowAnonymous ? L('Tên / Walk-in', 'Name / Walk-in') : 'Anna'} autoFocus={autoFocus} required={!allowAnonymous} /></label>
          <label><span style={ui.label}>{L('Họ', 'Last name')}</span>
            <input style={ui.input} value={value.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Nguyen" /></label>
          <label><span style={ui.label}>{L('SĐT', 'Phone')}</span>
            <input style={ui.input} value={value.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+1 512 886 8189" inputMode="tel" /></label>
        </div>
        {more ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
            <label><span style={ui.label}>Email</span><input style={ui.input} type="email" value={value.email} onChange={(e) => set('email', e.target.value)} placeholder="anna@email.com" /></label>
            <label><span style={ui.label}>{L('Ngày sinh', 'Birthday')}</span><input style={ui.input} type="date" max={new Date().toISOString().slice(0, 10)} value={value.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
          </div>
        ) : (
          <button type="button" onClick={() => setMore(true)} style={{ ...link, marginTop: 8 }}>+ {L('Email, ngày sinh (tuỳ chọn)', 'Email, birthday (optional)')}</button>
        )}
      </div>
    );
  }

  const term = q.trim();
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--c64748b)', fontSize: 15, pointerEvents: 'none' }}>🔍</span>
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={L('Tên hoặc số điện thoại…', 'Name or phone…')}
          aria-label={L('Tìm khách', 'Find customer')}
          style={{ ...ui.input, height: 44, paddingLeft: 36, fontSize: 15 }}
        />
        {busy && <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--c64748b)' }}>…</span>}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 12, color: 'var(--c64748b)', flexWrap: 'wrap' }}>
        <span>{L('Gõ 2 ký tự để tìm khách cũ', 'Type 2 letters to find a returning customer')}</span>
        <button type="button" onClick={startNew} style={link}>+ {allowAnonymous ? L('Khách mới / vãng lai', 'New or walk-in') : L('Khách mới', 'New customer')}</button>
      </div>
      {open && term.length >= 2 && (
        <div style={{ position: 'absolute', zIndex: 40, top: 48, left: 0, right: 0, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.35)', padding: 6, maxHeight: 360, overflowY: 'auto' }}>
          {rows.map((r, i) => {
            const h = r.history;
            const on = i === hi;
            return (
              <button key={r.id} type="button" onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setHi(i)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 9, border: 0, cursor: 'pointer', background: on ? 'var(--c1e293b)' : 'transparent', fontFamily: 'inherit' }}>
                <Avatar name={`${r.firstName} ${r.lastName ?? ''}`} size={32} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.firstName} {r.lastName ?? ''}{r.phone ? <span style={{ fontWeight: 500, color: 'var(--c94a3b8)' }}> · {r.phone}</span> : null}
                  </span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {h.visits > 0
                      ? <>{h.visits} {L('lần', 'visits')}{h.last ? ` · ${L('lần cuối', 'last')} ${relDay(h.last.at, vi)}${h.last.services[0] ? ` · ${h.last.services[0].name}` : ''}${h.last.staff ? ` · ${h.last.staff.name}` : ''}` : ''}</>
                      : L('chưa có lần làm nào', 'no visits yet')}
                    {h.noShows > 0 && <span style={{ color: 'var(--ink-warn)' }}> · {L(`không đến ${h.noShows} lần`, `${h.noShows} no-show`)}</span>}
                  </span>
                </span>
                <Tag tone={h.visits > 0 ? 'good' : 'muted'}>{h.visits > 0 ? L('Khách cũ', 'Returning') : L('Có hồ sơ', 'On file')}</Tag>
              </button>
            );
          })}
          {!busy && rows.length === 0 && <div style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--c64748b)' }}>{L('Không có khách cũ nào khớp.', 'No returning customer matches.')}</div>}
          <div style={{ height: 1, background: 'var(--c334155)', margin: '4px 0' }} />
          <button type="button" onMouseDown={(e) => { e.preventDefault(); startNew(); }} onMouseEnter={() => setHi(rows.length)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 9, border: 0, cursor: 'pointer', background: hi === rows.length ? 'var(--wash-blue)' : 'transparent', fontFamily: 'inherit' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#2563eb', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, flexShrink: 0 }}>+</span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--ink-link)' }}>{L(`Tạo khách mới “${term}”`, `New customer “${term}”`)}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{L('không trùng ai — chỉ cần thêm số điện thoại', 'no match — just add a phone number')}</span>
            </span>
            <Tag tone="blue">{L('Khách mới', 'New')}</Tag>
          </button>
        </div>
      )}
    </div>
  );
}

/** "hôm nay", "hôm qua", "3 ngày trước", "2 tuần trước", else the date. */
export function relDay(iso: string, vi: boolean): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.round((t - Date.now()) / 86_400_000);
  const d = Math.abs(days);
  const fut = days > 0;
  if (d === 0) return vi ? 'hôm nay' : 'today';
  if (d === 1) return fut ? (vi ? 'ngày mai' : 'tomorrow') : (vi ? 'hôm qua' : 'yesterday');
  if (d < 14) return vi ? `${d} ngày ${fut ? 'nữa' : 'trước'}` : `${fut ? 'in ' : ''}${d} days${fut ? '' : ' ago'}`;
  if (d < 60) return vi ? `${Math.round(d / 7)} tuần ${fut ? 'nữa' : 'trước'}` : `${fut ? 'in ' : ''}${Math.round(d / 7)} weeks${fut ? '' : ' ago'}`;
  if (d < 365) return vi ? `${Math.round(d / 30)} tháng ${fut ? 'nữa' : 'trước'}` : `${fut ? 'in ' : ''}${Math.round(d / 30)} months${fut ? '' : ' ago'}`;
  return new Date(t).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

const AV = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const clean = name.trim();
  let h = 0;
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0;
  const ini = clean.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: AV[h % AV.length], color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.round(size * 0.36), fontWeight: 800, flexShrink: 0 }}>{ini}</span>
  );
}

function Tag({ tone, children }: { tone: 'good' | 'warn' | 'blue' | 'muted'; children: React.ReactNode }) {
  const look = tone === 'good' ? { bg: 'rgba(34,197,94,.16)', ink: 'var(--ink-good)' }
    : tone === 'warn' ? { bg: 'var(--wash-amber-3)', ink: 'var(--ink-warn)' }
    : tone === 'blue' ? { bg: 'var(--wash-blue)', ink: 'var(--ink-sky)' }
    : { bg: 'var(--c1e293b)', ink: 'var(--c94a3b8)' };
  return <span style={{ display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: look.bg, color: look.ink, whiteSpace: 'nowrap' }}>{children}</span>;
}

const ghost: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 };
const link: React.CSSProperties = { border: 0, background: 'transparent', color: 'var(--ink-link)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
