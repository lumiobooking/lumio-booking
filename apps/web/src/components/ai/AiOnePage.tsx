'use client';

/**
 * THE AI PAGE AS ONE PAGE (17/11/2026) — the parts that are new.
 *
 * On top, the owner's three questions: where is the AI answering, is it ready,
 * what should I do next. Under it, four steps in the order the work is done:
 * teach → try → switch on → watch. The sections inside each step are the ones
 * that already existed (app/salon/ai/page); this file only draws the top block,
 * the step bar and the "watch" summary. The rules are in lib/ai-readiness.
 *
 * Shown only where the release channel says so (`aiPageV2`); every other salon
 * keeps the page it had.
 */
import Link from 'next/link';
import { L } from './aiKit';
import { aiFunnel, type AiOverview, type AiTile, type ReadyGo, type ReadyItem } from '../../lib/ai-readiness';

export type AiStep = 'teach' | 'try' | 'on' | 'watch';

const card: React.CSSProperties = { border: '1px solid var(--line)', borderRadius: 14, background: 'var(--c0f172a)', padding: 16, minWidth: 0 };
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--c64748b)', margin: 0 };
const smallBtn: React.CSSProperties = { minHeight: 36, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink-link)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', flexShrink: 0 };

interface ChannelRow { k: string; name: string; sub: string; state: 'on' | 'off' | 'connect'; href: string }

/** Every place the AI can answer, with what it is doing there now. */
export function channelRows(o: { vi: boolean; ov: AiOverview; voice: { provisioned: boolean; enabled: boolean; number: string | null } }): ChannelRow[] {
  const { vi, ov } = o;
  const chat = (names: string[]): Pick<ChannelRow, 'sub' | 'state'> => (names.length
    ? { sub: names.join(', '), state: ov.aiOn ? 'on' : 'off' }
    : { sub: L(vi, 'chưa nối', 'not connected'), state: 'connect' });
  return [
    { k: 'messenger', name: 'Messenger', href: '/salon/channels', ...chat(ov.channels.messenger) },
    { k: 'instagram', name: 'Instagram', href: '/salon/channels', ...chat(ov.channels.instagram) },
    { k: 'web', name: L(vi, 'Khung chat trên website', 'Website chat'), href: '/salon/messenger', sub: ov.channels.web ? L(vi, 'đã có khách nhắn', 'in use') : L(vi, 'chưa dùng', 'not in use'), state: ov.channels.web ? 'on' : 'connect' },
    { k: 'zalo', name: 'Zalo', href: '/salon/channels', ...chat(ov.channels.zalo) },
    { k: 'voice', name: L(vi, 'Tổng đài điện thoại', 'Phone line'), href: '/salon/voice',
      sub: o.voice.provisioned ? (o.voice.number ?? '') : L(vi, 'chưa có số', 'no number'),
      state: !o.voice.provisioned ? 'connect' : o.voice.enabled ? 'on' : 'off' },
  ];
}

export function AiTop({ vi, ov, voice, ready, tiles, onGo }: {
  vi: boolean; ov: AiOverview; voice: { provisioned: boolean; enabled: boolean; number: string | null };
  ready: ReadyItem[]; tiles: AiTile[]; onGo: (go: ReadyGo) => void;
}) {
  const rows = channelRows({ vi, ov, voice });
  const okCount = ready.filter((r) => r.ok).length;
  const stateText = (s: ChannelRow['state']) => (s === 'on' ? L(vi, 'Đang bật', 'On') : s === 'off' ? L(vi, 'Đang tắt', 'Off') : L(vi, 'Nối kênh', 'Connect'));
  return (
    <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14 }}>
        <section aria-label={L(vi, 'AI đang trả lời ở đâu', 'Where the AI is answering')} style={card}>
          <p style={eyebrow}>{L(vi, 'AI đang trả lời ở đâu', 'Where the AI is answering')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', marginTop: 8 }}>
            {rows.map((r, i) => (
              <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.state === 'on' ? '#16a34a' : r.state === 'off' ? '#d97706' : 'var(--c475569)' }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <strong style={{ fontWeight: 600 }}>{r.name}</strong>{r.sub ? <span style={{ color: 'var(--c94a3b8)' }}> · {r.sub}</span> : null}
                </span>
                {r.state === 'connect'
                  ? <Link href={r.href} style={{ ...smallBtn, minHeight: 32 }}>{stateText(r.state)}</Link>
                  : <span style={{ fontSize: 12.5, fontWeight: 700, color: r.state === 'on' ? 'var(--ink-good)' : 'var(--ink-warn)', whiteSpace: 'nowrap' }}>{stateText(r.state)}</span>}
              </div>
            ))}
          </div>
        </section>

        <section aria-label={L(vi, 'Mức sẵn sàng', 'Readiness')} style={card}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <p style={{ ...eyebrow, flex: 1 }}>{L(vi, 'Mức sẵn sàng', 'Readiness')}</p>
            <span style={{ fontSize: 22, fontWeight: 800, color: okCount === ready.length ? 'var(--ink-good)' : 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{okCount} / {ready.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', marginTop: 6 }}>
            {ready.map((r, i) => (
              <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '4px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, background: r.ok ? 'var(--c064e3b)' : 'var(--wash-amber-3)', color: r.ok ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{r.ok ? '✓' : '!'}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.4, color: r.ok ? 'var(--c94a3b8)' : 'var(--ce2e8f0)', fontWeight: r.ok ? 400 : 600, overflowWrap: 'anywhere' }}>
                  <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{r.ok ? L(vi, 'Đạt: ', 'OK: ') : L(vi, 'Cần làm: ', 'To do: ')}</span>{vi ? r.vi : r.en}
                </span>
                {!r.ok && r.go && (r.go === 'channels'
                  ? <Link href="/salon/channels" style={smallBtn}>{vi ? r.goVi : r.goEn}</Link>
                  : <button type="button" onClick={() => onGo(r.go as ReadyGo)} style={smallBtn}>{vi ? r.goVi : r.goEn}</button>)}
              </div>
            ))}
          </div>
        </section>
      </div>

      <section aria-label={L(vi, 'Số liệu', 'Numbers')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {tiles.map((t) => (
          <div key={t.k} style={{ ...card, padding: '12px 14px' }}>
            <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.35 }}>{vi ? t.vi : t.en}</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, fontVariantNumeric: 'tabular-nums', color: t.tone === 'warn' ? 'var(--ink-warn)' : t.tone === 'good' ? 'var(--ink-good)' : 'var(--cf1f5f9)' }}>{vi ? t.value : t.value.replace(' giây', 's')}</div>
            {(t.subVi || t.subEn) && <div style={{ fontSize: 12, color: 'var(--c64748b)', marginTop: 2 }}>{vi ? t.subVi : t.subEn}</div>}
          </div>
        ))}
      </section>
    </div>
  );
}

