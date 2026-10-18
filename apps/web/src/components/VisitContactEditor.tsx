'use client';

/**
 * "Actually it's Ngoc, and my new number is…" — the desk corrects who a
 * booking or a checked-in ticket is for. The client's record is corrected
 * with it (or the visit moves to the client that phone belongs to); a
 * checked-in booking and its ticket stay in step.
 */
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { ui } from '../lib/ui';

export interface VisitContact { firstName: string; lastName?: string | null; phone?: string | null; email?: string | null; note?: string | null }

/** "Anna Lee Nguyen" → first "Anna", last "Lee Nguyen" (a ticket keeps one name line). */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') };
}

export function VisitContactEditor({ kind, id, initial, withNote, onSaved, onCancel }: {
  kind: 'walkin' | 'booking'; id: string; initial: VisitContact; withNote?: boolean;
  onSaved: (r: { switched?: boolean; emailSkipped?: boolean }) => void; onCancel: () => void;
}) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [f, setF] = useState({
    firstName: initial.firstName ?? '', lastName: initial.lastName ?? '', phone: initial.phone ?? '',
    email: initial.email ?? '', birthDate: '', note: initial.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const up = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.firstName.trim()) { setErr(vi ? 'Cần có tên khách' : 'A name is required'); return; }
    setBusy(true); setErr(null);
    try {
      const body: Record<string, string> = { firstName: f.firstName.trim(), lastName: f.lastName.trim() };
      if (f.phone.trim()) body.phone = f.phone.trim();
      if (f.email.trim()) body.email = f.email.trim();
      if (f.birthDate) body.birthDate = f.birthDate;
      if (withNote) body.note = f.note;
      const path = kind === 'walkin' ? `/walkins/${id}/contact` : `/bookings/${id}/contact`;
      const r = await apiFetch<{ switched?: boolean; emailSkipped?: boolean; contact?: { switched?: boolean; emailSkipped?: boolean } }>(path, { method: 'PATCH', token, body });
      onSaved(r?.contact ?? { switched: r?.switched, emailSkipped: r?.emailSkipped });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Error');
    } finally { setBusy(false); }
  };

  const label = (t: string) => <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>{t}</span>;
  return (
    <div style={{ border: '1px solid var(--line-strong)', borderRadius: 12, padding: 12, margin: '0 0 12px', background: 'var(--raised)' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--ce2e8f0)', marginBottom: 8 }}>✎ {vi ? 'Sửa thông tin khách' : 'Edit client details'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <label>{label(vi ? 'Tên *' : 'First name *')}<input value={f.firstName} maxLength={80} onChange={(e) => up('firstName', e.target.value)} style={ui.input} /></label>
        <label>{label(vi ? 'Họ' : 'Last name')}<input value={f.lastName} maxLength={80} onChange={(e) => up('lastName', e.target.value)} style={ui.input} /></label>
        <label>{label(vi ? 'Số điện thoại' : 'Phone')}<input value={f.phone} maxLength={40} inputMode="tel" onChange={(e) => up('phone', e.target.value)} style={ui.input} /></label>
        <label>{label('Email')}<input value={f.email} maxLength={160} inputMode="email" onChange={(e) => up('email', e.target.value)} placeholder={vi ? 'để trống = giữ nguyên' : 'blank = unchanged'} style={ui.input} /></label>
        <label>{label(vi ? 'Ngày sinh' : 'Birthday')}<input type="date" value={f.birthDate} onChange={(e) => up('birthDate', e.target.value)} style={ui.input} /></label>
      </div>
      {withNote && (
        <label style={{ display: 'block', marginTop: 8 }}>{label(vi ? 'Ghi chú' : 'Note')}
          <input value={f.note} maxLength={300} onChange={(e) => up('note', e.target.value)} style={ui.input} />
        </label>
      )}
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 8, lineHeight: 1.45 }}>
        {vi
          ? 'Hồ sơ khách được sửa theo. Nếu SĐT mới đã là của một khách khác trong tiệm, lượt này sẽ chuyển sang hồ sơ khách đó.'
          : 'The client record is corrected too. If the new phone already belongs to another of your clients, this visit moves to that client.'}
      </div>
      {err && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-bad)' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--ce2e8f0)' }}>{vi ? 'Huỷ' : 'Cancel'}</button>
        <button type="button" disabled={busy} onClick={save} style={{ ...ui.primaryBtn, opacity: busy ? 0.7 : 1 }}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu' : 'Save')}</button>
      </div>
    </div>
  );
}
