'use client';

// Salon-admin page for the Messenger booking bot: connect the Facebook Page,
// set the webhook, turn the AI receptionist on, and watch conversations.

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface BotFact { label: string; value: string; on: boolean }
interface MConf {
  connected: boolean; pageId: string; igId: string; enabled: boolean; greeting: string; aiInstruction: string;
  aiEnabled: boolean; webhookUrl: string; verifyToken: string; threads: number; fbConfigured: boolean; botFacts: BotFact[];
}
interface MThread { id: string; senderId: string; lastText: string | null; handoff: boolean; updatedAt: string }
interface FactRow extends BotFact { custom: boolean }

// Common things customers ask a nail salon. label = sent to the bot (English);
// vi/en = what the salon admin sees; ph = example hint.
const FACT_DEFS: { label: string; vi: string; en: string; phVi: string; phEn: string }[] = [
  { label: 'Parking', vi: 'Chỗ đậu xe', en: 'Parking', phVi: 'vd: bãi miễn phí trước tiệm', phEn: 'e.g. free lot in front' },
  { label: 'Languages spoken', vi: 'Ngôn ngữ nhân viên', en: 'Languages spoken', phVi: 'vd: tiếng Việt & tiếng Anh', phEn: 'e.g. Vietnamese & English' },
  { label: 'Specialties', vi: 'Chuyên môn', en: 'Specialties', phVi: 'vd: gel, dip, bột, nail art', phEn: 'e.g. gel, dip, acrylic, nail art' },
  { label: 'Payment methods', vi: 'Thanh toán', en: 'Payment methods', phVi: 'vd: thẻ, tiền mặt, Zelle, Apple Pay', phEn: 'e.g. card, cash, Zelle, Apple Pay' },
  { label: 'Walk-ins', vi: 'Nhận khách vãng lai', en: 'Walk-ins', phVi: 'vd: có nhận / chỉ đặt trước', phEn: 'e.g. welcome / by appointment' },
  { label: 'Cancellation policy', vi: 'Chính sách hủy / trễ', en: 'Cancellation policy', phVi: "vd: báo trước 2 tiếng; trễ 15' phải dời", phEn: 'e.g. 2h notice; 15+ min late reschedules' },
  { label: 'Deposit', vi: 'Đặt cọc', en: 'Deposit', phVi: 'vd: cọc $20 cho nhóm', phEn: 'e.g. $20 deposit for groups' },
  { label: 'Promotions', vi: 'Ưu đãi / gift card / tích điểm', en: 'Promotions / gift cards / loyalty', phVi: 'vd: giảm 10% Thứ 3–4; có gift card', phEn: 'e.g. 10% off Tue–Wed; gift cards' },
  { label: 'Kids services', vi: 'Trẻ em', en: 'Kids services', phVi: 'vd: có làm mani/pedi cho bé', phEn: 'e.g. mani/pedi for children' },
  { label: 'Groups / parties', vi: 'Nhóm / tiệc', en: 'Groups / parties', phVi: 'vd: nhận nhóm 4–6, đặt trước', phEn: 'e.g. 4–6 people, book ahead' },
  { label: 'Request a technician', vi: 'Yêu cầu thợ cụ thể', en: 'Request a technician', phVi: 'vd: được yêu cầu thợ quen', phEn: 'e.g. can request your usual tech' },
];