export function AiStepBar({ vi, step, subs, onPick }: { vi: boolean; step: AiStep; subs: Record<AiStep, string>; onPick: (s: AiStep) => void }) {
  const steps: { id: AiStep; vi: string; en: string }[] = [
    { id: 'teach', vi: 'Dạy', en: 'Teach' }, { id: 'try', vi: 'Thử', en: 'Try' }, { id: 'on', vi: 'Bật', en: 'Switch on' }, { id: 'watch', vi: 'Theo dõi', en: 'Watch' },
  ];
  return (
    <div role="tablist" aria-label={L(vi, 'Bốn bước làm việc với AI', 'Four steps of working with the AI')} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 18 }}>
      {steps.map((s, i) => {
        const on = s.id === step;
        return (
          <button key={s.id} type="button" role="tab" aria-selected={on} onClick={() => onPick(s.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 60, padding: '8px 12px', borderRadius: 14, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0,
              border: `1px solid ${on ? '#6366f1' : 'var(--line)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)' }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, fontWeight: 800, background: on ? '#4f46e5' : 'var(--c1e293b)', color: on ? '#fff' : 'var(--c94a3b8)' }}>{i + 1}</span>
            <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.3 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: on ? 'var(--ca5b4fc)' : 'var(--ce2e8f0)' }}>{vi ? s.vi : s.en}</span>
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subs[s.id]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Step 4, on top: where the period's conversations went, and what deserves a look right now. */
export function AiWatch({ vi, ov }: { vi: boolean; ov: AiOverview }) {
  const n = ov.numbers;
  const rows = aiFunnel(n, ov.pageKind);
  const max = rows.reduce((m, r) => Math.max(m, r.n), 1);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 14, marginBottom: 16 }}>
      <section style={card}>
        <p style={eyebrow}>{L(vi, `${n.conversations} cuộc trò chuyện đi tới đâu · ${n.days} ngày`, `Where ${n.conversations} conversations went · ${n.days} days`)}</p>
        {rows.length === 0
          ? <p style={{ fontSize: 13.5, color: 'var(--c94a3b8)', margin: '10px 0 0' }}>{L(vi, 'Chưa có cuộc trò chuyện nào trong khoảng này.', 'No conversations in this period yet.')}</p>
          : (
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              {rows.map((r) => (
                <div key={r.k} style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13.5, color: 'var(--ce2e8f0)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{vi ? r.vi : r.en}</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{r.n}</strong>
                  </div>
                  <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: 'var(--c1e293b)' }}>
                    <div style={{ height: 6, borderRadius: 999, width: `${Math.max(2, Math.round((r.n / max) * 100))}%`, background: r.k === 'self' ? '#16a34a' : r.k === 'noReply' ? '#dc2626' : '#6366f1' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        <p style={{ fontSize: 12, color: 'var(--c64748b)', margin: '12px 0 0', lineHeight: 1.5 }}>{L(vi, 'Một cuộc có thể nằm ở hai dòng.', 'A conversation can be on two lines.')}</p>
      </section>
      <section style={card}>
        <p style={eyebrow}>{L(vi, 'Nên xem ngay', 'Worth a look now')}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.4, color: 'var(--ce2e8f0)', fontWeight: n.waitingNow ? 600 : 400 }}>
              {n.waitingNow ? L(vi, `${n.waitingNow} khách nhắn cuối chưa được trả lời`, `${n.waitingNow} customers wrote last and have no answer`) : L(vi, 'Không khách nào đang chờ câu trả lời', 'No customer is waiting for an answer')}
            </span>
            <Link href="/salon/inbox" style={smallBtn}>{L(vi, 'Mở hộp thư', 'Open the inbox')}</Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 52, borderTop: '1px solid var(--line)' }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.4, color: 'var(--ce2e8f0)' }}>
              {L(vi, 'Câu trả lời nêu con số chưa thấy nguồn có nút màu cam trong Hộp thư. Sai thì bấm “Sửa” để dạy AI.', 'Replies that state a number with no source carry an amber button in the Inbox. Press “Fix” to teach the AI.')}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
