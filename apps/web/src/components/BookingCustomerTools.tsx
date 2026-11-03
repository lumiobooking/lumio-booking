'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { CustomerPicker, EMPTY_CUSTOMER, type CustomerLookupRow, type PickedCustomer } from './CustomerPicker';

/**
 * The booking drawer's client tools (3 Nov 2026, from the owner's old system):
 *
 *  - CustomerNoteBox — the CLIENT's own note, kept on her record and shown on
 *    every visit ("8-9-10 3D, curl C, wispy 13", "allergic to acetone"). Not
 *    the booking's note, which is about this one visit. Read and saved through
 *    /customers/:id, so only people allowed to see clients (the owner, the
 *    desk) see it — a technician's app never loads it.
 *  - SwitchCustomer — "Tìm khách": the booking is for someone else on file, or
 *    for a new client. PATCH /bookings/:id/customer (this salon's clients only).
 */

export function CustomerNoteBox({ token, customerId, vi }: { token: string; customerId: string; vi: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [note, setNote] = useState<string | null | undefined>(undefined); // undefined = loading / not allowed
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setNote(undefined); setEditing(false); setErr(null);
    apiFetch<{ notes?: string | null }>(`/customers/${customerId}`, { token })
      .then((c) => { if (live) setNote(c?.notes ?? null); })
      .catch(() => { if (live) setNote(undefined); }); // no right to clients → nothing shown
    return () => { live = false; };
  }, [token, customerId]);

  if (note === undefined) return null;

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const saved = await apiFetch<{ notes?: string | null }>(`/customers/${customerId}`, { method: 'PATCH', token, body: { notes: draft.trim() || null } });
      setNote(saved?.notes ?? (draft.trim() || null));
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : L('Không lưu được', 'Could not save'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ margin: '10px 0 4px', padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(245,158,11,0.45)', background: 'var(--wash-amber)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--ink-warn)' }}>📝 {L('Ghi chú về khách', 'Client note')} <span style={{ fontWeight: 500, opacity: 0.85 }}>· {L('chỉ salon thấy', 'only the salon sees this')}</span></span>
        {!editing && (
          <button type="button" onClick={() => { setDraft(note ?? ''); setEditing(true); }}
            style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, padding: '3px 8px', cursor: 'pointer' }}>
            {note ? `✎ ${L('Sửa', 'Edit')}` : `+ ${L('Thêm', 'Add')}`}
          </button>
        )}
      </div>
      {editing ? (
        <>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={2000} rows={3} autoFocus
            placeholder={L('vd: 8-9-10 3D, curl C, wispy 13 · dị ứng keo · thích thợ Amy', 'e.g. 8-9-10 3D, curl C, wispy 13 · glue allergy · prefers Amy')}
            style={{ ...ui.input, width: '100%', boxSizing: 'border-box', marginTop: 8, resize: 'vertical', fontFamily: 'inherit' }} />
          {err && <div style={{ color: 'var(--ink-bad)', fontSize: 12.5, marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" onClick={save} disabled={busy} style={{ ...ui.primaryBtn, padding: '7px 14px', opacity: busy ? 0.6 : 1 }}>{busy ? '…' : L('Lưu ghi chú', 'Save note')}</button>
            <button type="button" onClick={() => setEditing(false)} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
          </div>
        </>
      ) : (
        <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.5, color: note ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {note || L('Chưa có ghi chú. Ghi lại mapping mi, màu sơn quen, dị ứng… để lần sau ai cũng biết.', 'No note yet. Keep her lash map, usual colour, allergies… so everyone knows next time.')}
        </div>
      )}
    </div>
  );
}

export function SwitchCustomer({ token, bookingId, vi, onDone, onCancel }: {
  token: string; bookingId: string; vi: boolean;
  onDone: (r: { changed: boolean }) => void;
  onCancel: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [value, setValue] = useState<PickedCustomer>(EMPTY_CUSTOMER);
  const [row, setRow] = useState<CustomerLookupRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = !!row || (!!value.firstName.trim() && (!!value.phone.trim() || !!value.email.trim()));

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const body = row
        ? { customerId: row.id }
        : { firstName: value.firstName.trim(), lastName: value.lastName.trim() || undefined, phone: value.phone.trim() || undefined, email: value.email.trim() || undefined };
      const r = await apiFetch<{ changed: boolean }>(`/bookings/${bookingId}/customer`, { method: 'PATCH', token, body });
      onDone({ changed: !!r?.changed });
    } catch (e) {
      setErr(e instanceof Error ? e.message : L('Không đổi được khách', 'Could not change the client'));
    } finally { setBusy(false); }
  };

  return (
    <div style={{ margin: '8px 0 12px', padding: 12, borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 8 }}>🔍 {L('Lịch này của khách khác? Tìm hoặc tạo khách mới', 'Booking for someone else? Find a client or add a new one')}</div>
      <CustomerPicker token={token} vi={vi} value={value} autoFocus onChange={(v, r) => { setValue(v); setRow(r); }} />
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={save} disabled={!ready || busy} style={{ ...ui.primaryBtn, padding: '8px 14px', opacity: !ready || busy ? 0.55 : 1 }}>
          {busy ? '…' : row ? L('Chuyển lịch sang khách này', 'Move booking to this client') : L('Tạo khách mới cho lịch này', 'Create client for this booking')}
        </button>
        <button type="button" onClick={onCancel} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer' }}>{L('Huỷ', 'Cancel')}</button>
      </div>
    </div>
  );
}
