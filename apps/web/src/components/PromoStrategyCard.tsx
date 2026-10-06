'use client';

import { useState } from 'react';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

/**
 * This salon's own promotion plan, as the owner should read it.
 *
 * Built for the question a salon actually asks the team — "nên chạy khuyến mãi
 * gì?" — so it answers in the order a person thinks: what kind of shop am I
 * (four facts), what do I do first (one programme, highlighted), what else
 * runs beside it, and what must I never do. Every programme carries the line
 * a customer would read, a copy button for it, and the money in one sentence.
 * The rules and the stop signal fold away: the team needs them, the owner
 * glancing at the card does not.
 *
 * All text arrives already in the screen's language (the API renders both).
 */

export interface StrategyProgramView {
  key: string;
  role: 'main' | 'support';
  title: string;
  offer: string;
  why: string;
  money: string;
  rules: string[];
  stopIf: string;
  discountPct: number;
}

export interface StrategyView {
  headline: string;
  facts: { key: string; label: string; value: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }[];
  programs: StrategyProgramView[];
  avoid: string[];
  maxSafePct: number;
  basis: string;
  missing: string[];
}

const TONE: Record<string, string> = {
  good: 'var(--ink-good)',
  warn: 'var(--ink-warn)',
  bad: 'var(--ink-bad)',
  neutral: 'var(--ce2e8f0)',
};

const ICON: Record<string, string> = {
  quiet: '🕘', gift: '🎁', first: '👋', rebook: '📅', referral: '🤝',
  winback: '💌', prepaid: '💳', combo: '✋🦶', raise: '📈',
};

export function PromoStrategyCard({ s, vi }: { s: StrategyView; vi: boolean }) {
  const T = (v: string, e: string) => ind(vi ? v : e);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    try {
      void navigator.clipboard?.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch { /* clipboard blocked — the text is on screen to select by hand */ }
  };

  return (
    <div style={{ ...ui.card, marginBottom: 14, padding: 16, borderColor: '#6366f1' }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ce2e8f0)', marginBottom: 4 }}>
        🎯 {T('Chiến lược khuyến mãi cho tiệm này', 'The promotion plan for this shop')}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--ce2e8f0)', lineHeight: 1.55, marginBottom: 12 }}>{s.headline}</div>

      {/* ---- the shop, in four or five facts ---- */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 8, marginBottom: 14,
      }}>
        {s.facts.map((f) => (
          <div key={f.key} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '8px 11px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)' }}>{f.label}</div>
            <div style={{ fontSize: 12.5, color: TONE[f.tone] ?? TONE.neutral, lineHeight: 1.45, marginTop: 2 }}>{f.value}</div>
          </div>
        ))}
      </div>

      {/* ---- the programmes ---- */}
      {s.programs.map((p, i) => {
        const main = p.role === 'main';
        return (
          <div key={p.key} style={{
            borderRadius: 12, padding: '12px 13px', marginBottom: 10,
            background: main ? 'rgba(99,102,241,.10)' : 'var(--c0f172a)',
            border: `1px solid ${main ? '#6366f1' : 'var(--c334155)'}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{
                fontSize: 10.5, fontWeight: 700, borderRadius: 999, padding: '2px 8px',
                background: main ? '#6366f1' : 'var(--c1e293b)', color: main ? '#fff' : 'var(--c94a3b8)',
                border: main ? 'none' : '1px solid var(--c334155)',
              }}>
                {main ? T('BẮT ĐẦU VỚI', 'START WITH') : T(`KÈM THEO ${i}`, `ALONGSIDE ${i}`)}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
                {ICON[p.key] ?? '•'} {p.title}
              </span>
            </div>

            {/* What the customer reads — copyable, because it goes straight into a post. */}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'flex-start',
              background: 'var(--c1e293b)', border: '1px dashed var(--c475569)', borderRadius: 9, padding: '8px 10px', marginBottom: 8,
            }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.5 }}>
                <span style={{ fontSize: 11, color: 'var(--c64748b)', fontWeight: 600 }}>{T('Nội dung ưu đãi', 'The offer')}: </span>
                {p.offer}
              </div>
              <button
                type="button"
                onClick={() => copy(p.key, p.offer)}
                style={{
                  flex: '0 0 auto', background: 'transparent', border: '1px solid var(--c334155)', borderRadius: 7,
                  color: copied === p.key ? 'var(--ink-good)' : 'var(--ink-link)', fontSize: 11.5, fontWeight: 600,
                  padding: '3px 8px', cursor: 'pointer',
                }}
              >{copied === p.key ? T('Đã chép ✓', 'Copied ✓') : T('Chép', 'Copy')}</button>
            </div>

            <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginBottom: 4 }}>
              <b style={{ color: 'var(--c94a3b8)' }}>{T('Vì sao hợp với tiệm', 'Why this shop')}:</b> {p.why}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>
              <b style={{ color: 'var(--ink-good)' }}>💵 {T('Tiền', 'The money')}:</b> {p.money}
            </div>

            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, color: 'var(--ink-link)', cursor: 'pointer', fontWeight: 600 }}>
                {T('Cách chạy cho khỏi lỗ & khi nào dừng', 'How to run it safely & when to stop')}
              </summary>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55 }}>
                {p.rules.map((r, k) => <li key={k}>{r}</li>)}
              </ul>
              <div style={{ fontSize: 12.5, color: 'var(--ink-warn)', lineHeight: 1.5, marginTop: 4 }}>
                ⏹ {T('Dừng khi', 'Stop if')}: {p.stopIf}
              </div>
            </details>
          </div>
        );
      })}

      {/* ---- what not to do, with this shop's own numbers ---- */}
      {!!s.avoid.length && (
        <div style={{
          background: 'var(--c450a0a)', border: '1px solid var(--c991b1b)', borderRadius: 10,
          padding: '9px 12px', marginTop: 4, marginBottom: 10,
        }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--cfca5a5)', marginBottom: 4 }}>
            🚫 {T('Đừng làm', 'Do not')}
          </div>
          {s.avoid.map((a, k) => (
            <div key={k} style={{ fontSize: 12.5, color: 'var(--cfca5a5)', lineHeight: 1.5, marginTop: k ? 3 : 0 }}>• {a}</div>
          ))}
        </div>
      )}

      {!!s.missing.length && (
        <div style={{ fontSize: 12, color: 'var(--cfde68a)', lineHeight: 1.5, marginBottom: 6 }}>
          {s.missing.map((x, k) => <div key={k}>ⓘ {x}</div>)}
        </div>
      )}
      <div style={{ fontSize: 11.5, color: 'var(--c64748b)', fontStyle: 'italic', lineHeight: 1.5 }}>{s.basis}</div>
    </div>
  );
}
