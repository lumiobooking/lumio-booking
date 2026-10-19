'use client';

/**
 * The client's forms behind one signing link, one after another: the salon's
 * name, a VI / EN switch, each form with its signature, then "all signed".
 *
 * Used full-page at /sign/<token> (a texted link, the check-in iPad) and in a
 * popup over the salon's own screen ("Ký trên máy này") — so the desk never
 * leaves the ticket it was on, and sees it turn ✓ the moment the client signs.
 * No login: the token is the credential.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PAPER } from './FormRenderer';
import { SignForm } from './SignForm';
import type { Answers, FormLang, TemplatePair } from '../../lib/client-forms';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const INK = '#1f2937';
const SUB = '#6b7280';

export interface SignCtx {
  salon: { name: string; logoUrl: string | null };
  lang: FormLang;
  prefill: { name?: string; phone?: string; email?: string; birthDate?: string };
  forms: (TemplatePair & { done: boolean })[];
  allDone: boolean;
}

export function SignFlow({ token, embedded, onFinished, finishedExtra, langHint }: {
  token: string;
  /** In a popup: no page chrome; tells the opener as soon as everything is signed. */
  embedded?: boolean;
  onFinished?: () => void;
  /** Extra content on the "all signed" card (the iPad's "hand it back" button). */
  finishedExtra?: React.ReactNode;
  langHint?: FormLang;
}) {
  const [ctx, setCtx] = useState<SignCtx | null>(null);
  const [missing, setMissing] = useState(false);
  const [lang, setLang] = useState<FormLang>(langHint ?? 'en');
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    fetch(`${API_URL}/public/client-forms/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const c = (await r.json()) as SignCtx;
        if (!alive) return;
        setCtx(c); setLang(langHint ?? c.lang); setDone(c.forms.filter((f) => f.done).map((f) => f.kind));
      })
      .catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [token, langHint]);

  const vi = lang === 'vi';
  const todo = useMemo(() => (ctx?.forms ?? []).filter((f) => !done.includes(f.kind)), [ctx, done]);
  const current = todo[0] ?? null;
  const finished = !!ctx && todo.length === 0;

  // Tell the opener once — its handler may re-render us with a new callback.
  const told = useRef(false);
  useEffect(() => {
    if (finished && !told.current) { told.current = true; onFinished?.(); }
  }, [finished, onFinished]);

  const initial = useMemo<Answers>(() => {
    if (!current || !ctx) return {};
    const a: Answers = {};
    for (const f of current[lang].fields) {
      const v = f.prefill ? ctx.prefill[f.prefill] : undefined;
      if (v) a[f.id] = v;
    }
    return a;
  }, [current, ctx, lang]);

  if (missing) {
    return (
      <div style={{ textAlign: 'center', padding: embedded ? '24px 8px' : '80px 8px 0', color: SUB }}>
        <div style={{ fontSize: 40 }}>📋</div>
        <p style={{ fontSize: 16, lineHeight: 1.5 }}>Đường link không còn hiệu lực.<br />This link isn’t valid any more.</p>
      </div>
    );
  }
  if (!ctx) return <div style={{ height: 200, display: 'grid', placeItems: 'center', color: SUB, fontSize: 14 }}>…</div>;

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ctx.salon.logoUrl ? <img src={ctx.salon.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK }}>{ctx.salon.name}</div>
        {!finished && <div style={{ fontSize: 13, color: SUB }}>{vi ? `Phiếu ${ctx.forms.length - todo.length + 1} / ${ctx.forms.length}` : `Form ${ctx.forms.length - todo.length + 1} of ${ctx.forms.length}`}</div>}
      </div>
      <div style={{ display: 'flex', border: `1px solid ${PAPER.line}`, borderRadius: 999, overflow: 'hidden' }}>
        {(['vi', 'en'] as FormLang[]).map((l) => (
          <button key={l} type="button" onClick={() => setLang(l)}
            style={{ minHeight: 36, padding: '0 12px', border: 'none', background: lang === l ? PAPER.accent : PAPER.card, color: lang === l ? PAPER.onAccent : INK, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            {l === 'vi' ? 'VI' : 'EN'}
          </button>
        ))}
      </div>
    </div>
  );

  if (finished) {
    return (
      <div>
        {head}
        <div style={{ textAlign: 'center', background: PAPER.card, border: `1px solid ${PAPER.line}`, borderRadius: 18, padding: '32px 20px', color: INK }}>
          <div style={{ fontSize: 48 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{vi ? 'Cảm ơn bạn! Đã ký xong.' : 'Thank you — all signed.'}</div>
          <p style={{ fontSize: 15, color: SUB, lineHeight: 1.5 }}>{vi ? 'Phiếu đã được lưu. Kỹ thuật viên đã nhận được thông tin của bạn.' : 'Saved. Your therapist has your answers.'}</p>
          {finishedExtra}
        </div>
      </div>
    );
  }

  const tpl = current![lang];
  return (
    <div>
      {head}
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: INK }}>{tpl.title}</h1>
      {tpl.intro && <p style={{ fontSize: 15, color: SUB, lineHeight: 1.5, margin: '0 0 14px' }}>{tpl.intro}</p>}
      <SignForm key={`${current!.kind}:${lang}`} tpl={tpl} initial={initial} palette={PAPER} vi={vi}
        defaultName={ctx.prefill.name ?? ''} nameLabel={vi ? 'Họ tên người ký' : 'Your name'}
        submitLabel={todo.length > 1 ? (vi ? 'Ký & tiếp tục' : 'Sign & continue') : (vi ? 'Ký & lưu' : 'Sign & save')}
        onSubmit={async (answers, signatureData, signedName) => {
          let r: Response;
          try {
            r = await fetch(`${API_URL}/public/client-forms/${encodeURIComponent(token)}`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ kind: current!.kind, answers, signatureData, signedName, lang }),
            });
          } catch {
            throw new Error(vi ? 'Mất kết nối — chưa lưu. Vui lòng bấm lại.' : 'No connection — not saved yet. Please tap again.');
          }
          if (!r.ok) {
            const j = await r.json().catch(() => null) as { message?: unknown } | null;
            const m = j && typeof j.message === 'string' ? j.message : Array.isArray(j?.message) ? (j!.message as string[]).join(', ') : '';
            throw new Error(`${vi ? 'Chưa lưu được' : 'Not saved'}${m ? `: ${m}` : ''} (${r.status})`);
          }
          setDone((d) => [...d, current!.kind]);
          if (!embedded) window.scrollTo({ top: 0, behavior: 'smooth' });
        }} />
    </div>
  );
}
