'use client';

import { useEffect, useState, CSSProperties } from 'react';
import { apiFetch } from '../lib/api';

/**
 * The first comments under a published post — booking link, today's offer,
 * phone, address — written by the Page a few minutes after the post goes
 * live. Three pieces, all fed by GET /content/auto-comments:
 *   · AutoCommentsSettings — the shop's templates and timing (saved once);
 *   · PostCommentsPicker — in the composer: what THIS post will get;
 *   · CommentOutcome — on a posted row: what was written, what failed, why.
 * Server: api content/auto-comments.ts.
 */

export type CommentChannel = 'facebook' | 'instagram';
export interface CommentTemplate { id: string; text: string; on: boolean; channels: CommentChannel[] }
export interface AutoCommentSettings { enabled: boolean; delayMin: number; gapMin: number; max: number; templates: CommentTemplate[] }
export interface CommentFacts { salon: string; bookingUrl?: string | null; phone?: string | null; address?: string | null; website?: string | null; promo?: string | null }
export interface AutoCommentsView {
  settings: AutoCommentSettings;
  facts: CommentFacts;
  preview: { id: string; on: boolean; channels: CommentChannel[]; text: string | null }[];
  channels: { facebook: boolean; instagram: boolean };
}
export interface PostCommentOverride { off?: boolean; items?: { text: string; channels: CommentChannel[] }[] }
export interface CommentJob {
  channel: CommentChannel; targetId: string; text: string; dueAt: string; status: 'pending' | 'posted' | 'failed';
  id?: string | null; error?: string | null; at?: string | null; attempts?: number; fix?: string | null;
}

const PH = ['%booking_url%', '%promo%', '%phone%', '%address%', '%website%', '%salon%'];

/** Fill a template on the screen, the same way the server does; null when a placeholder is empty. */
export function fillPreview(text: string, f: CommentFacts): string | null {
  const vals: Record<string, string | null | undefined> = {
    '%booking_url%': f.bookingUrl, '%promo%': f.promo, '%phone%': f.phone, '%address%': f.address, '%website%': f.website, '%salon%': f.salon,
  };
  let out = text;
  for (const k of PH) {
    if (!out.includes(k)) continue;
    const v = (vals[k] ?? '').trim();
    if (!v) return null;
    out = out.split(k).join(v);
  }
  return out.trim() || null;
}

const chip = (on: boolean, color = '#6366f1'): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', userSelect: 'none',
  border: `1px solid ${on ? color : 'var(--c334155)'}`, background: on ? `${color}22` : 'transparent', color: on ? 'var(--ce2e8f0)' : 'var(--c64748b)',
});
const box: CSSProperties = { marginTop: 8, padding: 10, borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)' };
const ta: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.5, fontFamily: 'inherit', border: '1px solid var(--c334155)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', resize: 'vertical' };
const small: CSSProperties = { fontSize: 11.5, color: 'var(--c94a3b8)', lineHeight: 1.5 };
const btn: CSSProperties = { minHeight: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ca5b4fc)', fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' };
const num: CSSProperties = { width: 56, padding: '5px 7px', borderRadius: 7, border: '1px solid var(--c334155)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 12.5, fontFamily: 'inherit' };

function ChannelChips({ value, onChange, avail, vi }: { value: CommentChannel[]; onChange: (v: CommentChannel[]) => void; avail: { facebook: boolean; instagram: boolean }; vi: boolean }) {
  const toggle = (c: CommentChannel) => {
    const next = value.includes(c) ? value.filter((x) => x !== c) : [...value, c];
    if (next.length) onChange(next);
  };
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      <span onClick={() => toggle('facebook')} style={chip(value.includes('facebook'), '#3b82f6')} title={avail.facebook ? '' : (vi ? 'Chưa kết nối Trang' : 'No Page connected')}>f Facebook</span>
      <span onClick={() => toggle('instagram')} style={chip(value.includes('instagram'), '#ec4899')} title={avail.instagram ? '' : (vi ? 'Chưa nối Instagram' : 'No Instagram linked')}>◎ Instagram</span>
    </span>
  );
}

