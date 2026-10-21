'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useCan } from '../lib/auth';

/**
 * Fix a client's details where they are being used — the booking form, the
 * till, a bill — instead of leaving for the Customers page.
 *
 * Saves to this salon's client record (PATCH /customers/:id, tenant-scoped on
 * the server). Bills already paid keep the name they were paid under; the
 * bookings and bills to come read the new details. A phone number that
 * already belongs to another of this salon's clients is pointed out before
 * saving, so the desk does not quietly make two profiles one number.
 */

export interface EditableCustomer {
  id: string; firstName: string; lastName: string | null; phone: string | null; email: string | null;
  birthDate?: string | null; notes?: string | null;
}

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

export function CustomerEditForm({ token, vi, customer, onSaved, onCancel }: {
  token: string | null; vi: boolean; customer: EditableCustomer;
  onSaved: (c: EditableCustomer) => void; onCancel: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [f, setF] = useState({
    firstName: customer.firstName ?? '', lastName: customer.lastName ?? '', phone: customer.phone ?? '', email: customer.email ?? '',
    birthDate: customer.birthDate ? String(customer.birthDate).slice(0, 10) : '', notes: customer.notes ?? '',
  });
  const [loaded, setLoaded] = useState(customer.birthDate !== undefined && customer.notes !== undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);
  const [merged, setMerged] = useState<string | null>(null);
  // Merging removes a profile: the same permission as deleting a client.
  const canMerge = useCan()('customers.delete');

  /** The twin's history (bookings, bills, points…) moves here and the twin is removed. */
  async function mergeTwin() {
    if (!twin || !token) return;
    if (!confirm(L(`Gộp hồ sơ "${twin.name}" vào hồ sơ này? Lịch hẹn, bill, điểm thưởng của hồ sơ kia chuyển sang đây và hồ sơ kia bị xoá.`,
      `Merge "${twin.name}" into this profile? Its bookings, bills and points move here and that profile is removed.`))) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/customers/${customer.id}/merge`, { method: 'POST', token, body: { fromId: twin.id } });
      setMerged(twin.name); setTwin(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  // The picker's row carries no birthday or note: read the record once.
  useEffect(() => {
    if (loaded || !token) return;
    let alive = true;
    apiFetch<EditableCustomer>(`/customers/${customer.id}`, { token })
      .then((c) => { if (!alive || !c) return; setF((v) => ({ ...v, birthDate: c.birthDate ? String(c.birthDate).slice(0, 10) : '', notes: c.notes ?? '' })); setLoaded(true); })
      .catch(() => setLoaded(true));
    return () => { alive = false; };
  }, [customer.id, token, loaded]);

  // Another client of this salon already on that number?
  useEffect(() => {
    const d = digits(f.phone);
    if (!token || d.length < 7 || d === digits(customer.phone)) { setTwin(null); return; }
    const t = window.setTimeout(() => {
      apiFetch<EditableCustomer[]>(`/customers/search?q=${encodeURIComponent(d)}`, { token })
        .then((rows) => {
          const hit = (rows ?? []).find((r) => r.id !== customer.id && digits(r.phone).slice(-9) === d.slice(-9));
          setTwin(hit ? { id: hit.id, name: `${hit.firstName} ${hit.lastName ?? ''}`.trim() } : null);
        })
        .catch(() => setTwin(null));
    }, 400);
    return () => window.clearTimeout(t);
  }, [f.phone, token, customer.id, customer.phone]);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const ok = f.firstName.trim().length > 0;

  async function save() {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const body = {
        firstName: f.firstName.trim(), lastName: f.lastName.trim() || null, phone: f.phone.trim() || null,
        email: f.email.trim() || null, birthDate: f.birthDate || null, notes: f.notes.trim() || null,
      };
      const saved = await apiFetch<EditableCustomer>(`/customers/${customer.id}`, { method: 'PATCH', token, body });
      onSaved({ ...customer, ...body, ...(saved ?? {}) });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <div style={{ padding: '12px 14px', borderRadius: 12, border: '1.5px solid rgba(59,130,246,.45)', background: 'var(--wash-blue)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Sửa thông tin khách', 'Edit client details')}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Lưu vào hồ sơ khách của tiệm', 'Saved to the salon’s client record')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <label><span style={ui.label}>{L('Tên', 'First name')}<span style={{ color: 'var(--ink-bad)' }}> *</span></span>
          <input style={ui.input} value={f.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={80} autoFocus /></label>
        <label><span style={ui.label}>{L('Họ', 'Last name')}</span>
          <input style={ui.input} value={f.lastName} onChange={(e) => set('lastName', e.target.value)} maxLength={80} /></label>
        <label><span style={ui.label}>{L('SĐT', 'Phone')}</span>
          <input style={ui.input} value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" maxLength={40} /></label>
        <label><span style={ui.label}>Email</span>
          <input style={ui.input} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label><span style={ui.label}>{L('Ngày sinh', 'Birthday')}</span>
          <input style={ui.input} type="date" lang="en-US" max={new Date().toISOString().slice(0, 10)} value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></label>
      </div>
      <label><span style={ui.label}>{L('Ghi chú / dị ứng', 'Notes / allergies')}</span>
        <input style={ui.input} value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={2000} placeholder={L('vd: dị ứng acetone', 'e.g. allergic to acetone')} /></label>
      {twin && (
        <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 10, background: 'var(--wash-amber)', color: 'var(--ink-warn)' }}>
          ⚠ {L('Số này đang thuộc hồ sơ', 'This number already belongs to')} <b>{twin.name}</b>. <Link href={`/salon/customers/${twin.id}`} style={{ color: 'var(--ink-link)', fontWeight: 700 }}>{L('Mở hồ sơ đó', 'Open that profile')} ↗</Link>
          {canMerge && <>{' · '}<button type="button" disabled={busy} onClick={() => void mergeTwin()} style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--ink-link)', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>{L('Gộp vào hồ sơ này', 'Merge into this one')}</button></>}
        </div>
      )}
      {merged && <div style={{ fontSize: 12.5, color: 'var(--ink-good)' }}>✓ {L(`Đã gộp "${merged}" vào hồ sơ này.`, `"${merged}" merged into this profile.`)}</div>}
      {err && <div style={ui.banner}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ height: 34, padding: '0 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{L('Thôi', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} onClick={() => void save()} style={{ ...ui.primaryBtn, background: '#2563eb', padding: '0 16px', height: 34, opacity: ok ? 1 : 0.5 }}>{busy ? '…' : L('Lưu', 'Save')}</button>
      </div>
    </div>
  );
}
