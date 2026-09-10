'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { useLang } from '../lib/i18n';

/**
 * Chat on the salon's own website — the bot's fourth mouth.
 *
 * Same brain as Messenger, Instagram and Zalo; the difference is that there
 * is nothing to connect. The salon flips the switch, pastes one line into
 * its site, and visitors who would rather type than call get answered and
 * booked. Conversations land in the same Inbox, marked "Website".
 *
 * Its own switch, deliberately: a salon may want chat on its site without a
 * Facebook bot, or the reverse.
 */
export function WebChatPanel({ token }: { token: string | null }) {
  type Status = {
    enabled: boolean; color: string; greeting: string; position: 'right' | 'left'; offsetY?: number; size?: number;
    slug: string; snippet: string; widgetUrl: string; brainReady: boolean; conversations: number;
  };
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [st, setSt] = useState<Status | null>(null);
  const [draft, setDraft] = useState<{ color: string; greeting: string; position: 'right' | 'left'; offsetY: number; size: number }>({ color: '#6366f1', greeting: '', position: 'right', offsetY: 20, size: 58 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<Status>('/messenger/webchat', { token })
      .then((s) => { if (!alive) return; setSt(s); setDraft({ color: s.color, greeting: s.greeting, position: s.position, offsetY: s.offsetY ?? 20, size: s.size ?? 58 }); })
      .catch(() => { if (alive) setSt(null); });
    return () => { alive = false; };
  }, [token]);

  if (!st) return null;

  const save = async (patch: Record<string, unknown>, okText: string) => {
    setBusy(true); setMsg(null);
    try {
      const s = await apiFetch<Status>('/messenger/webchat', { method: 'POST', token, body: patch });
      setSt(s); setDraft({ color: s.color, greeting: s.greeting, position: s.position, offsetY: s.offsetY ?? 20, size: s.size ?? 58 });
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : (vi ? 'Không lưu được' : 'Could not save') });
    } finally { setBusy(false); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(st.snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the box is selectable */ }
  };

  const T = (v: string, e: string) => (vi ? v : e);

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--ce2e8f0)' }}>
          🌐 {T('Chat trên website của tiệm', 'Chat on your website')}
        </div>
        {st.enabled
          ? <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>● {T('ĐANG BẬT', 'ON')}{st.conversations ? ` · ${st.conversations} ${T('cuộc trò chuyện', 'conversations')}` : ''}</span>
          : <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{T('đang tắt', 'off')}</span>}
        <button
          onClick={() => save({ enabled: !st.enabled }, st.enabled ? T('Đã tắt chat trên website.', 'Website chat is off.') : T('Đã bật — dán đoạn mã bên dưới vào website là chạy.', 'On — paste the line below into your site.'))}
          disabled={busy}
          style={{ ...ui.primaryBtn, marginLeft: 'auto', background: st.enabled ? 'var(--c334155)' : '#22c55e', color: st.enabled ? 'var(--ce2e8f0)' : '#052e16' }}
        >
          {st.enabled ? T('Tắt chat web', 'Turn off') : T('Bật chat web', 'Turn on')}
        </button>
      </div>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: '6px 0 12px', lineHeight: 1.55 }}>
        {T('Khách vào website muốn nhắn thay vì gọi: một nút chat ở góc trang, cùng bộ não AI đang trả lời Messenger — tư vấn, báo giá, chốt lịch. Tin hiện trong Hộp thư với nhãn "Website", nhân viên nhận chat y như các kênh khác.',
           'Visitors who would rather type than call get a chat bubble on your site, answered by the same AI that runs Messenger — it quotes, advises and books. Chats land in the Inbox tagged "Website"; staff can take over like any other channel.')}
      </p>

      {msg && (
        <div style={{ fontSize: 12.5, color: msg.ok ? '#4ade80' : '#f87171', marginBottom: 10 }}>{msg.text}</div>
      )}

      {st.enabled && (
        <>
          <div style={{ marginBottom: 12 }}>
            <label style={ui.label}>{T('Dán 1 dòng này vào website (trước thẻ </body>, hoặc mục "Custom code / Header & Footer" của WordPress, Wix, Squarespace…)', 'Paste this one line into your website (before </body>, or the "custom code / header & footer" box in WordPress, Wix, Squarespace…)')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <code
                onClick={(e) => { const r = document.createRange(); r.selectNodeContents(e.currentTarget); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r); }}
                style={{ flex: 1, display: 'block', padding: '9px 11px', borderRadius: 8, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ca5b4fc)', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all', cursor: 'text' }}
              >{st.snippet}</code>
              <button onClick={copy} style={{ ...ui.primaryBtn, whiteSpace: 'nowrap' }}>{copied ? '✓' : T('Chép', 'Copy')}</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div>
              <label style={ui.label}>{T('Màu nút chat', 'Bubble colour')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} style={{ width: 44, height: 36, padding: 2, border: '1px solid var(--c334155)', borderRadius: 8, background: 'transparent', cursor: 'pointer' }} />
                <input value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} style={{ ...ui.input, maxWidth: 120 }} />
              </div>
            </div>
            <div>
              <label style={ui.label}>{T('Góc hiển thị', 'Corner')}</label>
              <select value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value === 'left' ? 'left' : 'right' })} style={ui.input}>
                <option value="right">{T('Phải dưới', 'Bottom right')}</option>
                <option value="left">{T('Trái dưới', 'Bottom left')}</option>
              </select>
            </div>
          </div>

          {/* Where the bubble sits, and how big.
              A salon's site already has furniture in that corner — a
              back-to-top arrow, a cookie bar, a sticky "Book now" on the
              phone — and whichever was added last wins it. Rather than pick a
              number that suits every theme, the person who set the site up
              slides ours out of the way and watches it move. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 12 }}>
            <div>
              <label style={ui.label}>
                {T('Cách đáy trang', 'Distance from the bottom')} — <b style={{ color: 'var(--ce2e8f0)' }}>{draft.offsetY}px</b>
              </label>
              <input
                type="range" min={0} max={240} step={4}
                value={draft.offsetY}
                onChange={(e) => setDraft({ ...draft, offsetY: Number(e.target.value) })}
                style={{ width: '100%', accentColor: draft.color }}
              />
              <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>
                {T('Nâng lên khi nút bị che bởi nút "Lên đầu trang", thanh cookie hay nút đặt lịch dính đáy.',
                   'Raise it when a back-to-top arrow, a cookie bar or a sticky booking button covers it.')}
              </div>
            </div>
            <div>
              <label style={ui.label}>
                {T('Cỡ nút', 'Bubble size')} — <b style={{ color: 'var(--ce2e8f0)' }}>{draft.size}px</b>
              </label>
              <input
                type="range" min={40} max={80} step={2}
                value={draft.size}
                onChange={(e) => setDraft({ ...draft, size: Number(e.target.value) })}
                style={{ width: '100%', accentColor: draft.color }}
              />
              <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>
                {T('Mặc định 58px. Nhỏ hơn cho trang gọn, lớn hơn cho trang nhiều nội dung.',
                   'Default 58px. Smaller for a quiet page, larger for a busy one.')}
              </div>
            </div>
          </div>

          {/* The bubble at its real size, in the corner it will really use. */}
          <div style={{
            position: 'relative', height: 132, marginTop: 12, borderRadius: 10, overflow: 'hidden',
            background: 'var(--c0f172a)', border: '1px dashed var(--c334155)',
          }}>
            <div style={{ position: 'absolute', top: 8, left: 10, fontSize: 11.5, color: 'var(--c64748b)' }}>
              {T('Xem thử — góc dưới trang web của tiệm', 'Preview — the corner of the salon’s site')}
            </div>
            <div
              aria-hidden
              style={{
                position: 'absolute',
                bottom: Math.min(draft.offsetY, 132 - draft.size - 6),
                [draft.position]: 16,
                width: draft.size, height: draft.size, borderRadius: '50%',
                background: draft.color, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: Math.round(draft.size * 0.48), height: Math.round(draft.size * 0.48) }}>
                <path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.2-4.2A8 8 0 1 1 21 12z" />
              </svg>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={ui.label}>{T('Câu chào đầu tiên (tuỳ chọn)', 'Opening line (optional)')}</label>
            <input
              value={draft.greeting}
              placeholder={T('vd: Chào bạn! Em là Linh ở Lux Nail — bạn muốn xem giá hay đặt lịch ạ?', 'e.g. Hi! This is Linh at Lux Nail — want prices or a time?')}
              onChange={(e) => setDraft({ ...draft, greeting: e.target.value })}
              style={ui.input}
            />
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12 }}>
            <button onClick={() => save({ color: draft.color, greeting: draft.greeting, position: draft.position, offsetY: draft.offsetY, size: draft.size }, T('Đã lưu — website cập nhật trong vài phút.', 'Saved — your site picks it up within minutes.'))} disabled={busy} style={ui.primaryBtn}>
              {T('Lưu giao diện', 'Save look')}
            </button>
            <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>
              {T('Bot xưng tên và cách nói chuyện lấy từ phần "Cách bot trả lời" bên dưới.', 'The bot’s name and manner come from “Bot behaviour” below.')}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
