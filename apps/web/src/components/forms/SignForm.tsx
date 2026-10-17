'use client';

/**
 * A form, a typed name and a drawn signature, with one "Sign" button that
 * will not go until every required answer is in — it jumps to the first one
 * that is not. Used by the client's sign page and by the therapist's SOAP note.
 */
import { useState, type ReactNode } from 'react';
import { missingFields, type Answers, type ResolvedTemplate } from '../../lib/client-forms';
import { FormRenderer, type FormPalette } from './FormRenderer';
import { SignaturePad } from './SignaturePad';

export function SignForm({ tpl, initial, palette, vi, defaultName, nameLabel, submitLabel, onSubmit, top }: {
  tpl: ResolvedTemplate; initial?: Answers; palette: FormPalette; vi: boolean;
  defaultName?: string; nameLabel: string; submitLabel: string;
  onSubmit: (answers: Answers, signature: string, name: string) => Promise<void>;
  top?: ReactNode;
}) {
  const [answers, setAnswers] = useState<Answers>(initial ?? {});
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(defaultName ?? '');
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const p = palette;

  const submit = async () => {
    const m = missingFields(tpl, answers);
    setMissing(m);
    if (m.length) {
      setErr(vi ? `Còn ${m.length} câu chưa trả lời` : `${m.length} question(s) still to answer`);
      try { document.querySelector(`[data-field="${m[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* old browser */ }
      return;
    }
    const who = name.trim() || (typeof answers.name === 'string' ? answers.name.trim() : '');
    if (!who) { setErr(vi ? 'Vui lòng nhập họ tên' : 'Please type your name'); return; }
    if (!sig) { setErr(vi ? 'Vui lòng ký tên' : 'Please sign'); return; }
    setBusy(true); setErr(null);
    try { await onSubmit(answers, sig, who); }
    catch (e) { setErr(e instanceof Error ? e.message : (vi ? 'Không gửi được, thử lại' : 'Could not send, try again')); }
    finally { setBusy(false); }
  };

  return (
    <div>
      {top}
      <FormRenderer tpl={tpl} answers={answers} onChange={(a) => { setAnswers(a); if (missing.length) setMissing(missingFields(tpl, a)); }} palette={p} vi={vi} missing={missing} />
      <div style={{ marginTop: 16, border: `1px solid ${p.line}`, background: p.card, borderRadius: 14, padding: '12px 14px' }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: p.ink }}>{nameLabel}</div>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name"
          style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', minHeight: 44, borderRadius: 10, border: `1px solid ${p.line}`, background: p.field, color: p.ink, padding: '0 12px', fontSize: 16 }} />
        <div style={{ marginTop: 12 }}><SignaturePad onChange={setSig} palette={p} vi={vi} /></div>
      </div>
      {err && <div role="alert" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: p.badWash, color: p.bad, fontSize: 14, fontWeight: 600 }}>{err}</div>}
      <button type="button" disabled={busy} onClick={submit}
        style={{ marginTop: 14, width: '100%', minHeight: 52, borderRadius: 14, border: 'none', background: p.accent, color: p.onAccent, fontSize: 17, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
        {busy ? (vi ? 'Đang gửi…' : 'Sending…') : submitLabel}
      </button>
    </div>
  );
}
