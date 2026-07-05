'use client';

// Salon-admin page for the AI voice hotline. The salon keeps its OWN public
// number and forwards it (on no-answer/busy) to the assigned Lumio number, which
// the AI answers, books, and confirms by text.

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface VConf {
  provisioned: boolean; lumioNumber: string; enabled: boolean; greeting: string;
  language: string; aiInstruction: string; aiEnabled: boolean; webhookUrl: string; calls: number;
}
interface VCall {
  id: string; fromNumber: string | null; outcome: string; appointmentId: string | null;
  durationSec: number | null; createdAt: string;
}
interface VUsage { periodStart: string; aiCalls: number; aiMinutes: number; smsSent: number }

type Lang = 'vi' | 'en';
const SUPPORT_EMAIL = 'lumioagency.com@gmail.com';

const DICT: Record<string, { vi: string; en: string }> = {
  title: { vi: 'Tổng đài AI — Trả lời & đặt lịch qua điện thoại', en: 'AI Hotline — phone answering & booking' },
  subtitle: {
    vi: 'Giữ nguyên số của tiệm. Khi không ai bắt máy, cuộc gọi được chuyển sang trợ lý AI để trả lời và đặt lịch, rồi nhắn tin xác nhận cho khách.',
    en: 'Keep your own number. When no one picks up, calls forward to the AI assistant, which answers, books, and texts a confirmation.',
  },
  loading: { vi: 'Đang tải…', en: 'Loading…' },
  statusTitle: { vi: 'Số tổng đài AI của bạn', en: 'Your AI hotline number' },
  notProvisioned: {
    vi: 'Chưa được cấp số tổng đài. Liên hệ Lumio để kích hoạt tính năng này cho tiệm của bạn.',
    en: 'No hotline number assigned yet. Contact Lumio to activate this feature for your salon.',
  },
  contact: { vi: 'Liên hệ Lumio', en: 'Contact Lumio' },
  copy: { vi: 'Sao chép', en: 'Copy' },
  copied: { vi: 'Đã chép ✓', en: 'Copied ✓' },
  enable: { vi: 'Bật tổng đài AI', en: 'Enable AI hotline' },
  enabledOn: { vi: 'Đang bật', en: 'On' },
  enabledOff: { vi: 'Đang tắt', en: 'Off' },
  forwardTitle: { vi: 'Cách chuyển hướng số tiệm sang tổng đài AI', en: 'How to forward your salon number to the AI hotline' },
  forwardIntro: {
    vi: 'Cài “chuyển hướng khi không trả lời” trên số của tiệm để nhân viên vẫn bắt máy trước; sau vài hồi chuông không ai nghe thì mới sang AI.',
    en: 'Set “forward on no answer” on your salon line so staff still pick up first; after a few rings with no answer, calls go to the AI.',
  },
  forwardCodes: {
    vi: 'Số cố định (landline) — bấm từ máy bàn của tiệm (mã có thể khác theo nhà mạng):',
    en: 'Landline — dial from the salon phone (codes vary by carrier):',
  },
  codeNoAnswer: { vi: 'Chuyển khi KHÔNG trả lời:', en: 'Forward on NO answer:' },
  codeBusy: { vi: 'Chuyển khi máy BẬN:', en: 'Forward on BUSY:' },
  codeOff: { vi: 'Tắt chuyển hướng:', en: 'Turn forwarding off:' },
  forwardVoip: {
    vi: 'Dùng tổng đài VoIP (RingCentral, Ooma, Google Voice…)? Vào phần Cài đặt cuộc gọi → Chuyển hướng khi không trả lời → nhập số Lumio ở trên.',
    en: 'On a VoIP phone system (RingCentral, Ooma, Google Voice…)? Go to Call Settings → Forward on no-answer → enter the Lumio number above.',
  },
  forwardHelp: {
    vi: 'Không chắc mã của nhà mạng? Gọi nhà mạng và nói “conditional call forwarding on no answer”, đưa số Lumio ở trên.',
    en: 'Not sure of your carrier code? Call your carrier and ask for “conditional call forwarding on no answer” to the Lumio number above.',
  },
  behaviorTitle: { vi: 'Cách tổng đài trả lời', en: 'How the hotline behaves' },
  greeting: { vi: 'Lời chào (tùy chọn)', en: 'Greeting (optional)' },
  greetingPh: { vi: 'vd: Cảm ơn đã gọi! Tôi có thể giúp đặt lịch cho bạn.', en: 'e.g. Thanks for calling! How can I help you book?' },
  greetingHint: {
    vi: 'Hệ thống tự thêm câu thông báo “đây là trợ lý tự động” trước lời chào (theo luật). Để trống sẽ dùng lời chào mặc định.',
    en: 'We automatically add an “automated assistant” disclosure before your greeting (required by law). Leave blank for the default.',
  },
  language: { vi: 'Ngôn ngữ nghe & nói', en: 'Listening & speaking language' },
  langEn: { vi: 'Tiếng Anh (US)', en: 'English (US)' },
  langVi: { vi: 'Tiếng Việt', en: 'Vietnamese' },
  aiInstruction: { vi: 'Ghi chú thêm cho trợ lý (tùy chọn)', en: 'Extra notes for the assistant (optional)' },
  aiInstructionPh: { vi: 'vd: luôn mời khách thử dịch vụ dip; cuối tuần rất đông.', en: 'e.g. always suggest dip powder; weekends are very busy.' },
  faqReuse: {
    vi: 'Tổng đài dùng chung phần thông tin doanh nghiệp bạn đã khai ở “Messenger bot” (giờ mở cửa, đỗ xe, thanh toán…).',
    en: 'The hotline reuses the business info you set under “Messenger bot” (hours, parking, payment…).',
  },
  save: { vi: 'Lưu', en: 'Save' },
  saving: { vi: 'Đang lưu…', en: 'Saving…' },
  saved: { vi: 'Đã lưu ✓', en: 'Saved ✓' },
  aiOff: {
    vi: 'Trợ lý AI chưa được cấu hình (thiếu khóa AI). Liên hệ Lumio.',
    en: 'The AI assistant is not configured (missing AI key). Contact Lumio.',
  },
  needProvision: { vi: 'Cần được Lumio cấp số trước khi bật.', en: 'Lumio must assign a number before you can enable it.' },
  usageTitle: { vi: 'Sử dụng tháng này', en: 'Usage this month' },
  usageCalls: { vi: 'Cuộc gọi AI', en: 'AI calls' },
  usageMinutes: { vi: 'Phút AI', en: 'AI minutes' },
  usageSms: { vi: 'SMS đã gửi', en: 'SMS sent' },
  usageNote: { vi: 'Tính từ đầu tháng. Phút dựa trên thời lượng cuộc gọi thực tế; SMS là tin đã gửi thành công.', en: 'Since the 1st. Minutes are based on actual call length; SMS counts messages sent successfully.' },
  callsTitle: { vi: 'Cuộc gọi gần đây', en: 'Recent calls' },
  noCalls: { vi: 'Chưa có cuộc gọi nào.', en: 'No calls yet.' },
  colFrom: { vi: 'Từ số', en: 'From' },
  colOutcome: { vi: 'Kết quả', en: 'Outcome' },
  colWhen: { vi: 'Thời gian', en: 'When' },
  complianceNote: {
    vi: 'Khách luôn được thông báo đang nói với trợ lý tự động. Mặc định KHÔNG ghi âm cuộc gọi (chỉ lưu nội dung để đặt lịch).',
    en: 'Callers are always told they are speaking with an automated assistant. Calls are NOT recorded by default (we store only the text needed to book).',
  },
};

