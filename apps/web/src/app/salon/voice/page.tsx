'use client';

// Salon-admin page for the AI voice hotline. The salon keeps its OWN public
// number and forwards it (on no-answer/busy) to the assigned Lumio number, which
// the AI answers, books, and confirms by text.

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { usePaged, Pager } from '../../../components/ListFilter';
import { useLang } from '../../../lib/i18n';

interface CustomHour { day: number; enabled: boolean; start: string; end: string }
interface VConf {
  provisioned: boolean; lumioNumber: string; enabled: boolean; greeting: string;
  language: string; aiInstruction: string; aiEnabled: boolean; webhookUrl: string; calls: number;
  // Call routing
  mode: string; forwardNumbers: string; ringSeconds: number;
  schedule: string; customHours: CustomHour[] | null;
  noAnswerAction: string; awayMessage: string; voicemailSms: string;
}
interface VCall {
  id: string; fromNumber: string | null; outcome: string; appointmentId: string | null;
  durationSec: number | null; createdAt: string;
}
interface VUsage {
  periodStart: string; aiCalls: number; aiMinutes: number; smsSent: number;
  includedMinutes: number; includedSms: number;
  overageMinutes: number; overageSms: number; overageCents: number; hardCap: boolean;
}

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
  routeTitle: { vi: 'Khi có khách gọi tới — cài đặt chi tiết', en: 'When a customer calls — call handling' },
  routeIntro: {
    vi: 'Chọn cách hệ thống xử lý mỗi cuộc gọi. Tất cả các lựa chọn dưới đây do Lumio điều khiển nên chạy đúng như anh chị cài.',
    en: 'Choose how every call is handled. Everything below runs on Lumio’s side, so it behaves exactly as you set it.',
  },
  modeAi: { vi: 'AI trả lời ngay', en: 'The assistant answers right away' },
  modeAiHint: {
    vi: 'Dùng khi anh chị đã cài chuyển hướng ở nhà mạng (số hồi chuông do nhà mạng quyết định).',
    en: 'Use this when your carrier already forwards on no-answer (the carrier decides the ring count).',
  },
  modeRing: { vi: 'Đổ chuông cho tiệm trước — không ai bắt máy thì AI mới nghe', en: 'Ring your phones first — the assistant only takes over if nobody picks up' },
  modeRingHint: {
    vi: 'Khuyến nghị. Lumio gọi vào số của tiệm/điện thoại anh chị trước. Hết số giây bên dưới mà không ai bắt — hoặc máy bận, hoặc bấm từ chối — thì AI mới trả lời. Số hồi chuông và trường hợp máy bận do Lumio kiểm soát, chính xác 100%.',
    en: 'Recommended. Lumio rings your own phones first. If nobody answers within the time below — or the line is busy or declined — the assistant takes over. Rings and busy are controlled by Lumio, so it is exact.',
  },
  modeFwd: { vi: 'Chỉ chuyển cho người — không dùng AI', en: 'Ring people only — never use the assistant' },
  modeFwdHint: {
    vi: 'Không ai bắt máy thì chuyển sang hộp thư thoại hoặc lời nhắn.',
    en: 'If nobody answers, fall through to voicemail or an announcement.',
  },
  numbersLabel: { vi: 'Số điện thoại đổ chuông (cách nhau bằng dấu phẩy, tối đa 5 số)', en: 'Phone numbers to ring (comma-separated, up to 5)' },
  numbersHint: {
    vi: 'Nhập số đầy đủ, ví dụ +1 403 555 0123. Lưu ý: số này KHÔNG được cài chuyển hướng về Lumio, nếu không cuộc gọi sẽ chạy vòng tròn. Nên dùng số cell của chủ/quản lý.',
    en: 'Use the full number, e.g. +1 403 555 0123. Important: these numbers must NOT forward back to Lumio, or the call will loop. A mobile number is safest.',
  },
  ringsLabel: { vi: 'Đổ chuông bao lâu trước khi AI bắt máy', en: 'How long to ring before the assistant answers' },
  rings: { vi: 'hồi chuông', en: 'rings' },
  seconds: { vi: 'giây', en: 'sec' },
  schedLabel: { vi: 'AI trực điện thoại vào lúc nào', en: 'When may the assistant answer' },
  schedAlways: { vi: 'Mọi lúc (24/7)', en: 'Any time (24/7)' },
  schedAfter: { vi: 'Chỉ ngoài giờ mở cửa (tối, ngày nghỉ, ngày lễ)', en: 'Only outside business hours (nights, days off, holidays)' },
  schedBiz: { vi: 'Chỉ trong giờ mở cửa', en: 'Only during business hours' },
  schedCustom: { vi: 'Tự chọn khung giờ theo từng ngày', en: 'Custom hours per weekday' },
  schedHint: {
    vi: 'Giờ mở cửa lấy từ mục Cài đặt → Giờ làm việc, tính theo múi giờ của tiệm.',
    en: 'Business hours come from Settings → Business hours, in your salon’s timezone.',
  },
  naLabel: { vi: 'Khi AI không trả lời và không ai bắt máy', en: 'When the assistant may not answer and nobody picks up' },
  naVoicemail: { vi: 'Cho khách để lại lời nhắn (hộp thư thoại)', en: 'Let the caller leave a voicemail' },
  naMessage: { vi: 'Đọc một lời nhắn rồi cúp máy', en: 'Play an announcement, then hang up' },
  naHangup: { vi: 'Đọc lời nhắn ngắn rồi cúp máy', en: 'Say a short notice, then hang up' },
  awayLabel: { vi: 'Lời nhắn đọc cho khách (để trống là dùng câu mặc định)', en: 'Message read to the caller (leave empty for the default)' },
  vmSmsLabel: { vi: 'Nhắn tin báo lời nhắn mới về số', en: 'Text new voicemails to' },
  vmSmsHint: {
    vi: 'Để trống thì gửi về số quản trị trong mục Thông báo.',
    en: 'Leave empty to use the admin phone from Notifications.',
  },
  saveRouting: { vi: 'Lưu cài đặt cuộc gọi', en: 'Save call handling' },
  days: { vi: 'CN,T2,T3,T4,T5,T6,T7', en: 'Sun,Mon,Tue,Wed,Thu,Fri,Sat' },
  ringSetupTitle: { vi: 'Cách cài số tiệm khi chọn “đổ chuông cho tiệm trước”', en: 'Setting up your salon line for “ring your phones first”' },
  ringSetupIntro: {
    vi: 'Ở chế độ này, mọi cuộc gọi phải vào Lumio TRƯỚC, rồi Lumio mới gọi ngược ra cho tiệm. Có hai cách:',
    en: 'In this mode every call must reach Lumio FIRST, and Lumio then rings your phones. Two ways to do it:',
  },
  ringSetup1: {
    vi: 'Cách 1 (gọn nhất): đăng số Lumio ở trên làm số liên hệ của tiệm (website, Google, Facebook).',
    en: 'Option 1 (cleanest): publish the Lumio number above as your salon’s contact number (website, Google, Facebook).',
  },
  ringSetup2: {
    vi: 'Cách 2: giữ số cũ và cài chuyển hướng TẤT CẢ cuộc gọi (unconditional) về số Lumio — máy bàn thường là',
    en: 'Option 2: keep your number and forward ALL calls (unconditional) to the Lumio number — on most landlines that is',
  },
  ringSetupWarn: {
    vi: '⚠ Quan trọng: số điện thoại mà Lumio gọi ra (ô “Số điện thoại đổ chuông” ở trên) KHÔNG được cài chuyển hướng về Lumio — nếu không cuộc gọi sẽ chạy vòng tròn. Dùng số cell của chủ/quản lý là an toàn nhất.',
    en: '⚠ Important: the numbers Lumio rings (“Phone numbers to ring” above) must NOT forward back to Lumio, or the call will loop. Mobile numbers are the safest choice.',
  },
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
  overWarn: { vi: 'Đã vượt hạn mức gói', en: 'Over your plan allowance' },
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
  const pgCalls = usePaged(calls, 15);
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
        enabled: c.enabled, greeting: c.greeting, language: c.language, aiInstruction: c.aiInstruction,
        mode: c.mode, forwardNumbers: c.forwardNumbers, ringSeconds: c.ringSeconds,
        schedule: c.schedule, customHours: c.customHours ?? undefined,
        noAnswerAction: c.noAnswerAction, awayMessage: c.awayMessage, voicemailSms: c.voicemailSms,
        ...patch,
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
            <Stat label={t('usageMinutes')} value={usage.includedMinutes > 0 ? `${usage.aiMinutes} / ${usage.includedMinutes}` : usage.aiMinutes} />
            <Stat label={t('usageSms')} value={usage.includedSms > 0 ? `${usage.smsSent} / ${usage.includedSms}` : usage.smsSent} />
          </div>
          {(usage.overageMinutes > 0 || usage.overageSms > 0) && (
            <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, background: '#3b1d1d', border: '1px solid #b91c1c', color: '#fecaca', fontSize: 13 }}>
              ⚠️ {t('overWarn')}: {usage.overageMinutes > 0 ? `+${usage.overageMinutes} ${t('usageMinutes').toLowerCase()}` : ''}{usage.overageMinutes > 0 && usage.overageSms > 0 ? ', ' : ''}{usage.overageSms > 0 ? `+${usage.overageSms} SMS` : ''}{usage.overageCents > 0 ? ` (~$${(usage.overageCents / 100).toFixed(2)})` : ''}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>{t('usageNote')}</div>
        </div>
      )}

      {/* Call handling — everything below is enforced by Lumio, not the carrier */}
      {c.provisioned && (
        <div style={{ ...ui.card, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{t('routeTitle')}</div>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 14px' }}>{t('routeIntro')}</p>

          {/* 1 — how a call is handled */}
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {([
              ['ring_first', t('modeRing'), t('modeRingHint')],
              ['ai', t('modeAi'), t('modeAiHint')],
              ['forward', t('modeFwd'), t('modeFwdHint')],
            ] as [string, string, string][]).map(([key, label, hint]) => {
              const on = c.mode === key;
              return (
                <button key={key} type="button" onClick={() => setC({ ...c, mode: key })}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', width: '100%', cursor: 'pointer',
                    padding: '12px 14px', borderRadius: 10, background: on ? 'rgba(99,102,241,0.12)' : '#0f172a',
                    border: `1px solid ${on ? '#6366f1' : '#1e293b'}` }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
                    border: `2px solid ${on ? '#6366f1' : '#475569'}`, background: on ? '#6366f1' : 'transparent',
                    boxShadow: on ? 'inset 0 0 0 3px #0f172a' : 'none' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{label}</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginTop: 3, lineHeight: 1.5 }}>{hint}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* 2 — who to ring, and for how long */}
          {(c.mode === 'ring_first' || c.mode === 'forward') && (
            <div style={{ marginBottom: 16 }}>
              <label style={ui.label}>{t('numbersLabel')}</label>
              <input value={c.forwardNumbers} onChange={(e) => setC({ ...c, forwardNumbers: e.target.value })}
                placeholder="+1 403 555 0123, +1 403 555 0456" style={{ ...ui.input, width: '100%' }} />
              <p style={{ color: '#fbbf24', fontSize: 12, margin: '6px 0 0', lineHeight: 1.5 }}>{t('numbersHint')}</p>

              {c.mode === 'ring_first' && (
                <div style={{ marginTop: 12 }}>
                  <label style={ui.label}>{t('ringsLabel')}</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[12, 18, 24, 30, 40].map((sec) => {
                      const on = c.ringSeconds === sec;
                      return (
                        <button key={sec} type="button" onClick={() => setC({ ...c, ringSeconds: sec })}
                          style={{ padding: '8px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                            border: `1px solid ${on ? '#6366f1' : '#334155'}`, background: on ? '#6366f1' : '#0f172a',
                            color: on ? '#fff' : '#cbd5e1' }}>
                          {Math.round(sec / 6)} {t('rings')} · {sec}{t('seconds')}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3 — when the assistant is allowed to answer */}
          {c.mode !== 'forward' && (
            <div style={{ marginBottom: 16 }}>
              <label style={ui.label}>{t('schedLabel')}</label>
              <select value={c.schedule} onChange={(e) => setC({ ...c, schedule: e.target.value })}
                style={{ ...ui.input, width: '100%', cursor: 'pointer' }}>
                <option value="always">{t('schedAlways')}</option>
                <option value="after_hours">{t('schedAfter')}</option>
                <option value="business_hours">{t('schedBiz')}</option>
                <option value="custom">{t('schedCustom')}</option>
              </select>
              {(c.schedule === 'after_hours' || c.schedule === 'business_hours') && (
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '6px 0 0' }}>{t('schedHint')}</p>
              )}

              {c.schedule === 'custom' && (
                <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                  {t('days').split(',').map((dn, i) => {
                    const rows: CustomHour[] = c.customHours ?? [];
                    const row = rows.find((r) => r.day === i) ?? { day: i, enabled: false, start: '18:00', end: '09:00' };
                    const put = (patch: Partial<CustomHour>) => {
                      const next = [...rows.filter((r) => r.day !== i), { ...row, ...patch }].sort((a, b) => a.day - b.day);
                      setC({ ...c, customHours: next });
                    };
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8,
                        background: '#0f172a', border: '1px solid #1e293b' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', width: 92, flexShrink: 0 }}>
                          <input type="checkbox" checked={row.enabled} onChange={(e) => put({ enabled: e.target.checked })}
                            style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer' }} />
                          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{dn}</span>
                        </label>
                        <input type="time" value={row.start} disabled={!row.enabled} onChange={(e) => put({ start: e.target.value })}
                          style={{ ...ui.input, width: 120, opacity: row.enabled ? 1 : 0.4 }} />
                        <span style={{ color: '#64748b' }}>→</span>
                        <input type="time" value={row.end} disabled={!row.enabled} onChange={(e) => put({ end: e.target.value })}
                          style={{ ...ui.input, width: 120, opacity: row.enabled ? 1 : 0.4 }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 4 — the safety net: nobody answered */}
          <div style={{ marginBottom: 16 }}>
            <label style={ui.label}>{t('naLabel')}</label>
            <select value={c.noAnswerAction} onChange={(e) => setC({ ...c, noAnswerAction: e.target.value })}
              style={{ ...ui.input, width: '100%', cursor: 'pointer' }}>
              <option value="voicemail">{t('naVoicemail')}</option>
              <option value="message">{t('naMessage')}</option>
              <option value="hangup">{t('naHangup')}</option>
            </select>

            <div style={{ marginTop: 10 }}>
              <label style={ui.label}>{t('awayLabel')}</label>
              <textarea value={c.awayMessage} onChange={(e) => setC({ ...c, awayMessage: e.target.value })} rows={2}
                placeholder="Thanks for calling! We can't take your call right now."
                style={{ ...ui.input, width: '100%', resize: 'vertical' }} />
            </div>

            {c.noAnswerAction === 'voicemail' && (
              <div style={{ marginTop: 10 }}>
                <label style={ui.label}>{t('vmSmsLabel')}</label>
                <input value={c.voicemailSms} onChange={(e) => setC({ ...c, voicemailSms: e.target.value })}
                  placeholder="+1 403 555 0123" style={{ ...ui.input, width: '100%' }} />
                <p style={{ color: '#94a3b8', fontSize: 12, margin: '6px 0 0' }}>{t('vmSmsHint')}</p>
              </div>
            )}
          </div>

          <button onClick={() => save({})} disabled={saving} style={{ ...ui.primaryBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? '…' : saved ? '✓' : t('saveRouting')}
          </button>
        </div>
      )}

      {/* Setup instructions — they differ per mode, so show only the right ones. */}
      {c.provisioned && c.mode === 'ring_first' && (
        <div style={{ ...ui.card, marginBottom: 16, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.65 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>{t('ringSetupTitle')}</div>
          <p style={{ margin: '0 0 10px' }}>{t('ringSetupIntro')}</p>
          <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>{t('ringSetup1')}</li>
            <li>{t('ringSetup2')} <code style={codeS}>*72 {c.lumioNumber}</code> ({t('codeOff')} <code style={codeS}>*73</code>)</li>
          </ul>
          <p style={{ margin: 0, padding: '10px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', border: '1px solid #b45309', color: '#fde68a' }}>
            {t('ringSetupWarn')}
          </p>
        </div>
      )}

      {c.provisioned && c.mode !== 'ring_first' && (
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
          <>
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
                {pgCalls.paged.map((cl) => (
                  <tr key={cl.id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={ui.td}>{cl.fromNumber || '—'}</td>
                    <td style={ui.td}><span style={{ color: outc(cl.outcome).color, fontWeight: 600 }}>● {outc(cl.outcome)[lang as Lang]}</span></td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{fmtWhen(cl.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager paged={pgCalls} />
          </>
        )}
      </div>

      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{t('complianceNote')}</div>
    </section>
  );
}

const codeS: CSSProperties = { padding: '2px 7px', background: '#0f172a', borderRadius: 6, border: '1px solid #334155', color: '#a5b4fc', fontSize: 13 };

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#a5b4fc', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>{label}</div>
    </div>
  );
}