type Lang = 'vi' | 'en';
const DICT: Record<string, { vi: string; en: string }> = {
  title: { vi: 'Messenger — Trợ lý đặt lịch', en: 'Messenger booking bot' },
  subtitle: { vi: 'Trợ lý AI trên fanpage tự trò chuyện, xin thông tin và đặt lịch cho khách.', en: 'An AI assistant on your Facebook Page that chats with customers and books appointments.' },
  connectTitle: { vi: 'Kết nối Facebook Page', en: 'Connect your Facebook Page' },
  oneClickHint: { vi: 'Bấm nút bên dưới, đăng nhập Facebook và chọn Page của tiệm — hệ thống tự lấy Page, Instagram và token. Không cần dán gì cả.', en: 'Click below, log in to Facebook and pick your salon Page — we grab the Page, Instagram and token automatically. Nothing to paste.' },
  connectFb: { vi: 'Kết nối với Facebook', en: 'Connect with Facebook' },
  reconnectFb: { vi: 'Kết nối lại Facebook', en: 'Reconnect Facebook' },
  disconnectFb: { vi: 'Ngắt kết nối', en: 'Disconnect' },
  disconnectConfirm: { vi: 'Ngắt kết nối Facebook Page khỏi tiệm này? Bot sẽ ngừng trả lời cho đến khi kết nối lại.', en: 'Disconnect this Facebook Page from the salon? The bot will stop replying until you reconnect.' },
  disconnected: { vi: 'Đã ngắt kết nối Facebook.', en: 'Facebook disconnected.' },
  connecting: { vi: 'Đang mở Facebook…', en: 'Opening Facebook…' },
  fbConnectedMsg: { vi: 'Đã kết nối Facebook thành công ✓', en: 'Facebook connected successfully ✓' },
  fbErrorMsg: { vi: 'Kết nối Facebook thất bại', en: 'Facebook connection failed' },
  advanced: { vi: 'Nhập thủ công (nâng cao)', en: 'Manual entry (advanced)' },
  advancedHint: { vi: 'Chỉ dùng nếu bạn tự tạo token trong Meta. Hầu hết tiệm chỉ cần nút xanh phía trên.', en: 'Only if you create a token yourself in Meta. Most salons just need the blue button above.' },
  pageId: { vi: 'Facebook Page ID', en: 'Facebook Page ID' },
  pageIdPh: { vi: 'vd 1234567890', en: 'e.g. 1234567890' },
  igId: { vi: 'Instagram Business ID (tùy chọn)', en: 'Instagram Business ID (optional)' },
  igIdPh: { vi: 'để bot trả lời cả DM Instagram', en: 'to also reply to Instagram DMs' },
  pageToken: { vi: 'Page Access Token (bí mật)', en: 'Page Access Token (secret)' },
  pageTokenPh: { vi: 'dán token mới (để trống nếu không đổi)', en: 'paste a new token (leave blank to keep)' },
  connected: { vi: 'Đã kết nối', en: 'Connected' },
  notConnected: { vi: 'Chưa kết nối', en: 'Not connected' },
  enable: { vi: 'Bật bot tự trả lời', en: 'Enable the bot' },
  save: { vi: 'Lưu', en: 'Save' },
  saved: { vi: 'Đã lưu ✓', en: 'Saved ✓' },
  webhookTitle: { vi: 'Cài webhook trong Meta', en: 'Webhook setup in Meta' },
  webhookUrl: { vi: 'Callback URL', en: 'Callback URL' },
  verifyToken: { vi: 'Verify Token', en: 'Verify Token' },
  copy: { vi: 'Chép', en: 'Copy' },
  copied: { vi: '✓', en: '✓' },
  webhookHint: { vi: 'Trong Meta App → Messenger → Webhooks: dán 2 giá trị trên, đăng ký sự kiện messages & messaging_postbacks, rồi Subscribe Page.', en: 'In Meta App → Messenger → Webhooks: paste these two, subscribe to messages & messaging_postbacks, then Subscribe the Page.' },
  behaviorTitle: { vi: 'Cách bot trả lời', en: 'Bot behaviour' },
  greeting: { vi: 'Lời chào (tùy chọn)', en: 'Greeting (optional)' },
  greetingPh: { vi: 'vd: Chào bạn! Bạn muốn đặt dịch vụ gì hôm nay ạ?', en: 'e.g. Hi! What would you like to book today?' },
  infoTitle: { vi: '🏢 Thông tin doanh nghiệp', en: '🏢 Business information' },
  infoKnows: { vi: 'Bot đã biết sẵn:', en: 'The bot already knows:' },
  infoKnowsList: { vi: 'Giờ mở cửa · Dịch vụ & giá · SĐT/email · Địa chỉ', en: 'Hours · Services & prices · Phone/email · Address' },
  infoHelp: { vi: 'Bot đã tự biết: giờ mở cửa, dịch vụ & giá, SĐT/email, địa chỉ (từ Settings). Tick những mục dưới đây và điền câu trả lời để bot trả lời khách đúng. Có thể tự thêm mục mới.', en: 'The bot already knows hours, services & prices, phone/email and address (from Settings). Tick the items below and fill the answer so the bot can reply. You can add your own.' },
  addItem: { vi: '+ Thêm mục', en: '+ Add item' },
  saveInfo: { vi: 'Lưu thông tin', en: 'Save info' },
  customLabelPh: { vi: 'Tên mục (vd: Wifi)', en: 'Item name (e.g. Wifi)' },
  factValuePh: { vi: 'Nhập câu trả lời…', en: 'Enter the answer…' },
  extraNotes: { vi: 'Ghi chú thêm cho bot (tự do)', en: 'Extra notes for the bot (free text)' },
  extraNotesPh: { vi: 'vd: giọng thân thiện, xưng em; luôn hỏi khung giờ ưu tiên.', en: 'e.g. warm tone; always ask for a preferred time.' },
  aiOn: { vi: '✨ AI đang bật', en: '✨ AI on' },
  aiOff: { vi: 'chưa có ANTHROPIC_API_KEY → bot chỉ báo "sẽ có người trả lời"', en: 'no ANTHROPIC_API_KEY → bot only says a human will reply' },
  convosTitle: { vi: 'Cuộc trò chuyện', en: 'Conversations' },
  noConvos: { vi: 'Chưa có cuộc trò chuyện nào.', en: 'No conversations yet.' },
  searchConvo: { vi: 'Tìm trong tin nhắn…', en: 'Search messages…' },
  noMatch: { vi: 'Không có kết quả phù hợp.', en: 'No matches.' },
  collapse: { vi: 'Thu gọn ▾', en: 'Collapse ▾' },
  expand: { vi: 'Mở rộng ▸', en: 'Expand ▸' },
  takeOver: { vi: 'Tôi tiếp nhận', en: 'Take over' },
  giveBack: { vi: 'Trả lại cho bot', en: 'Give back to bot' },
  handedOff: { vi: 'người thật đang xử lý', en: 'human handling' },
  loading: { vi: 'Đang tải…', en: 'Loading…' },
  pendingNote: { vi: 'Lưu ý: bot chạy được sau khi Meta duyệt quyền nhắn tin (pages_messaging).', en: 'Note: works after Meta approves messaging permission (pages_messaging).' },
};