/** The shop's templates and timing. Saved once; every post from then on. */
export function AutoCommentsSettings({ token, vi, initial, onSaved, onClose }: { token: string; vi: boolean; initial: AutoCommentsView | null; onSaved: (v: AutoCommentsView) => void; onClose: () => void }) {
  const T = (a: string, b: string) => (vi ? a : b);
  const [view, setView] = useState<AutoCommentsView | null>(initial);
  const [s, setS] = useState<AutoCommentSettings | null>(initial?.settings ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (view) return;
    apiFetch<AutoCommentsView>('/content/auto-comments', { token }).then((v) => { setView(v); setS(v.settings); }).catch(() => setErr(T('Không tải được cài đặt.', 'Could not load settings.')));
  }, [token, view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!view || !s) return <div style={box}><div style={small}>{err ?? T('Đang tải…', 'Loading…')}</div></div>;
  const facts = view.facts;
  const patchT = (i: number, p: Partial<CommentTemplate>) => setS({ ...s, templates: s.templates.map((t, j) => (j === i ? { ...t, ...p } : t)) });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const v = await apiFetch<AutoCommentsView>('/content/auto-comments', { method: 'POST', token, body: s });
      setView(v); setS(v.settings); onSaved(v);
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(false); }
  };
  const missing = [
    !facts.bookingUrl && '%booking_url%', !facts.phone && '%phone%', !facts.address && '%address%', !facts.promo && '%promo%',
  ].filter(Boolean) as string[];
  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)', cursor: 'pointer' }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          💬 {T('Tự bình luận sau khi đăng', 'Comment under every post after it goes live')}
        </label>
        <span style={{ ...small, marginLeft: 'auto' }}>
          {T('Sau', 'After')} <input type="number" min={0} max={120} value={s.delayMin} onChange={(e) => setS({ ...s, delayMin: Number(e.target.value) })} style={num} /> {T('phút · cách nhau', 'min · every')}{' '}
          <input type="number" min={1} max={60} value={s.gapMin} onChange={(e) => setS({ ...s, gapMin: Number(e.target.value) })} style={num} /> {T('phút · tối đa', 'min · at most')}{' '}
          <input type="number" min={1} max={5} value={s.max} onChange={(e) => setS({ ...s, max: Number(e.target.value) })} style={num} /> {T('bình luận/kênh', 'per channel')}
        </span>
      </div>
      <div style={{ ...small, marginTop: 6 }}>
        {T('Trang tự viết các bình luận này dưới bài, theo thứ tự, vài phút sau khi đăng — như trước đây team gõ tay. Ô trống: ', 'The Page writes these under the post, in order, a few minutes after publishing — what the team used to type by hand. Placeholders: ')}
        <code style={{ fontSize: 11 }}>{PH.join(' ')}</code>
        {missing.length > 0 && <span style={{ color: 'var(--cfcd34d)' }}> · {T('hiện trống', 'empty today')}: {missing.join(', ')} — {T('mẫu cần ô đó sẽ được bỏ qua', 'a template that needs one is skipped')}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
        {s.templates.map((t, i) => {
          const filled = fillPreview(t.text, facts);
          return (
            <div key={t.id} style={{ padding: 8, borderRadius: 8, border: '1px solid var(--c1f2937)', background: 'var(--c111827)', opacity: t.on ? 1 : 0.6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ccbd5e1)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={t.on} onChange={(e) => patchT(i, { on: e.target.checked })} /> {T('Bình luận', 'Comment')} {i + 1}
                </label>
                <ChannelChips value={t.channels} onChange={(channels) => patchT(i, { channels })} avail={view.channels} vi={vi} />
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button type="button" disabled={i === 0} onClick={() => { const a = [...s.templates]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setS({ ...s, templates: a }); }} style={{ ...btn, minHeight: 26, padding: '0 8px', fontSize: 11 }}>↑</button>
                  <button type="button" disabled={i === s.templates.length - 1} onClick={() => { const a = [...s.templates]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setS({ ...s, templates: a }); }} style={{ ...btn, minHeight: 26, padding: '0 8px', fontSize: 11 }}>↓</button>
                  <button type="button" onClick={() => setS({ ...s, templates: s.templates.filter((_, j) => j !== i) })} style={{ ...btn, minHeight: 26, padding: '0 8px', fontSize: 11, color: 'var(--cf87171)' }}>✕</button>
                </div>
              </div>
              <textarea value={t.text} onChange={(e) => patchT(i, { text: e.target.value })} rows={2} style={ta} />
              <div style={{ ...small, marginTop: 4, color: filled ? 'var(--c94a3b8)' : 'var(--cfcd34d)' }}>
                {filled ? <>→ {filled}</> : T('→ bỏ qua hôm nay (ô cần điền đang trống)', '→ skipped today (a placeholder is empty)')}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
        {s.templates.length < 8 && (
          <button type="button" onClick={() => setS({ ...s, templates: [...s.templates, { id: `t${Date.now()}`, text: '', on: true, channels: ['facebook', 'instagram'] }] })} style={btn}>＋ {T('Thêm bình luận', 'Add a comment')}</button>
        )}
        <button type="button" disabled={busy} onClick={save} style={{ ...btn, background: '#6366f1', color: '#fff', border: 'none', fontWeight: 700 }}>💾 {T('Lưu cho tiệm', 'Save for the shop')}</button>
        {err && <span style={{ fontSize: 12, color: 'var(--cf87171)' }}>{err}</span>}
        <button type="button" onClick={onClose} style={{ ...btn, marginLeft: 'auto', border: 'none', color: 'var(--c64748b)' }}>{T('Đóng', 'Close')}</button>
      </div>
      <div style={{ ...small, marginTop: 8, color: 'var(--c64748b)' }}>
        {T('Cần Trang được kết nối với quyền bình luận (tài khoản kết nối là Tester của app Lumio). Nếu bình luận báo thiếu quyền: Kết nối lại Trang ở Cài đặt → Messenger rồi bấm "Gửi lại" trên bài.',
           'Needs a Page connected with comment rights (the connecting account is a Tester on the Lumio app). If a comment reports missing rights: reconnect the Page under Settings → Messenger, then press "Retry" on the post.')}
      </div>
    </div>
  );
}

/** In the composer: what THIS post gets — the shop's templates, none, or its own list. */
export function PostCommentsPicker({ view, value, onChange, vi, onOpenSettings }: {
  view: AutoCommentsView | null | undefined; value: PostCommentOverride | null | undefined; onChange: (v: PostCommentOverride | null) => void; vi: boolean; onOpenSettings?: () => void;
}) {
  const T = (a: string, b: string) => (vi ? a : b);
  if (!view) return null;
  const mode: 'default' | 'off' | 'custom' = value?.off ? 'off' : value?.items ? 'custom' : 'default';
  const live = view.preview.filter((p) => p.on && p.text);
  const facts = view.facts;
  const radio = (m: typeof mode, label: string) => (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 34, padding: '0 12px 0 9px', borderRadius: 20, cursor: 'pointer',
      fontSize: 13, fontWeight: 600, border: `1px solid ${mode === m ? '#6366f1' : 'var(--c334155)'}`,
      background: mode === m ? 'var(--c1e1b4b)' : 'transparent', color: mode === m ? 'var(--ce2e8f0)' : 'var(--c94a3b8)',
    }}>
      <input type="radio" name="post-comments" checked={mode === m} onChange={() => onChange(m === 'default' ? null : m === 'off' ? { off: true } : { items: live.map((p) => ({ text: p.text!, channels: p.channels })) })} />
      {label}
    </label>
  );
  return (
    <div style={{ ...box, marginTop: 10, padding: 14 }}>
      {/* The whole width of the composer's left column, so each comment is a
          row a person can read and type in — not a 180px box beside the date. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ce2e8f0)', marginRight: 4 }}>💬 {T('Bình luận sau khi đăng', 'Comments after publishing')}</span>
        {radio('default', view.settings.enabled ? `${T('Theo mẫu tiệm', 'Shop templates')} (${live.length})` : T('Theo mẫu tiệm (đang tắt)', 'Shop templates (off)'))}
        {radio('off', T('Không, bài này', 'None for this post'))}
        {radio('custom', T('Tự soạn cho bài này', 'Write for this post'))}
        {onOpenSettings && <button type="button" onClick={onOpenSettings} style={{ ...btn, marginLeft: 'auto', minHeight: 30, padding: '0 10px', fontSize: 12 }}>⚙ {T('Mẫu của tiệm', 'Shop templates')}</button>}
      </div>
      {mode === 'default' && (
        <div style={{ marginTop: 6 }}>
          {!view.settings.enabled ? (
            <div style={small}>{T('Tiệm chưa bật bình luận tự động — bấm ⚙ để bật và soạn mẫu, hoặc chọn "Tự soạn cho bài này".', 'The shop has not turned this on — press ⚙ to enable it and write templates, or pick "Write for this post".')}</div>
          ) : live.length === 0 ? (
            <div style={{ ...small, color: 'var(--cfcd34d)' }}>{T('Không có mẫu nào điền được hôm nay (link đặt lịch / SĐT / ưu đãi đang trống).', 'No template can be filled today (booking link / phone / offer empty).')}</div>
          ) : live.map((p, i) => (
            <div key={p.id} style={{ ...small, display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: 'var(--c64748b)', flexShrink: 0 }}>{i + 1}. {p.channels.map((c) => (c === 'facebook' ? 'f' : '◎')).join(' ')}</span>
              <span style={{ color: 'var(--ccbd5e1)' }}>{p.text}</span>
            </div>
          ))}
          {view.settings.enabled && live.length > 0 && (
            <div style={{ ...small, color: 'var(--c64748b)', marginTop: 4 }}>
              {T(`Bình luận đầu sau ${view.settings.delayMin} phút, cách nhau ${view.settings.gapMin} phút.`, `First one ${view.settings.delayMin} min after posting, then every ${view.settings.gapMin} min.`)}
              {facts.promo ? ` · ${T('Ưu đãi hôm nay', 'Offer today')}: ${facts.promo}` : ''}
            </div>
          )}
        </div>
      )}
      {mode === 'custom' && value?.items && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {value.items.map((it, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto 32px', gap: 10, alignItems: 'center',
              padding: '8px 10px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c111827)',
            }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)', fontWeight: 700, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <textarea
                value={it.text}
                rows={Math.min(4, Math.max(1, Math.ceil((it.text.length || 1) / 70)))}
                onChange={(e) => onChange({ items: value.items!.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })}
                style={{ ...ta, fontSize: 13.5, padding: '9px 11px', resize: 'none' }}
                placeholder={T('Nội dung bình luận…', 'Comment text…')}
              />
              <ChannelChips value={it.channels} onChange={(channels) => onChange({ items: value.items!.map((x, j) => (j === i ? { ...x, channels } : x)) })} avail={view.channels} vi={vi} />
              <button type="button" aria-label={T('Xoá bình luận', 'Remove comment')} onClick={() => onChange({ items: value.items!.filter((_, j) => j !== i) })} style={{ ...btn, minHeight: 32, width: 32, padding: 0, fontSize: 13, color: 'var(--c64748b)' }}>✕</button>
            </div>
          ))}
          {value.items.length < 8 && (
            <button type="button" onClick={() => onChange({ items: [...value.items!, { text: '', channels: ['facebook', 'instagram'] }] })} style={{ ...btn, alignSelf: 'flex-start', minHeight: 26, fontSize: 11.5 }}>＋ {T('Thêm', 'Add')}</button>
          )}
          <div style={small}>{T('Có thể dùng các ô', 'Placeholders work here too')}: <code style={{ fontSize: 11 }}>%booking_url% %promo% %phone% %address%</code></div>
        </div>
      )}
    </div>
  );
}

/** On a posted row: what was written under it, what is still due, what failed and why. */
export function CommentOutcome({ log, vi, onRetry, busy }: { log: CommentJob[] | undefined; vi: boolean; onRetry?: () => void; busy?: boolean }) {
  const T = (a: string, b: string) => (vi ? a : b);
  const [open, setOpen] = useState(false);
  if (!log || !log.length) return null;
  const posted = log.filter((j) => j.status === 'posted').length;
  const failed = log.filter((j) => j.status === 'failed');
  const pending = log.filter((j) => j.status === 'pending');
  return (
    <div style={{ marginTop: 7, fontSize: 12 }}>
      <button type="button" onClick={() => setOpen(!open)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: failed.length ? 'var(--cfca5a5)' : 'var(--c94a3b8)' }}>
        💬 {posted} {T('bình luận đã đăng', 'comments posted')}
        {pending.length ? ` · ${pending.length} ${T('đang chờ', 'waiting')}` : ''}
        {failed.length ? ` · ${failed.length} ${T('lỗi', 'failed')}` : ''} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {log.map((j, i) => (
            <div key={i} style={{ ...small, display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ flexShrink: 0, color: j.status === 'posted' ? 'var(--c4ade80)' : j.status === 'failed' ? 'var(--cfca5a5)' : 'var(--cfcd34d)' }}>
                {j.status === 'posted' ? '✓' : j.status === 'failed' ? '✕' : '◷'} {j.channel === 'facebook' ? 'f' : '◎'}
              </span>
              <span style={{ color: 'var(--ccbd5e1)' }}>{j.text}</span>
              {j.status === 'pending' && <span style={{ color: 'var(--c64748b)', flexShrink: 0 }}>{new Date(j.dueAt).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>}
              {j.status === 'failed' && (j.fix || j.error) && <span style={{ color: 'var(--cfca5a5)' }}>— {j.fix ?? j.error}</span>}
            </div>
          ))}
          {failed.length > 0 && onRetry && (
            <button type="button" disabled={busy} onClick={onRetry} style={{ ...btn, alignSelf: 'flex-start', minHeight: 26, fontSize: 11.5, marginTop: 4 }}>↻ {T('Gửi lại bình luận lỗi', 'Retry failed comments')}</button>
          )}
        </div>
      )}
    </div>
  );
}
