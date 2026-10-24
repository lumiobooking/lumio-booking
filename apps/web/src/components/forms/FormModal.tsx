'use client';

/**
 * The SOAP note and a signed form open over whatever screen asked for them:
 * the desk's ticket, the calendar, a client's profile or the staff app.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { answerText, kindLabel, printHtml, type Answers, type FormEntry, type ResolvedTemplate, type TemplatePair } from '../../lib/client-forms';
import { THEMED } from './FormRenderer';
import { SignForm } from './SignForm';

export function FormModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!mounted) return null;
  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 400, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}
        style={{ width: 'min(620px, 100%)', background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{title}</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 26, lineHeight: 1, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** The therapist's SOAP note for one visit: tap, sign, done. "Same as last time" starts from the previous note. */
export function SoapSheet({ token, vi, appointmentId, walkInId, customerId, onClose, onSaved, kind = 'soap', title }: {
  token: string | null; vi: boolean; appointmentId?: string | null; walkInId?: string | null; customerId?: string | null;
  onClose: () => void; onSaved: () => void;
  /** 'soap', or one of the salon's own technician forms ("c_…"). */
  kind?: string;
  title?: string;
}) {
  const [tpl, setTpl] = useState<ResolvedTemplate | null>(null);
  const [last, setLast] = useState<{ answers: Answers; signedAt: string } | null>(null);
  const [start, setStart] = useState<{ key: number; answers: Answers }>({ key: 0, answers: {} });
  const [err, setErr] = useState<string | null>(null);
  const { user } = useAuth();
  // The signed-in person, prefilled: a support session signs as itself, never
  // as the salon's staff, and the server falls back to the staff record anyway.
  const myName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<{ templates: TemplatePair[] }>('/client-forms/templates', { token })
      .then((r) => { if (alive) setTpl(r.templates.find((x) => x.kind === kind)?.[vi ? 'vi' : 'en'] ?? null); })
      .catch(() => alive && setErr(vi ? 'Không tải được mẫu' : 'Could not load the form'));
    if (customerId) {
      apiFetch<{ answers: Answers; signedAt: string } | null>(`/client-forms/customers/${customerId}/last-soap${kind === 'soap' ? '' : `?kind=${encodeURIComponent(kind)}`}`, { token })
        .then((r) => { if (alive) setLast(r); }).catch(() => undefined);
    }
    return () => { alive = false; };
  }, [token, vi, customerId, kind]);

  return (
    <FormModal title={kindLabel(kind, vi, title)} onClose={onClose}>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 14 }}>{err}</div>}
      {!tpl && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 14 }}>{vi ? 'Đang tải…' : 'Loading…'}</div>}
      {tpl && (
        <SignForm key={start.key} tpl={tpl} initial={start.answers} palette={THEMED} vi={vi}
          nameLabel={vi ? 'Kỹ thuật viên' : 'Therapist'} submitLabel={vi ? 'Ký & lưu ghi chú' : 'Sign & save the note'}
          defaultName={myName} nameOptional
          top={last ? (
            <button type="button" onClick={() => setStart({ key: start.key + 1, answers: last.answers })}
              style={{ marginBottom: 12, width: '100%', minHeight: 44, borderRadius: 12, border: '1px dashed var(--line-strong)', background: 'transparent', color: 'var(--ink-link)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
              {vi ? `↺ Giống lần trước (${new Date(last.signedAt).toLocaleDateString('vi-VN')})` : `↺ Same as last time (${new Date(last.signedAt).toLocaleDateString()})`}
            </button>
          ) : null}
          onSubmit={async (answers, signatureData, signedName) => {
            await apiFetch(kind === 'soap' ? '/client-forms/soap' : '/client-forms/staff-notes', {
              method: 'POST', token,
              body: { ...(kind === 'soap' ? {} : { kind }), appointmentId: appointmentId || undefined, walkInId: walkInId || undefined, answers, signatureData, signedName, lang: vi ? 'vi' : 'en' },
            });
            onSaved();
            onClose();
          }} />
      )}
    </FormModal>
  );
}