const OUTCOME: Record<string, { vi: string; en: string; color: string }> = {
  booked: { vi: 'Đã đặt lịch', en: 'Booked', color: '#22c55e' },
  info: { vi: 'Trả lời câu hỏi', en: 'Answered', color: '#60a5fa' },
  no_action: { vi: 'Không đặt', en: 'No booking', color: '#94a3b8' },
  handoff: { vi: 'Chuyển người', en: 'Handoff', color: '#f59e0b' },
  in_progress: { vi: 'Đang gọi', en: 'In progress', color: '#a78bfa' },
  error: { vi: 'Lỗi', en: 'Error', color: '#ef4444' },
};

export default function VoicePage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => DICT[k]?.[lang as Lang] ?? k;

  const [c, setC] = useState<VConf | null>(null);
  const [calls, setCalls] = useState<VCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [usage, setUsage] = useState<VUsage | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [conf, cl, us] = await Promise.all([
        apiFetch<VConf>('/voice', { token }),
        apiFetch<VCall[]>('/voice/calls', { token }).catch(() => [] as VCall[]),
        apiFetch<VUsage>('/voice/usage', { token }).catch(() => null),
      ]);
      setC(conf); setCalls(cl); setUsage(us);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<VConf>) {
    if (!c) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = await apiFetch<VConf>('/voice/settings', { method: 'POST', token, body: {
        enabled: c.enabled, greeting: c.greeting, language: c.language, aiInstruction: c.aiInstruction, ...patch,
      } });
      setC(next); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  function copyNum() {
    if (!c?.lumioNumber) return;
    try { navigator.clipboard?.writeText(c.lumioNumber); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  }
  const fmtWhen = (iso: string) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
  const outc = (o: string) => OUTCOME[o] || OUTCOME.no_action;

  if (loading || !c) {
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('title')}</h1><p style={{ color: '#94a3b8' }}>{t('loading')}</p></section>;
  }

  return (
    <section style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('subtitle')}</p>
      {error && <div style={ui.banner}>{error}</div>}
      {!c.aiEnabled && <div style={{ ...ui.card, marginBottom: 16, borderColor: '#f59e0b', color: '#fde68a', fontSize: 13.5 }}>{t('aiOff')}</div>}

      {/* Assigned number + enable */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{t('statusTitle')}</div>
        {!c.provisioned ? (
          <div style={{ fontSize: 14, color: '#fca5a5' }}>
            {t('notProvisioned')}{' '}
            <a href={`mailto:${SUPPORT_EMAIL}?subject=AI%20Hotline%20activation`} style={{ color: '#a5b4fc' }}>{t('contact')} →</a>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: '#a5b4fc', letterSpacing: 0.5 }}>{c.lumioNumber}</span>
              <button onClick={copyNum} style={{ ...ui.primaryBtn, background: copied ? '#22c55e' : '#334155' }}>{copied ? t('copied') : t('copy')}</button>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 14, color: '#e2e8f0' }}>
              <input type="checkbox" checked={c.enabled} disabled={saving} onChange={(e) => save({ enabled: e.target.checked })}
                style={{ width: 18, height: 18, accentColor: '#6366f1', cursor: 'pointer' }} />
              {t('enable')} — <span style={{ color: c.enabled ? '#22c55e' : '#94a3b8', fontWeight: 700 }}>{c.enabled ? t('enabledOn') : t('enabledOff')}</span>
            </label>
          </>
        )}
      </div>

      {/* Usage this month */}
      {usage && (
        <div style={{ ...ui.card, marginBottom: 16 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('usageTitle')}</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Stat label={t('usageCalls')} value={usage.aiCalls} />
            <Stat label={t('usageMinutes')} value={usage.aiMinutes} />
            <Stat label={t('usageSms')} value={usage.smsSent} />
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>{t('usageNote')}</div>
        </div>
      )}

      {/* Forwarding instructions */}
      {c.provisioned && (
        <div style={{ ...ui.card, marginBottom: 16, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.65 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>{t('forwardTitle')}</div>
          <p style={{ margin: '0 0 12px' }}>{t('forwardIntro')}</p>
          <div style={{ fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>{t('forwardCodes')}</div>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
            <li>{t('codeNoAnswer')} <code style={codeS}>*92 {c.lumioNumber}</code></li>
            <li>{t('codeBusy')} <code style={codeS}>*90 {c.lumioNumber}</code></li>
            <li>{t('codeOff')} <code style={codeS}>*93</code> / <code style={codeS}>*91</code></li>
          </ul>
          <p style={{ margin: '0 0 8px' }}>{t('forwardVoip')}</p>
          <p style={{ margin: 0, color: '#94a3b8' }}>{t('forwardHelp')}</p>
        </div>
      )}

      {/* Behavior settings */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('behaviorTitle')}</div>

        <label style={ui.label}>{t('greeting')}</label>
        <input value={c.greeting} onChange={(e) => setC({ ...c, greeting: e.target.value })} placeholder={t('greetingPh')} style={{ ...ui.input, marginBottom: 6 }} />
        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>{t('greetingHint')}</div>

        <label style={ui.label}>{t('language')}</label>
        <select value={c.language} onChange={(e) => setC({ ...c, language: e.target.value })} style={{ ...ui.input, marginBottom: 14 }}>
          <option value="en-US">{t('langEn')}</option>
          <option value="vi-VN">{t('langVi')}</option>
        </select>

        <label style={ui.label}>{t('aiInstruction')}</label>
        <textarea value={c.aiInstruction} onChange={(e) => setC({ ...c, aiInstruction: e.target.value })} placeholder={t('aiInstructionPh')}
          rows={3} style={{ ...ui.input, marginBottom: 10, resize: 'vertical' }} />

        <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 14 }}>{t('faqReuse')}</div>

        <button onClick={() => save({})} disabled={saving} style={{ ...ui.primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? t('saving') : saved ? t('saved') : t('save')}
        </button>
      </div>

      {/* Recent calls */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('callsTitle')}</div>
        {calls.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13.5 }}>{t('noCalls')}</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #334155' }}>
                  <th style={ui.th}>{t('colFrom')}</th>
                  <th style={ui.th}>{t('colOutcome')}</th>
                  <th style={ui.th}>{t('colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((cl) => (
                  <tr key={cl.id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={ui.td}>{cl.fromNumber || '—'}</td>
                    <td style={ui.td}><span style={{ color: outc(cl.outcome).color, fontWeight: 600 }}>● {outc(cl.outcome)[lang as Lang]}</span></td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{fmtWhen(cl.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{t('complianceNote')}</div>
    </section>
  );
}

const codeS: CSSProperties = { padding: '2px 7px', background: '#0f172a', borderRadius: 6, border: '1px solid #334155', color: '#a5b4fc', fontSize: 13 };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#a5b4fc', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>{label}</div>
    </div>
  );
}
