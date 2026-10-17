'use client';

/**
 * /sign/<token> — the client fills in and signs their massage forms: on their
 * own phone (a texted link) or on the salon's iPad ("sign on this device",
 * the check-in kiosk). No login: the token is the credential.
 *
 * `?return=/path` sends the iPad back to the salon's screen when done.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { PAPER } from '../../../components/forms/FormRenderer';
import { SignForm } from '../../../components/forms/SignForm';
import { safeReturn, type Answers, type FormLang, type TemplatePair } from '../../../lib/client-forms';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

interface Ctx {
  salon: { name: string; logoUrl: string | null };
  lang: FormLang;
  prefill: { name?: string; phone?: string; email?: string; birthDate?: string };
  forms: (TemplatePair & { done: boolean })[];
  allDone: boolean;
}

const PAGE_BG = '#f5f3ef';
const INK = '#1f2937';
const SUB = '#6b7280';

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [missing, setMissing] = useState(false);
  const [lang, setLang] = useState<FormLang>('en');
  const [done, setDone] = useState<string[]>([]);
  const [back, setBack] = useState<string | null>(null);

  useEffect(() => {
    try { setBack(safeReturn(new URLSearchParams(window.location.search).get('return'))); } catch { setBack(null); }
    if (!token) return;
    fetch(`${API_URL}/public/client-forms/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(); const c = (await r.json()) as Ctx; setCtx(c); setLang(c.lang); setDone(c.forms.filter((f) => f.done).map((f) => f.kind)); })
      .catch(() => setMissing(true));
  }, [token]);

  const vi = lang === 'vi';
  const todo = useMemo(() => (ctx?.forms ?? []).filter((f) => !done.includes(f.kind)), [ctx, done]);
  const current = todo[0] ?? null;
  const finished = !!ctx && todo.length === 0;

  useEffect(() => {
    if (!finished || !back) return;
    const t = window.setTimeout(() => { window.location.href = back; }, 5000);
    return () => window.clearTimeout(t);
  }, [finished, back]);

  const initial = useMemo<Answers>(() => {
    if (!current || !ctx) return {};
    const a: Answers = {};
    for (const f of current[lang].fields) {
      const v = f.prefill ? ctx.prefill[f.prefill] : undefined;
      if (v) a[f.id] = v;
    }
    return a;
  }, [current, ctx, lang]);

  const shell = (body: React.ReactNode) => (
    <main style={{ minHeight: '100dvh', background: PAGE_BG, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', color: INK }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '20px 16px 48px' }}>{body}</div>
    </main>
  );

  if (missing) {
    return shell(
      <div style={{ textAlign: 'center', paddingTop: 80, color: SUB }}>
        <div style={{ fontSize: 40 }}>📋</div>
        <p style={{ fontSize: 16, lineHeight: 1.5 }}>Đường link không còn hiệu lực.<br />This link isn’t valid any more.</p>
      </div>,
    );
  }
  if (!ctx) return shell(<div style={{ height: 200 }} />);

  const head = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {ctx.salon.logoUrl ? <img src={ctx.salon.logoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover' }} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{ctx.salon.name}</div>
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
    return shell(
      <div>
        {head}
        <div style={{ textAlign: 'center', background: PAPER.card, border: `1px solid ${PAPER.line}`, borderRadius: 18, padding: '36px 20px' }}>
          <div style={{ fontSize: 48 }}>✅</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>{vi ? 'Cảm ơn bạn! Đã ký xong.' : 'Thank you — all signed.'}</div>
          <p style={{ fontSize: 15, color: SUB, lineHeight: 1.5 }}>{vi ? 'Kỹ thuật viên đã nhận được thông tin của bạn.' : 'Your therapist has your answers.'}</p>
          {back && (
            <button type="button" onClick={() => { window.location.href = back; }}
              style={{ marginTop: 10, minHeight: 50, padding: '0 24px', borderRadius: 14, border: 'none', background: PAPER.accent, color: PAPER.onAccent, fontSize: 16, fontWeight: 800, cursor: 'pointer' }}>
              {vi ? 'Xong — đưa máy lại cho tiệm' : 'Done — hand the device back'}
            </button>
          )}
        </div>
      </div>,
    );
  }

  const tpl = current![lang];
  return shell(
    <div>
      {head}
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 6px' }}>{tpl.title}</h1>
      {tpl.intro && <p style={{ fontSize: 15, color: SUB, lineHeight: 1.5, margin: '0 0 14px' }}>{tpl.intro}</p>}
      <SignForm key={`${current!.kind}:${lang}`} tpl={tpl} initial={initial} palette={PAPER} vi={vi}
        defaultName={ctx.prefill.name ?? ''} nameLabel={vi ? 'Họ tên người ký' : 'Your name'}
        submitLabel={todo.length > 1 ? (vi ? 'Ký & tiếp tục' : 'Sign & continue') : (vi ? 'Ký & gửi' : 'Sign & send')}
        onSubmit={async (answers, signatureData, signedName) => {
          const r = await fetch(`${API_URL}/public/client-forms/${encodeURIComponent(token)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: current!.kind, answers, signatureData, signedName, lang }),
          });
          if (!r.ok) {
            const j = await r.json().catch(() => null) as { message?: unknown } | null;
            const m = j && typeof j.message === 'string' ? j.message : (vi ? 'Không gửi được, vui lòng thử lại' : 'Could not send, please try again');
            throw new Error(m);
          }
          setDone((d) => [...d, current!.kind]);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }} />
    </div>,
  );
}