/** One signed form, read back exactly as it was shown — with print and dated corrections. */
export function EntryViewer({ token, vi, id, onClose }: { token: string | null; vi: boolean; id: string; onClose: () => void }) {
  const [e, setE] = useState<FormEntry | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<FormEntry>(`/client-forms/entries/${id}`, { token })
      .then((r) => { if (alive) setE(r); })
      .catch((x) => alive && setErr(x instanceof Error ? x.message : 'Error'));
    return () => { alive = false; };
  }, [token, id]);

  const print = () => {
    if (!e) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(printHtml(e, vi));
    w.document.close();
    w.focus();
    window.setTimeout(() => { try { w.print(); } catch { /* closed */ } }, 300);
  };

  const add = async () => {
    if (!text.trim() || !e) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ addenda: FormEntry['addenda'] }>(`/client-forms/entries/${e.id}/addendum`, { method: 'POST', token, body: { text: text.trim() } });
      setE({ ...e, addenda: r.addenda });
      setText('');
    } finally { setBusy(false); }
  };

  const tpl = e?.snapshot ?? null;
  return (
    <FormModal title={tpl?.title ?? kindLabel(e?.kind ?? '', vi)} onClose={onClose}>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 14 }}>{err}</div>}
      {!e && !err && <div style={{ color: 'var(--c94a3b8)', fontSize: 14 }}>{vi ? 'Đang tải…' : 'Loading…'}</div>}
      {e && tpl && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginBottom: 10 }}>
            {(e.signerRole === 'staff' ? e.staffName || e.signedName : e.customerName || e.signedName) ?? ''} · {new Date(e.signedAt).toLocaleString(vi ? 'vi-VN' : undefined)}
          </div>
          {tpl.fields.map((f) => {
            if (f.type === 'section') return <div key={f.id} style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c94a3b8)', margin: '14px 0 4px' }}>{f.label}</div>;
            if (f.type === 'note') return null;
            const a = answerText(f, e.answers, tpl.areas, vi);
            const flagged = f.type === 'yesno' && e.answers[f.id] === true && (f.flags?.length ?? 0) > 0;
            return (
              <div key={f.id} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: 14, color: 'var(--ccbd5e1)' }}>{f.label}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: flagged ? 'var(--ink-bad)' : a ? 'var(--ce2e8f0)' : 'var(--c64748b)', textAlign: 'right', maxWidth: '55%' }}>{a || '—'}</span>
              </div>
            );
          })}
          {e.signatureData && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>{vi ? 'Chữ ký' : 'Signature'} — {e.signedName}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.signatureData} alt="" style={{ display: 'block', maxWidth: 320, width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
            </div>
          )}
          {e.addenda.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{vi ? 'Bổ sung sau khi ký' : 'Added after signing'}</div>
              {e.addenda.map((x, i) => (
                <div key={i} style={{ fontSize: 14, color: 'var(--ce2e8f0)', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{new Date(x.at).toLocaleString(vi ? 'vi-VN' : undefined)} · {x.by}</span><br />{x.text}
                </div>
              ))}
            </div>
          )}
          {e.canAmend && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <input value={text} onChange={(x) => setText(x.target.value)} maxLength={1000} placeholder={vi ? 'Thêm ghi chú bổ sung (không sửa bản đã ký)' : 'Add a correction (the signed form stays as it is)'}
                style={{ flex: 1, minWidth: 0, minHeight: 40, borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', padding: '0 12px', fontSize: 14 }} />
              <button type="button" disabled={busy || !text.trim()} onClick={add}
                style={{ minHeight: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy || !text.trim() ? 0.6 : 1 }}>{vi ? 'Thêm' : 'Add'}</button>
            </div>
          )}
          <button type="button" onClick={print}
            style={{ marginTop: 14, width: '100%', minHeight: 44, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            🖨 {vi ? 'In / lưu PDF' : 'Print / save PDF'}
          </button>
        </div>
      )}
    </FormModal>
  );
}
