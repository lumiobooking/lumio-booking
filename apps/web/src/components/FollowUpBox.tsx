'use client';

/**
 * NHẮN LẠI KHÁCH IM LẶNG — each salon's own switch.
 *
 * A booking chat that goes quiet ("What name and phone number…?" and then
 * nothing) gets one short, polite follow-up that picks up where the customer
 * stopped. OFF until the salon turns it on here: messages to a salon's
 * customers are the salon's decision. The server applies the rest — only
 * inside Meta's 24-hour window, never after a booking, never over a staff
 * member, never to someone who said "stop", only inside the hours set here.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

interface FollowUp { enabled: boolean; firstAfterMin: number; secondAfterMin: number; maxPerWindow: number; hourFrom: number; hourTo: number }

const FIRST = [15, 30, 45, 60, 90, 120, 180];
const SECOND = [0, 120, 240, 360];
const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

export function FollowUpBox({ token, vi }: { token: string | null; vi: boolean }) {
  const [s, setS] = useState<FollowUp | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const L = (v: string, e: string) => (vi ? v : e);

  useEffect(() => {
    if (!token) return;
    apiFetch<FollowUp>('/settings/chat-followup', { token }).then((r) => setS(r)).catch(() => setState('error'));
  }, [token]);

  async function save(patch: Partial<FollowUp>) {
    if (!token || !s) return;
    const optimistic = { ...s, ...patch };
    setS(optimistic);
    setState('saving');
    try {
      const r = await apiFetch<FollowUp>('/settings/chat-followup', { method: 'PATCH', token, body: patch });
      setS(r); setState('saved'); window.setTimeout(() => setState('idle'), 1800);
    } catch { setState('error'); }
  }

  const minLabel = (m: number) => m < 60 ? L(`${m} phút`, `${m} min`) : L(`${String(m / 60).replace('.', ',')} giờ`, `${m / 60} h`);
  const on = !!s?.enabled;

  return (
    <div style={{ ...ui.card, borderColor: on ? 'rgba(34,197,94,0.45)' : 'var(--c334155)', marginTop: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>
          🔁 {L('Tự động nhắn lại khách im lặng', 'Follow up quiet customers')}
        </div>
        <button type="button" role="switch" aria-checked={on} disabled={!s}
          onClick={() => s && save({ enabled: !on })}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, cursor: s ? 'pointer' : 'default',
            border: `1px solid ${on ? 'rgba(34,197,94,0.6)' : 'var(--c475569)'}`, background: on ? 'rgba(34,197,94,0.14)' : 'transparent',
            color: on ? 'var(--ink-good)' : 'var(--c94a3b8)', fontSize: 13, fontWeight: 700,
          }}>
          <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? 'rgba(34,197,94,0.85)' : 'var(--c334155)', position: 'relative', transition: 'background .15s' }}>
            <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: 'var(--cf8fafc)', transition: 'left .15s' }} />
          </span>
          {on ? L('Đang bật', 'On') : L('Đang tắt', 'Off')}
        </button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '8px 0 0', lineHeight: 1.55 }}>
        {L('Khách đang đặt lịch dở dang rồi im lặng (chưa gửi tên, số điện thoại, hoặc chưa trả lời xác nhận), bot sẽ nhắn lại một tin ngắn, đúng chỗ khách đang dừng. Chỉ trên Messenger và Instagram.',
          'When a customer goes quiet mid-booking (no name or phone yet, or no answer to the confirmation), the bot sends one short follow-up that picks up where they stopped. Messenger and Instagram only.')}
      </p>

      {on && s && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginTop: 14 }}>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ ...ui.label, margin: 0 }}>{L('Nhắn lại sau khi khách im lặng', 'Follow up after quiet for')}</span>
            <select value={s.firstAfterMin} onChange={(e) => save({ firstAfterMin: Number(e.target.value) })} style={ui.input}>
              {FIRST.map((m) => <option key={m} value={m}>{minLabel(m)}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ ...ui.label, margin: 0 }}>{L('Lần nhắn thứ 2', 'Second follow-up')}</span>
            <select value={s.secondAfterMin} onChange={(e) => save({ secondAfterMin: Number(e.target.value) })} style={ui.input}>
              {SECOND.map((m) => <option key={m} value={m}>{m === 0 ? L('Không nhắn lần 2', 'None') : L(`${m / 60} giờ sau lần 1`, `${m / 60} h after the first`)}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ ...ui.label, margin: 0 }}>{L('Chỉ nhắn từ', 'Only from')}</span>
            <select value={s.hourFrom} onChange={(e) => save({ hourFrom: Number(e.target.value) })} style={ui.input}>
              {Array.from({ length: 24 }, (_, h) => h).filter((h) => h < s.hourTo).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5 }}>
            <span style={{ ...ui.label, margin: 0 }}>{L('Đến', 'Until')}</span>
            <select value={s.hourTo} onChange={(e) => save({ hourTo: Number(e.target.value) })} style={ui.input}>
              {Array.from({ length: 24 }, (_, i) => i + 1).filter((h) => h > s.hourFrom).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </label>
        </div>
      )}

      {on && (
        <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.30)', fontSize: 12.5, lineHeight: 1.55, color: 'var(--ccbd5e1)' }}>
          <div style={{ fontWeight: 700, color: 'var(--cc7d2fe)', marginBottom: 4 }}>{L('Ví dụ tin nhắn lại', 'Example follow-up')}</div>
          {L('"Dạ anh/chị ơi, anh/chị gửi em tên và số điện thoại là em giữ lịch cho mình liền nhé 😊"',
            '"Just checking in — send me your name and phone number and I will get your appointment set up 😊"')}
        </div>
      )}

      <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.6 }}>
        <li>{L('Không nhắn khi khách đã đặt lịch, khi nhân viên đang trả lời, hoặc khi khách nói đừng nhắn nữa.', 'Never after a booking, never while a staff member is handling the chat, never to someone who asked not to be messaged.')}</li>
        <li>{L('Chỉ trong 24 giờ kể từ tin cuối của khách — quy định của Meta để tránh bị khoá trang.', 'Only within 24 hours of the customer’s last message — Meta’s rule, which keeps the Page safe.')}</li>
      </ul>

      <div style={{ marginTop: 8, fontSize: 12, textAlign: 'right', color: state === 'error' ? 'var(--ink-bad)' : state === 'saved' ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>
        {state === 'saving' ? L('Đang lưu…', 'Saving…') : state === 'saved' ? L('Đã lưu', 'Saved') : state === 'error' ? L('Không lưu được', 'Could not save') : ''}
      </div>
    </div>
  );
}
