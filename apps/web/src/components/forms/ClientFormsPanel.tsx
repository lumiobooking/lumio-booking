'use client';

/**
 * The forms box on a ticket, a booking or a client's profile (massage / spa
 * salons only — everywhere else it draws nothing).
 *
 *   ✓ / missing / expired per form · the client's "yes" cautions (owner,
 *   manager, the client's own technician) · sign on this device · text the
 *   link · copy the link · the SOAP note · the signed history.
 *
 * The front desk sees which forms are signed, never what is in them — the
 * API decides that, this only draws what it is sent.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { useLang } from '../../lib/i18n';
import { kindLabel, type CustomerForms, type FormNeed, type VisitForms } from '../../lib/client-forms';
import { EntryViewer, FormModal, SoapSheet } from './FormModal';
import { SignFlow } from './SignFlow';

const PAPER_GROUND = '#f5f3ef';

export function ClientFormsPanel({ appointmentId, walkInId, customerId }: {
  appointmentId?: string | null; walkInId?: string | null; customerId?: string | null;
  /** Kept for callers; signing on this device now happens in a popup, so nothing navigates away. */
  returnTo?: string;
}) {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const visitMode = !!(appointmentId || walkInId);
  const [visit, setVisit] = useState<VisitForms | null>(null);
  const [file, setFile] = useState<CustomerForms | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // The technician's record being written: the SOAP note or one of the salon's own forms.
  const [note, setNote] = useState<{ kind: string; title?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // "Sign on this device": the client signs in a popup over this screen.
  const [signing, setSigning] = useState<string | null>(null);
  // Why the box could not load. Shown on the visit instead of hiding the box,
  // so "no Forms on this client" always comes with its cause.
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    if (visitMode) {
      const q = appointmentId ? `appointmentId=${encodeURIComponent(appointmentId)}` : `walkInId=${encodeURIComponent(walkInId as string)}`;
      apiFetch<VisitForms>(`/client-forms/visit?${q}&lang=${vi ? 'vi' : 'en'}`, { token })
        .then((v) => { setVisit(v); setLoadErr(null); })
        .catch((e) => { setVisit({ enabled: false }); setLoadErr(e instanceof Error ? e.message : String(e)); });
    } else if (customerId) {
      apiFetch<CustomerForms>(`/client-forms/customers/${customerId}?lang=${vi ? 'vi' : 'en'}`, { token }).then(setFile).catch(() => setFile(null));
    }
  }, [token, visitMode, appointmentId, walkInId, customerId, vi]);

  useEffect(() => { load(); }, [load, tick]);
  // Signed in the popup: show ✓ at once (the popup stays on its thank-you card).
  const onSigned = useCallback(() => setTick((x) => x + 1), []);

  const enabled = visitMode ? !!visit?.enabled : !!file?.enabled;
  const needs: FormNeed[] = (visitMode ? visit?.needs : file?.needs) ?? [];
  const flags = (visitMode ? visit?.flags : file?.flags) ?? [];
  const notes = visitMode ? visit?.notes ?? [] : [];
  const access = (visitMode ? visit?.access : file?.access) ?? 'desk';
  const hasPhone = visitMode ? !!visit?.hasPhone : !!file?.customer.hasPhone;
  const custId = visitMode ? visit?.customer?.id ?? null : customerId ?? null;
  const missingBefore = needs.filter((n) => n.when === 'before' && n.status !== 'signed');

  const linkBody = () => (visitMode ? { appointmentId: appointmentId || undefined, walkInId: walkInId || undefined } : { customerId });
  const signHere = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ token: string }>('/client-forms/links', { method: 'POST', token, body: linkBody() });
      setSigning(r.token);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const sendSms = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ sentTo: string | null }>('/client-forms/links', { method: 'POST', token, body: { ...linkBody(), send: true } });
      setMsg(vi ? `Đã nhắn link tới ${r.sentTo ?? ''}` : `Link texted to ${r.sentTo ?? ''}`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch<{ url: string }>('/client-forms/links', { method: 'POST', token, body: linkBody() });
      try { await navigator.clipboard.writeText(r.url); setMsg(vi ? 'Đã sao chép link' : 'Link copied'); }
      catch { setMsg(r.url); }
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };

  if (!enabled) {
    if (!visitMode || !loadErr) return null;
    return (
      <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', margin: '0 0 12px', background: 'var(--wash-amber)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ink-warn)' }}>📋 {vi ? 'Không mở được phiếu & SOAP' : "Forms & SOAP didn't load"}</span>
        <span style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: 'var(--ce2e8f0)', wordBreak: 'break-word' }}>{loadErr}</span>
        <button type="button" onClick={() => setTick((x) => x + 1)} style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{vi ? 'Thử lại' : 'Retry'}</button>
      </div>
    );
  }

  const pill = (n: FormNeed) => {
    const ok = n.status === 'signed';
    const look = ok
      ? { bg: 'transparent', ink: 'var(--ink-good)', icon: '✓' }
      : n.status === 'expired'
        ? { bg: 'var(--wash-amber)', ink: 'var(--ink-warn)', icon: '↻' }
        : { bg: 'var(--wash-red)', ink: 'var(--ink-bad)', icon: '!' };
    const label = `${look.icon} ${kindLabel(n.kind, vi, n.title)}${n.status === 'expired' ? (vi ? ' · hết hạn' : ' · expired') : !ok ? (vi ? ' · thiếu' : ' · missing') : ''}`;
    const canOpen = ok && !!n.entryId && access !== 'desk';
    return (
      <button key={n.kind} type="button" disabled={!canOpen} onClick={() => canOpen && setOpen(n.entryId)}
        title={n.signedAt ? new Date(n.signedAt).toLocaleDateString(vi ? 'vi-VN' : undefined) : undefined}
        style={{ border: '1px solid var(--line)', background: look.bg, color: look.ink, borderRadius: 999, padding: '5px 11px', fontSize: 12, fontWeight: 800, cursor: canOpen ? 'pointer' : 'default' }}>
        {label}
      </button>
    );
  };

  const btn = { minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 700, cursor: 'pointer' } as const;

  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '12px 14px', margin: visitMode ? '0 0 12px' : '16px 0', background: 'var(--raised)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--ce2e8f0)', marginRight: 4 }}>📋 {vi ? 'Phiếu & cam kết' : 'Forms'}</span>
        {needs.map(pill)}
      </div>

      {flags.length > 0 && (
        <div style={{ marginTop: 10, borderRadius: 10, background: 'var(--wash-red)', border: '1px solid var(--line)', padding: '8px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-bad)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>⚠ {vi ? 'Lưu ý trước khi làm' : 'Check before starting'}</div>
          {flags.map((f) => (
            <div key={`${f.kind}:${f.fieldId}`} style={{ fontSize: 13, color: 'var(--ce2e8f0)', marginTop: 4 }}>
              • {f.label}{f.note ? ` — ${f.note}` : ''}
            </div>
          ))}
        </div>
      )}
      {notes.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ccbd5e1)' }}>{notes.join(' · ')}</div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {(missingBefore.length > 0 || !visitMode) && (
          <button type="button" disabled={busy} onClick={signHere} style={{ ...btn, background: '#6366f1', border: 'none', color: '#fff' }}>
            ✍ {vi ? 'Ký trên máy này' : 'Sign on this device'}
          </button>
        )}
        {(missingBefore.length > 0 || !visitMode) && hasPhone && (
          <button type="button" disabled={busy} onClick={sendSms} style={btn}>💬 {vi ? 'Nhắn link SMS' : 'Text the link'}</button>
        )}
        {(missingBefore.length > 0 || !visitMode) && (
          <button type="button" disabled={busy} onClick={copy} style={btn}>🔗 {vi ? 'Sao chép link' : 'Copy link'}</button>
        )}
        {visitMode && visit?.canSoap && (
          visit.soapId
            ? <button type="button" onClick={() => setOpen(visit.soapId ?? null)} style={btn}>📝 {vi ? 'Xem SOAP' : 'View SOAP'}</button>
            : <button type="button" onClick={() => setNote({ kind: 'soap' })} style={btn}>📝 {vi ? 'Ghi SOAP' : 'Write SOAP'}</button>
        )}
        {visitMode && (visit?.staffForms ?? []).map((sf) => (
          sf.entryId
            ? <button key={sf.kind} type="button" disabled={access === 'desk'} onClick={() => setOpen(sf.entryId)} style={btn}>📝 {vi ? 'Xem' : 'View'} {sf.title}</button>
            : sf.canWrite
              ? <button key={sf.kind} type="button" onClick={() => setNote({ kind: sf.kind, title: sf.title })} style={btn}>📝 {vi ? 'Ghi' : 'Write'} {sf.title}</button>
              : null
        ))}
      </div>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-link)', wordBreak: 'break-all' }}>{msg}</div>}

      {!visitMode && file && file.entries.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{vi ? 'Đã ký' : 'Signed'}</div>
          {file.entries.map((e) => (
            <button key={e.id} type="button" disabled={access === 'desk'} onClick={() => setOpen(e.id)}
              style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', padding: '8px 0', cursor: access === 'desk' ? 'default' : 'pointer', color: 'var(--ce2e8f0)' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{kindLabel(e.kind, vi, e.title)}{e.staffName ? ` · ${e.staffName}` : ''}{e.addenda ? ` · +${e.addenda}` : ''}</span>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{new Date(e.signedAt).toLocaleDateString(vi ? 'vi-VN' : undefined)}</span>
            </button>
          ))}
        </div>
      )}

      {open && <EntryViewer token={token} vi={vi} id={open} onClose={() => setOpen(null)} />}
      {signing && (
        <FormModal title={vi ? 'Khách ký phiếu' : 'Client signs'} onClose={() => { setSigning(null); setTick((x) => x + 1); }}>
          {/* Paper, whatever the theme: this is the client's page, handed across the counter. */}
          <div style={{ background: PAPER_GROUND, borderRadius: 12, padding: '14px 12px' }}>
            <SignFlow token={signing} embedded onFinished={onSigned} />
          </div>
          <button type="button" onClick={() => { setSigning(null); setTick((x) => x + 1); }}
            style={{ marginTop: 12, width: '100%', minHeight: 44, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {vi ? 'Đóng' : 'Close'}
          </button>
        </FormModal>
      )}
      {note && (
        <SoapSheet token={token} vi={vi} appointmentId={appointmentId} walkInId={walkInId} customerId={custId}
          kind={note.kind} title={note.title}
          onClose={() => setNote(null)} onSaved={() => setTick((x) => x + 1)} />
      )}
    </div>
  );
}
