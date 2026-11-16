'use client';

/**
 * BÁO CÁO HIỆU QUẢ BOT — phase 2 of the bot learning over time.
 *
 * One card: how many chats, how many booked, where the rest stopped, how long
 * a booking took, what the bot could not answer — and the two or three next
 * steps that follow from those numbers. 7 / 30 / 90 days.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';
import { ind } from '../lib/ui-industry';

interface Report {
  days: number; conversations: number; booked: number; bookingRate: number | null; selfHandled?: number; selfHandledRate?: number | null;
  survey?: { asked: number; answered: number; good: number; ok: number; bad: number; happyRate: number | null }; medianMinutesToBook: number | null;
  stoppedAt: Record<'time' | 'contact' | 'confirm' | 'general' | 'noReply' | 'human', number>;
  byChannel: Record<string, { conversations: number; booked: number }>;
  unanswered: { open: number; newInPeriod: number };
  tips: { vi: string; en: string }[];
}

const STOP: [keyof Report['stoppedAt'], string, string][] = [
  ['time', 'Sau khi bot đưa giờ', 'After times were offered'],
  ['contact', 'Khi hỏi tên + SĐT', 'At name + phone'],
  ['confirm', 'Ở bước xác nhận lịch', 'At the recap / confirm'],
  ['general', 'Hỏi thông tin rồi thôi', 'Asked a question, then left'],
  ['noReply', 'Tin cuối của khách chưa được trả lời', 'Last customer message unanswered'],
  ['human', 'Nhân viên tiếp nhận', 'Handed to staff'],
];
const CH: Record<string, string> = { messenger: 'Messenger', instagram: 'Instagram', web: 'Web chat', zalo: 'Zalo' };

export function BotReportBox({ token, vi }: { token: string | null; vi: boolean }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState(false);
  // The one-tap survey after an AI booking: this salon's switch (owner / manager only — a 403 just hides it).
  const [survey, setSurvey] = useState<{ on: boolean; ask: { vi: { text: string; choices: string[] }; en: { text: string; choices: string[] } } } | null>(null);
  const [savingSurvey, setSavingSurvey] = useState(false);
  useEffect(() => {
    if (!token) return;
    apiFetch<NonNullable<typeof survey>>('/messenger/chat-survey', { token }).then(setSurvey).catch(() => setSurvey(null));
  }, [token]);
  async function toggleSurvey() {
    if (!survey || savingSurvey) return;
    setSavingSurvey(true);
    try {
      const out = await apiFetch<{ on: boolean }>('/messenger/chat-survey', { method: 'POST', token, body: { on: !survey.on } });
      setSurvey({ ...survey, on: out.on });
    } catch { /* stays as it was */ } finally { setSavingSurvey(false); }
  }
  const L = (v: string, e: string) => ind(vi ? v : e);

  useEffect(() => {
    if (!token) return;
    setErr(false);
    apiFetch<Report>(`/messenger/bot-report?days=${days}`, { token }).then(setR).catch(() => setErr(true));
  }, [token, days]);

  if (err) return null;
  const pct = r?.bookingRate == null ? '—' : `${Math.round(r.bookingRate * 100)}%`;
  const stopMax = r ? Math.max(1, ...Object.values(r.stoppedAt)) : 1;
  const tile = (label: string, value: string, sub?: string, tone?: string) => (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: tone ?? 'var(--cf1f5f9)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>📊 {L('Hiệu quả bot', 'Bot performance')}</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              style={{ padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${d === days ? '#6366f1' : 'var(--c334155)'}`, background: d === days ? 'var(--c312e81)' : 'transparent', color: 'var(--ce2e8f0)' }}>
              {d}{vi ? ' ngày' : 'd'}
            </button>
          ))}
        </div>
      </div>
      {!r ? <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
            {tile(L('Cuộc trò chuyện', 'Conversations'), String(r.conversations))}
            {r.selfHandledRate != null && tile(L('AI tự xử lý', 'Handled by AI alone'), `${Math.round(r.selfHandledRate * 100)}%`, L(`${r.selfHandled ?? 0} cuộc không cần nhân viên`, `${r.selfHandled ?? 0} chats with no staff reply`), 'var(--ink-link)')}
            {tile(L('Đã chốt lịch', 'Booked'), String(r.booked), L(`tỉ lệ ${pct}`, `rate ${pct}`), 'var(--ink-good)')}
            {tile(L('Thời gian chốt (trung vị)', 'Time to book (median)'), r.medianMinutesToBook == null ? '—' : `${r.medianMinutesToBook}′`)}
            {tile(L('Câu bot chưa biết', 'Unanswered questions'), String(r.unanswered.open), L(`+${r.unanswered.newInPeriod} mới`, `+${r.unanswered.newInPeriod} new`), r.unanswered.open ? 'var(--ink-warn)' : undefined)}
          </div>

          {r.conversations > r.booked && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', marginBottom: 6 }}>{L('Khách chưa đặt dừng ở đâu', 'Where the others stopped')}</div>
              <div style={{ display: 'grid', gap: 5 }}>
                {STOP.filter(([k]) => r.stoppedAt[k] > 0).map(([k, v, e]) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 220px) 1fr 34px', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
                    <span style={{ color: 'var(--c94a3b8)' }}>{L(v, e)}</span>
                    <span style={{ height: 8, borderRadius: 4, background: 'var(--c1e293b)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(r.stoppedAt[k] / stopMax) * 100}%`, background: '#f59e0b' }} />
                    </span>
                    <span style={{ textAlign: 'right', color: 'var(--ce2e8f0)', fontWeight: 700 }}>{r.stoppedAt[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Object.keys(r.byChannel).length > 1 && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {Object.entries(r.byChannel).map(([ch, v]) => (
                <span key={ch}>{CH[ch] ?? ch}: <b style={{ color: 'var(--ce2e8f0)' }}>{v.booked}/{v.conversations}</b></span>
              ))}
            </div>
          )}

          {survey && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10, display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>{L('Hỏi khách sau khi AI đặt lịch', 'Ask the customer after an AI booking')}</div>
                <button type="button" role="switch" aria-checked={survey.on} onClick={() => void toggleSurvey()} disabled={savingSurvey}
                  style={{ marginLeft: 'auto', minHeight: 30, padding: '0 14px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${survey.on ? '#6366f1' : 'var(--c475569)'}`, background: survey.on ? 'var(--c312e81)' : 'transparent', color: 'var(--ce2e8f0)' }}>
                  {savingSurvey ? '…' : survey.on ? L('Đang bật', 'On') : L('Đang tắt — bấm để bật', 'Off — tap to turn on')}
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>
                {L('Ngay sau khi AI đặt xong lịch trong cuộc chat, khách nhận một câu hỏi với ba nút bấm. Mỗi khách tối đa một lần trong 30 ngày.', 'Right after the AI books a visit in the chat, the customer gets one question with three buttons. At most once per customer every 30 days.')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5 }}>
                <span style={{ color: 'var(--ce2e8f0)' }}>“{(vi ? survey.ask.vi : survey.ask.en).text}”</span>
                {(vi ? survey.ask.vi : survey.ask.en).choices.map((c) => (
                  <span key={c} style={{ padding: '2px 10px', borderRadius: 999, border: '1px solid var(--c475569)', color: 'var(--ccbd5e1)' }}>{c}</span>
                ))}
              </div>
              {r.survey && r.survey.asked > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                  {tile(L('Khách hài lòng', 'Happy customers'), r.survey.happyRate == null ? '—' : `${Math.round(r.survey.happyRate * 100)}%`, L(`${r.survey.answered}/${r.survey.asked} khách trả lời`, `${r.survey.answered}/${r.survey.asked} answered`), 'var(--ink-good)')}
                  {tile(L('Hài lòng', 'Great'), String(r.survey.good))}
                  {tile(L('Bình thường', 'Okay'), String(r.survey.ok))}
                  {tile(L('Chưa ổn', 'Not good'), String(r.survey.bad), undefined, r.survey.bad ? 'var(--ink-warn)' : undefined)}
                </div>
              )}
            </div>
          )}

          {r.tips.length > 0 && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)', marginBottom: 6 }}>💡 {L('Nên làm tiếp', 'Next steps')}</div>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
                {r.tips.map((t, i) => <li key={i} style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.5 }}>{ind(vi ? t.vi : t.en)}</li>)}
              </ul>
            </div>
          )}
          {r.conversations === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 10 }}>{L('Chưa có cuộc trò chuyện nào trong khoảng này.', 'No conversations in this period yet.')}</div>}
        </>
      )}
    </div>
  );
}