export default function MessengerPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => DICT[k]?.[lang as Lang] ?? k;

  const [c, setC] = useState<MConf | null>(null);
  const [threads, setThreads] = useState<MThread[]>([]);
  const [pageToken, setPageToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [copied, setCopied] = useState('');
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [factsInit, setFactsInit] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);     // fold the business-info checklist
  const [convoSearch, setConvoSearch] = useState(''); // filter the conversations list

  // Seed the checklist from stored facts once the config loads: every predefined
  // row shows (ticked/filled if saved), plus any custom rows the salon added.
  useEffect(() => {
    if (!c || factsInit) return;
    const stored = Array.isArray(c.botFacts) ? c.botFacts : [];
    const byLabel = new Map(stored.map((f) => [f.label, f]));
    const rows: FactRow[] = FACT_DEFS.map((d) => {
      const s = byLabel.get(d.label);
      return { label: d.label, value: s?.value ?? '', on: s?.on ?? false, custom: false };
    });
    for (const s of stored) {
      if (!FACT_DEFS.some((d) => d.label === s.label)) rows.push({ label: s.label, value: s.value ?? '', on: s.on ?? true, custom: true });
    }
    setFacts(rows);
    setFactsInit(true);
  }, [c, factsInit]);

  const factDef = (label: string) => FACT_DEFS.find((d) => d.label === label);
  const factLabel = (label: string) => { const d = factDef(label); return d ? d[lang as Lang] : label; };
  const factPh = (label: string) => { const d = factDef(label); return d ? (lang === 'vi' ? d.phVi : d.phEn) : DICT.factValuePh[lang as Lang]; };
  const setFact = (i: number, patch: Partial<FactRow>) => setFacts((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  const addFact = () => setFacts((fs) => [...fs, { label: '', value: '', on: true, custom: true }]);
  const removeFact = (i: number) => setFacts((fs) => fs.filter((_, idx) => idx !== i));

  // Read the ?fb=connected|error the OAuth callback redirected back with.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const fb = p.get('fb');
    if (!fb) return;
    if (fb === 'connected') {
      const page = p.get('page');
      setNotice(`${DICT.fbConnectedMsg[lang as Lang]}${page ? ` — ${page}` : ''}`);
    } else {
      const msg = p.get('msg');
      setError(`${DICT.fbErrorMsg[lang as Lang]}${msg ? `: ${decodeURIComponent(msg)}` : ''}`);
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, [lang]);

  async function connectFacebook() {
    if (!token) return;
    setConnecting(true); setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/messenger/connect', { token });
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start Facebook connect');
      setConnecting(false);
    }
  }

  async function disconnectFacebook() {
    if (!token || !window.confirm(DICT.disconnectConfirm[lang as Lang])) return;
    setError(null); setNotice(null);
    try {
      await apiFetch('/messenger/disconnect', { method: 'POST', token });
      setNotice(DICT.disconnected[lang as Lang]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    }
  }

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [conf, th] = await Promise.all([
        apiFetch<MConf>('/messenger', { token }),
        apiFetch<MThread[]>('/messenger/threads', { token }).catch(() => [] as MThread[]),
      ]);
      setC(conf); setThreads(th);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function save(patch: Partial<MConf> & { pageToken?: string }) {
    if (!c) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = await apiFetch<MConf>('/messenger/settings', { method: 'POST', token, body: {
        pageId: c.pageId, igId: c.igId, enabled: c.enabled, greeting: c.greeting, aiInstruction: c.aiInstruction, ...patch,
      } });
      setC(next); setPageToken(''); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  async function saveFacts() {
    const payload = facts
      .filter((f) => f.label.trim() && (f.value.trim() || f.on))
      .map((f) => ({ label: f.label.trim(), value: f.value.trim(), on: f.on }));
    await save({ botFacts: payload });
  }
  async function handoff(id: string, val: boolean) {
    try { await apiFetch(`/messenger/threads/${id}/handoff`, { method: 'POST', token, body: { handoff: val } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }
  function copy(text: string, key: string) {
    try { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  }

  if (loading || !c) {
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('title')}</h1><p style={{ color: '#94a3b8' }}>{t('loading')}</p></section>;
  }

  return (
    <section style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('subtitle')}</p>
      {error && <div style={ui.banner}>{error}</div>}
      {notice && <div style={{ ...ui.card, marginBottom: 16, borderColor: '#22c55e', color: '#bbf7d0', fontSize: 13.5 }}>{notice}</div>}

      {/* Connect */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{t('connectTitle')}</div>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: c.connected ? '#22c55e' : '#f59e0b' }}>
            ● {c.connected ? t('connected') : t('notConnected')}
          </span>
        </div>

        {/* One-click OAuth (preferred) */}
        {c.fbConfigured && (
          <div style={{ marginBottom: 4 }}>
            <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px', lineHeight: 1.5 }}>{t('oneClickHint')}</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={connectFacebook} disabled={connecting} style={fbBtn}>
                <span style={{ fontSize: 16, fontWeight: 800 }}>f</span>
                {connecting ? t('connecting') : (c.connected ? t('reconnectFb') : t('connectFb'))}
              </button>
              {c.connected && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: '#e2e8f0' }}>
                  <input type="checkbox" checked={c.enabled} onChange={(e) => save({ enabled: e.target.checked })} />
                  {t('enable')}
                </label>
              )}
              {c.connected && (
                <button onClick={disconnectFacebook} style={{ ...ghost, borderColor: '#7f1d1d', color: '#fca5a5', marginLeft: 'auto' }}>
                  {t('disconnectFb')}
                </button>
              )}
            </div>
            <button onClick={() => setShowManual((v) => !v)} style={{ ...ghost, marginTop: 14, fontSize: 12 }}>
              {showManual ? '▾ ' : '▸ '}{t('advanced')}
            </button>
          </div>
        )}

        {/* Manual entry — always shown if FB app not configured, else collapsible */}
        {(!c.fbConfigured || showManual) && (
          <div style={{ marginTop: c.fbConfigured ? 12 : 0, paddingTop: c.fbConfigured ? 12 : 0, borderTop: c.fbConfigured ? '1px solid #334155' : 'none' }}>
            {c.fbConfigured && <p style={{ color: '#64748b', fontSize: 11.5, margin: '0 0 12px' }}>{t('advancedHint')}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
              <div>
                <label style={ui.label}>{t('pageId')}</label>
                <input value={c.pageId} placeholder={t('pageIdPh')} onChange={(e) => setC({ ...c, pageId: e.target.value })} style={ui.input} />
              </div>
              <div>
                <label style={ui.label}>{t('igId')}</label>
                <input value={c.igId} placeholder={t('igIdPh')} onChange={(e) => setC({ ...c, igId: e.target.value })} style={ui.input} />
              </div>
              <div>
                <label style={ui.label}>{t('pageToken')}</label>
                <input value={pageToken} placeholder={c.connected ? '••••••••' : t('pageTokenPh')} onChange={(e) => setPageToken(e.target.value)} style={ui.input} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', fontSize: 14, color: '#e2e8f0' }}>
              <input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} />
              {t('enable')}
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
              <button onClick={() => save({ pageToken: pageToken || undefined })} disabled={saving} style={ui.primaryBtn}>{t('save')}</button>
              {saved && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('saved')}</span>}
            </div>
          </div>
        )}
        <p style={{ color: '#64748b', fontSize: 11.5, margin: '12px 0 0' }}>{t('pendingNote')}</p>
      </div>

      {/* Webhook */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{t('webhookTitle')}</div>
        {([['webhookUrl', c.webhookUrl], ['verifyToken', c.verifyToken]] as const).map(([k, val]) => (
          <div key={k} style={{ marginBottom: 8 }}>
            <label style={ui.label}>{t(k)}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input readOnly value={val} style={{ ...ui.input, fontFamily: 'monospace', fontSize: 12.5 }} />
              <button onClick={() => copy(val, k)} style={{ ...ghost, whiteSpace: 'nowrap' }}>{copied === k ? t('copied') : t('copy')}</button>
            </div>
          </div>
        ))}
        <p style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0 0', lineHeight: 1.5 }}>{t('webhookHint')}</p>
      </div>

      {/* Behaviour */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
          {t('behaviorTitle')} <span style={{ fontSize: 12.5, fontWeight: 500, color: c.aiEnabled ? '#22c55e' : '#f59e0b' }}>· {c.aiEnabled ? t('aiOn') : t('aiOff')}</span>
        </div>
        <label style={ui.label}>{t('greeting')}</label>
        <textarea value={c.greeting} placeholder={t('greetingPh')} rows={2} onChange={(e) => setC({ ...c, greeting: e.target.value })} onBlur={() => save({})} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5, marginBottom: 12 }} />
        <label style={ui.label}>{t('extraNotes')}</label>
        <textarea value={c.aiInstruction} placeholder={t('extraNotesPh')} rows={3} onChange={(e) => setC({ ...c, aiInstruction: e.target.value })} onBlur={() => save({})} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      {/* Salon info — tick + fill so the bot answers common questions */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: infoOpen ? 6 : 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>
            {t('infoTitle')} <span style={{ fontSize: 12.5, fontWeight: 500, color: '#64748b' }}>· {facts.filter((f) => f.on && f.value.trim()).length}</span>
          </div>
          <button onClick={() => setInfoOpen((v) => !v)} style={{ ...ghost, fontSize: 12 }}>{infoOpen ? t('collapse') : t('expand')}</button>
        </div>
        {infoOpen && (
          <>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '4px 0 10px', lineHeight: 1.5 }}>{t('infoHelp')}</p>
            <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 11px', marginBottom: 12, fontSize: 12 }}>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>✓ {t('infoKnows')}</span> <span style={{ color: '#94a3b8' }}>{t('infoKnowsList')}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', paddingRight: facts.length > 6 ? 4 : 0 }}>
              {facts.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: f.on ? '#0f172a' : 'transparent', border: '1px solid', borderColor: f.on ? '#334155' : '#1e293b', borderRadius: 8, padding: '8px 10px' }}>
                  <input type="checkbox" checked={f.on} onChange={(e) => setFact(i, { on: e.target.checked })} style={{ flexShrink: 0, width: 16, height: 16 }} />
                  {f.custom
                    ? <input value={f.label} placeholder={t('customLabelPh')} onChange={(e) => setFact(i, { label: e.target.value })} style={{ ...ui.input, width: 150, flexShrink: 0 }} />
                    : <span style={{ width: 150, flexShrink: 0, fontSize: 13, color: f.on ? '#e2e8f0' : '#94a3b8' }}>{factLabel(f.label)}</span>}
                  <input value={f.value} placeholder={factPh(f.label)} onChange={(e) => setFact(i, { value: e.target.value })} style={{ ...ui.input, flex: 1, minWidth: 160 }} />
                  {f.custom && <button onClick={() => removeFact(i)} title="remove" style={{ ...ghost, padding: '6px 10px', color: '#fca5a5', borderColor: '#7f1d1d' }}>✕</button>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={addFact} style={ghost}>{t('addItem')}</button>
              <button onClick={saveFacts} disabled={saving} style={ui.primaryBtn}>{t('saveInfo')}</button>
              {saved && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('saved')}</span>}
            </div>
          </>
        )}
      </div>

      {/* Conversations */}
      <div style={{ ...ui.card }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>{t('convosTitle')} ({c.threads})</div>
        {threads.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13.5 }}>{t('noConvos')}</p>
        ) : (() => {
          const q = convoSearch.trim().toLowerCase();
          const shown = q ? threads.filter((th) => (th.lastText || '').toLowerCase().includes(q)) : threads;
          return (
            <>
              {threads.length > 5 && (
                <input value={convoSearch} onChange={(e) => setConvoSearch(e.target.value)} placeholder={t('searchConvo')} style={{ ...ui.input, marginBottom: 10 }} />
              )}
              {shown.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13.5 }}>{t('noMatch')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto', paddingRight: shown.length > 6 ? 4 : 0 }}>
                  {shown.map((th) => (
                    <div key={th.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: '#cbd5e1', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{th.lastText || '—'}</div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{new Date(th.updatedAt).toLocaleString('en-US')}{th.handoff ? ` · ⚠️ ${t('handedOff')}` : ''}</div>
                      </div>
                      {th.handoff
                        ? <button onClick={() => handoff(th.id, false)} style={ghost}>{t('giveBack')}</button>
                        : <button onClick={() => handoff(th.id, true)} style={ghost}>{t('takeOver')}</button>}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}
      </div>
    </section>
  );
}

const ghost: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12.5, cursor: 'pointer',
};

const fbBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 10,
  border: 'none', background: '#1877F2', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
