'use client';

/**
 * "Nội dung hôm nay" — what this salon should film today.
 *
 * Read on a phone, standing up, between customers. That single fact drives
 * every layout choice here: one card per idea, the shot list before the
 * caption (you film first, you write later), a copy button instead of asking
 * anyone to retype an English caption, and buttons big enough for a thumb.
 *
 * The "vì sao gợi ý" line is never hidden behind a tap. It is the whole reason
 * an owner believes the idea is worth 15 minutes — it quotes their own numbers
 * back at them.
 */

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface Idea {
  id: string;
  rank: number;
  status: string;
  formatName: string | null;
  title: string;
  hook: string | null;
  shotList: string | null;
  caption: string | null;
  hashtags: string | null;
  bestTime: string | null;
  reason: string | null;
}
interface TrendNote { id: string; title: string; body: string }
interface Payload { forDate: string; ideas: Idea[]; trendNotes: TrendNote[] }

export default function ContentTodayPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setData(await apiFetch<Payload>('/content/today', { token }));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function mark(id: string, status: string) {
    setBusy(id);
    try {
      await apiFetch(`/content/ideas/${id}/status`, { method: 'POST', token, body: { status } });
      // Update in place: a full reload would scroll a phone back to the top,
      // losing the card the person was standing in front of.
      setData((d) => (d ? { ...d, ideas: d.ideas.map((i) => (i.id === id ? { ...i, status } : i)) } : d));
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch { /* clipboard blocked — the text is on screen to select by hand */ }
  }

  const rankLabel = (r: number) => (r === 1 ? T('Bài chính hôm nay', "Today's main post")
    : r === 2 ? T('Quay nhanh 2 phút', 'Quick 2-minute clip')
    : T('Đăng bù khi bận', 'Fallback if busy'));
  const rankColor = (r: number) => (r === 1 ? '#6366f1' : r === 2 ? '#8b5cf6' : '#22c55e');

  return (
    <section style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px', color: 'var(--ce2e8f0)' }}>
        {T('Nội dung hôm nay', "Today's content")}
      </h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 16px', fontSize: 13.5 }}>
        {data?.forDate ? new Date(`${data.forDate}T00:00:00`).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
        {' · '}{T('Lumio Agency gợi ý dựa trên số liệu thật của tiệm', 'Suggested from your own numbers')}
      </p>

      {error && <div style={ui.banner}>{error}</div>}

      {data?.trendNotes?.map((n) => (
        <div key={n.id} style={{ background: 'var(--c451a03)', border: '1px solid var(--c92400e)', borderRadius: 10, padding: '11px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--cfcd34d)', marginBottom: 3 }}>🔥 {n.title}</div>
          <div style={{ fontSize: 13, color: 'var(--cfde68a)', lineHeight: 1.55 }}>{n.body}</div>
        </div>
      ))}

      {loading && <p style={{ color: 'var(--c94a3b8)', fontSize: 14 }}>{T('Đang tải…', 'Loading…')}</p>}

      {!loading && !data?.ideas?.length && (
        <div style={{ ...ui.card, textAlign: 'center', padding: '28px 20px' }}>
          <div style={{ fontSize: 15, color: 'var(--ce2e8f0)', marginBottom: 6 }}>
            {T('Hôm nay chưa có gợi ý', 'No plan for today yet')}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
            {T('Đội Lumio đang chuẩn bị kế hoạch nội dung cho tiệm. Kiểm tra lại sau nhé.',
               'The Lumio team is preparing your plan. Check back shortly.')}
          </div>
        </div>
      )}

      {data?.ideas?.map((idea) => {
        const done = idea.status === 'filmed' || idea.status === 'posted';
        const skipped = idea.status === 'skipped';
        return (
          <div key={idea.id} style={{
            ...ui.card, marginBottom: 14, padding: 16,
            opacity: skipped ? 0.55 : 1,
            borderColor: done ? '#22c55e' : 'var(--c334155)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 9 }}>
              <span style={{ background: rankColor(idea.rank), color: '#fff', fontSize: 11.5, fontWeight: 700, padding: '3px 9px', borderRadius: 6 }}>
                {rankLabel(idea.rank)}
              </span>
              {idea.formatName && (
                <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{idea.formatName}</span>
              )}
              {idea.bestTime && (
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c94a3b8)' }}>
                  🕐 {idea.bestTime}
                </span>
              )}
            </div>

            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.4, marginBottom: 8 }}>
              {idea.title}
            </div>

            {idea.hook && (
              <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, marginBottom: 10 }}>
                <b style={{ color: 'var(--ca5b4fc)' }}>{T('Mở đầu 3 giây', 'First 3 seconds')}:</b> {idea.hook}
              </div>
            )}

            {idea.shotList && (
              <div style={{ background: 'var(--c1e293b)', borderRadius: 8, padding: '9px 12px', marginBottom: 10 }}>
                <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {T('Cần quay', 'Shots')}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.6 }}>{idea.shotList}</div>
              </div>
            )}

            {idea.caption && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: 0.6 }}>Caption</span>
                  <button
                    onClick={() => copy(idea.id, `${idea.caption}${idea.hashtags ? `\n\n${idea.hashtags}` : ''}`)}
                    style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c334155)', background: 'transparent', color: copied === idea.id ? '#22c55e' : 'var(--ca5b4fc)', fontSize: 12, cursor: 'pointer' }}
                  >
                    {copied === idea.id ? T('✓ Đã chép', '✓ Copied') : T('Chép', 'Copy')}
                  </button>
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--ccbd5e1)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{idea.caption}</div>
                {idea.hashtags && (
                  <div style={{ fontSize: 12.5, color: 'var(--c60a5fa)', marginTop: 5, lineHeight: 1.5 }}>{idea.hashtags}</div>
                )}
              </div>
            )}

            {idea.reason && (
              <div style={{ background: 'var(--c172554)', borderRadius: 8, padding: '9px 12px', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--c93c5fd)', fontWeight: 700 }}>{T('Vì sao gợi ý', 'Why this')}: </span>
                <span style={{ fontSize: 12.5, color: 'var(--cbfdbfe)', lineHeight: 1.6 }}>{idea.reason}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => mark(idea.id, done ? 'published' : 'posted')}
                disabled={busy === idea.id}
                style={{
                  flex: '1 1 auto', minHeight: 42, padding: '10px 14px', borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  border: done ? '1px solid #22c55e' : 'none',
                  background: done ? 'transparent' : '#6366f1',
                  color: done ? '#22c55e' : '#fff',
                }}
              >
                {done ? T('✓ Đã đăng', '✓ Posted') : T('Đánh dấu đã đăng', 'Mark as posted')}
              </button>
              {!done && (
                <button
                  onClick={() => mark(idea.id, skipped ? 'published' : 'skipped')}
                  disabled={busy === idea.id}
                  style={{ minHeight: 42, padding: '10px 14px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13.5, cursor: 'pointer' }}
                >
                  {skipped ? T('Bỏ qua ✓', 'Skipped ✓') : T('Bỏ qua', 'Skip')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
