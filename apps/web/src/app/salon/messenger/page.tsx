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
  connected: boolean; pageId: string; pageName: string; igId: string; enabled: boolean; greeting: string; aiInstruction: string;
  aiEnabled: boolean; webhookUrl: string; verifyToken: string; threads: number; fbConfigured: boolean; botFacts: BotFact[];
  botMode: 'booking' | 'sales'; leadEmail: string; closing: string; agentName: string; bizIntro: string;
  pages: { pageId: string; pageName: string | null; igId: string | null; enabled: boolean; createdAt: string }[];
  humanActiveMins: number; graceMins: number;
  connectTrace?: { at: string; steps: string[] } | null;
}
interface SalesLead {
  id: string; threadId: string | null; name: string; phone: string; salonName: string | null; city: string | null;
  interest: string | null; note: string | null; status: string; createdAt: string;
}
interface MThread { id: string; senderId: string; senderName?: string | null; lastText: string | null; handoff: boolean; updatedAt: string }
interface FactRow extends BotFact { custom: boolean }
interface WebhookStatus { connected: boolean; pageId?: string; pageName?: string; subscribed?: boolean; fields?: string[]; appFields?: string[]; echoOk?: boolean; verifiedAt?: string; webhookUrl?: string }
interface ActivityEv { threadId: string; user: string; direction: 'in' | 'out'; text: string; status: string; at: string; manual: boolean }
interface ActivityRes { page: string; pageId: string; events: ActivityEv[] }

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
  fbConnectedMsg: { vi: 'Đã kết nối Facebook Page thành công ✓', en: 'Facebook Page connected successfully ✓' },
  fbSubscribedMsg: { vi: 'Đã đăng ký Page vào webhook thành công ✓', en: 'Page subscribed to webhook events successfully ✓' },
  sendingAs: { vi: 'Gửi từ Page', en: 'Sending as' },
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
  modeLabel: { vi: 'Chế độ bot', en: 'Bot mode' },
  modeBooking: { vi: '💅 Booking (tiệm nail)', en: '💅 Booking (salon)' },
  modeSales: { vi: '🏢 Sales (page agency)', en: '🏢 Sales (agency page)' },
  modeHint: { vi: 'Booking: đặt lịch cho tiệm. Sales: tư vấn sản phẩm Lumio + chốt lead cho team — chỉ dùng cho page của agency.', en: 'Booking: takes appointments for a salon. Sales: pitches Lumio + captures leads for the team — for the agency page only.' },
  leadEmail: { vi: 'Email nhận lead (chế độ Sales)', en: 'Lead alert email (Sales mode)' },
  leadEmailPh: { vi: 'vd: sales@lumioagency.com — trống = email admin của tiệm', en: 'e.g. sales@lumioagency.com — blank = salon admin email' },
  leadsTitle: { vi: 'Leads từ Messenger', en: 'Messenger leads' },
  noLeads: { vi: 'Chưa có lead nào — bot sẽ ghi lại khi khách để lại tên + SĐT.', en: 'No leads yet — the bot records one when a customer leaves name + phone.' },
  ldNew: { vi: 'MỚI', en: 'NEW' }, ldCtd: { vi: 'ĐÃ GỌI', en: 'CONTACTED' }, ldWon: { vi: 'CHỐT ✓', en: 'WON' }, ldLost: { vi: 'BỎ', en: 'LOST' },
  greeting: { vi: 'Lời chào (tùy chọn)', en: 'Greeting (optional)' },
  greetingPh: { vi: 'vd: Chào bạn! Bạn muốn đặt dịch vụ gì hôm nay ạ?', en: 'e.g. Hi! What would you like to book today?' },
  infoTitle: { vi: '🏢 Thông tin doanh nghiệp', en: '🏢 Business information' },
  infoKnows: { vi: 'Bot đã biết sẵn:', en: 'The bot already knows:' },
  infoKnowsList: { vi: 'Dịch vụ & giá · Khuyến mãi đang chạy · Đội ngũ thợ · Giờ mở cửa · Địa chỉ · SĐT/email · Gift card', en: 'Services & prices · Live promotions · Team · Hours · Address · Phone/email · Gift cards' },
  infoHelp: { vi: 'KHÔNG cần nhập lại thứ hệ thống đã có — mỗi lần khách nhắn, bot tự đọc dịch vụ, giá, khuyến mãi đang chạy, đội ngũ thợ, giờ làm và địa chỉ trực tiếp từ hệ thống (sửa ở Dịch vụ / Thợ / Settings là bot cập nhật ngay). Ở đây chỉ điền những thứ hệ thống KHÔNG lưu.', en: 'No need to re-enter what the system already has — on every message the bot reads services, prices, live promotions, team, hours and address straight from your system (edit them in Services / Staff / Settings and the bot updates instantly). Only fill in what the system does not store.' },
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
  pendingNote: { vi: 'Nhắn tin được bật cho các Facebook Page do quản trị viên hợp lệ kết nối.', en: 'Messaging is enabled for Facebook Pages connected by an authorized Page administrator.' },
  connDetailsTitle: { vi: 'Thông tin kết nối', en: 'Connection details' },
  pageName: { vi: 'Facebook Page', en: 'Facebook Page' },
  pageIdLabel: { vi: 'Page ID', en: 'Page ID' },
  connStatus: { vi: 'Trạng thái', en: 'Status' },
  webhookSub: { vi: 'Webhook subscription', en: 'Webhook subscription' },
  statusActive: { vi: 'Active', en: 'Active' },
  statusInactive: { vi: 'Chưa subscribe', en: 'Inactive' },
  subscribedEvents: { vi: 'Sự kiện đã đăng ký', en: 'Subscribed events' },
  lastVerified: { vi: 'Kiểm tra lần cuối', en: 'Last verified' },
  notSubscribed: { vi: 'Page chưa subscribe app — bấm \u201cKết nối lại Facebook\u201d.', en: 'Page not subscribed yet \u2014 click \u201cReconnect Facebook\u201d.' },
  webhookAdvancedTitle: { vi: 'Webhook (cấu hình thủ công \u2014 nâng cao)', en: 'Webhook (manual setup \u2014 advanced)' },
  webhookAutoNote: { vi: 'Hệ thống tự động subscribe Page vào webhook khi bạn bấm \u201cKết nối với Facebook\u201d. Phần dưới chỉ dùng khi tự cấu hình trong Meta App.', en: 'The app subscribes your Page to the webhook automatically when you click \u201cConnect with Facebook\u201d. The fields below are only for manual configuration in your own Meta App.' },
  sendTestTitle: { vi: 'Gửi tin nhắn thử', en: 'Send a test message' },
  sendTestHint: { vi: 'Chọn một cuộc trò chuyện gần đây và gửi tin nhắn từ ứng dụng. Tin được gửi tới khách trong Messenger qua Page.', en: 'Pick a recent conversation and send a message from the app. It is delivered to the customer in Messenger through the Page.' },
  recipient: { vi: 'Người nhận', en: 'Recipient' },
  messageLabel: { vi: 'Tin nhắn', en: 'Message' },
  sendMsgPh: { vi: 'vd: Dạ em xác nhận lịch của anh/chị ạ.', en: 'e.g. Hi! Confirming your appointment is booked.' },
  sendMessageBtn: { vi: 'Gửi tin nhắn', en: 'Send message' },
  sendingMsg: { vi: 'Đang gửi…', en: 'Sending…' },
  sentOk: { vi: 'Gửi thành công · Trạng thái: Sent', en: 'Message sent successfully · Status: Sent' },
  refreshActivity: { vi: 'Làm mới', en: 'Refresh activity' },
  noRecipient: { vi: 'Chưa có cuộc trò chuyện — khách phải nhắn Page trước (cửa sổ 24 giờ).', en: 'No conversation yet \u2014 a customer must message the Page first (24-hour window).' },
  activityTitle: { vi: 'Hoạt động Messenger', en: 'Messenger activity' },
  noActivity: { vi: 'Chưa có hoạt động.', en: 'No activity yet.' },
  colTime: { vi: 'Thời gian', en: 'Time' },
  colDirection: { vi: 'Chiều', en: 'Direction' },
  colUser: { vi: 'Người dùng', en: 'User' },
  colMessage: { vi: 'Tin nhắn', en: 'Message' },
  colStatus: { vi: 'Trạng thái', en: 'Status' },
  dirIn: { vi: 'Đến', en: 'Incoming' },
  dirOut: { vi: 'Đi', en: 'Outgoing' },
};

export default function MessengerPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  // Bot mode is a LUMIO decision, not a salon one: a mis-flip would turn a
  // salon's booking bot into a software salesman. Only the Support session
  // (and the platform owner) sees the switch; salons get the mode we set.
  const canPickMode = Boolean(user?.supportSession) || user?.role === 'SUPER_ADMIN';
  const { lang } = useLang();
  const t = (k: string) => DICT[k]?.[lang as Lang] ?? k;

  const [c, setC] = useState<MConf | null>(null);
  const [threads, setThreads] = useState<MThread[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
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
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState<'website' | 'page' | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const [proposed, setProposed] = useState<(BotFact & { pick: boolean })[] | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [suggest, setSuggest] = useState<{ greeting: string | null; closing: string | null; instruction: string | null } | null>(null);
  const [factsInit, setFactsInit] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);     // fold the business-info checklist
  const [convoSearch, setConvoSearch] = useState(''); // filter the conversations list
  const [wh, setWh] = useState<WebhookStatus | null>(null);       // live webhook subscription status
  const [activity, setActivity] = useState<ActivityEv[]>([]);     // in/out message log
  const [activityPage, setActivityPage] = useState('');           // Page the log is tied to
  const [sentAt, setSentAt] = useState<string | null>(null);      // timestamp of the last manual send
  const [showWebhook, setShowWebhook] = useState(false);          // advanced manual webhook fold
  const [sendTo, setSendTo] = useState('');                       // recipient thread for test send
  const [sendMsg, setSendMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sentAtIso, setSentAtIso] = useState<string | null>(null);   // exact row to highlight
  const [reviewMode, setReviewMode] = useState(false);               // Meta Review Mode (filter META-REVIEW-)
  const [reviewId, setReviewId] = useState('');                      // current Review Test ID
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

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

  // Read the website / fanpage, let the AI propose fact rows, human approves.
  async function importFacts(source: 'website' | 'page' | 'paste') {
    if (!token || importing) return;
    setImporting(source as 'website' | 'page'); setImportErr(null); setProposed(null); setSuggest(null);
    try {
      const r = await apiFetch<{ facts: BotFact[]; greeting?: string | null; closing?: string | null; instruction?: string | null }>('/messenger/import-facts', {
        method: 'POST', token,
        body: { source, url: source === 'website' ? importUrl.trim() : undefined, text: source === 'paste' ? pasteText.trim() : undefined },
      });
      setProposed(r.facts.map((f) => ({ ...f, pick: true })));
      if (r.greeting || r.closing || r.instruction) setSuggest({ greeting: r.greeting ?? null, closing: r.closing ?? null, instruction: r.instruction ?? null });
    } catch (e) { setImportErr(e instanceof Error ? e.message : 'Import failed'); }
    finally { setImporting(null); }
  }

  function mergeProposed() {
    if (!proposed) return;
    const chosen = proposed.filter((f) => f.pick);
    setFacts((fs) => {
      const next = [...fs];
      for (const f of chosen) {
        const i = next.findIndex((x) => x.label.trim().toLowerCase() === f.label.trim().toLowerCase());
        if (i >= 0) next[i] = { ...next[i], value: f.value, on: true };
        else next.push({ label: f.label, value: f.value, on: true, custom: true });
      }
      return next;
    });
    setProposed(null);
    setNotice(lang === 'vi' ? `Đã thêm ${chosen.length} mục — kiểm tra rồi bấm Lưu ở khung thông tin bên dưới.` : `Added ${chosen.length} row(s) — review then press Save in the info card below.`);
  }

  // Read the ?fb=connected|error the OAuth callback redirected back with.
  // Kept in its OWN state so the initial load() (which resets `error`) can
  // never swallow it — a failed connect must stay on screen until dismissed.
  const [fbResult, setFbResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pickList, setPickList] = useState<{ id: string; name: string; taken?: 'this' | 'other' | null; takenBy?: string | null }[] | null>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const [greetOpen, setGreetOpen] = useState(false);
  const [greetKeywords, setGreetKeywords] = useState('');
  const [greetBusy, setGreetBusy] = useState(false);
  const [greetOptions, setGreetOptions] = useState<string[] | null>(null);
  const [greetErr, setGreetErr] = useState('');

  const suggestGreeting = async () => {
    if (!token) return;
    setGreetBusy(true); setGreetErr(''); setGreetOptions(null);
    try {
      const r = await apiFetch<{ options: string[] }>('/messenger/suggest-greeting', {
        token, method: 'POST', body: { keywords: greetKeywords.trim() || undefined, lang },
      });
      setGreetOptions(r.options || []);
    } catch (e) {
      setGreetErr(e instanceof Error ? e.message : 'Error');
    } finally {
      setGreetBusy(false);
    }
  };
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const fb = p.get('fb');
    if (!fb) return;
    if (fb === 'pick') {
      // Several pages were granted (agency account) — the staff picks one.
      if (token) apiFetch<{ id: string; name: string; taken?: 'this' | 'other' | null; takenBy?: string | null }[]>('/messenger/oauth/candidates', { token }).then(setPickList).catch(() => setPickList([]));
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }
    if (fb === 'connected') {
      const page = p.get('page');
      setFbResult({ ok: true, text: `${DICT.fbConnectedMsg[lang as Lang]}${page ? ` — ${page}` : ''} ${DICT.fbSubscribedMsg[lang as Lang]}` });
    } else {
      const code = decodeURIComponent(p.get('msg') || '');
      const NAMED: Record<string, { vi: string; en: string }> = {
        no_pages: { vi: 'Bạn chưa tick page nào trong hộp thoại (0 Assets Selected). Bấm Connect lại và TICK đúng page trước khi Continue. Đã tick mà vẫn lỗi = profile Facebook đang đăng nhập không quản lý page đó.', en: 'No page was ticked in the dialog (0 Assets Selected). Press Connect again and TICK the page before Continue. If you did tick one, the logged-in Facebook profile does not manage that page.' },
        page_in_use: { vi: 'Page này đang được kết nối cho một tiệm khác trong hệ thống. Ngắt kết nối ở tiệm đó trước, hoặc chọn page khác.', en: 'This Page is already connected to another salon in the system. Disconnect it there first, or pick a different Page.' },
        invalid_state: { vi: 'Phiên kết nối hết hạn — bấm Connect và làm lại trong một mạch.', en: 'The connect session expired — press Connect and finish in one go.' },
        no_page_token: { vi: 'Meta không cấp token cho page — thử lại và cấp đủ quyền được hỏi.', en: 'Meta did not issue a page token — retry and grant all requested permissions.' },
        exception: { vi: 'Lỗi không xác định phía máy chủ — thử lại; nếu vẫn lỗi, xem log lumio-api trên Render.', en: 'Unexpected server error — retry; if it persists, check the lumio-api logs on Render.' },
        perm_declined: { vi: 'Quyền "xem danh sách page" đang bị TỪ CHỐI từ lần trước. Bấm Connect lại — hộp thoại sẽ hỏi lại quyền này, hãy giữ nguyên tất cả các quyền được bật.', en: 'The "list your Pages" permission was DECLINED earlier. Press Connect again — the dialog will re-ask it; keep every permission ON.' },
      };
      const metaMsg = code.startsWith('accounts_error:') ? code.slice('accounts_error:'.length) : null;
      const friendly = metaMsg
        ? (lang === 'vi' ? `Meta báo: "${metaMsg}"` : `Meta says: "${metaMsg}"`)
        : NAMED[code]?.[lang as Lang];
      setFbResult({ ok: false, text: `${DICT.fbErrorMsg[lang as Lang]}${code ? `: ${code}` : ''}${friendly ? ` — ${friendly}` : ''}` });
    }
    window.history.replaceState(null, '', window.location.pathname);
  }, [lang, token]);

  async function choosePage(id: string) {
    if (!token || picking) return;
    setPicking(id);
    try {
      const conf = await apiFetch<MConf>('/messenger/oauth/choose', { method: 'POST', token, body: { pageId: id } });
      setC(conf); // list stays open — an agency connects several pages in a row
      setFbResult({ ok: true, text: `${DICT.fbConnectedMsg[lang as Lang]} — ${conf.pages?.length ?? 1} page ${DICT.fbSubscribedMsg[lang as Lang]}` });
    } catch (e) {
      setFbResult({ ok: false, text: e instanceof Error ? e.message : 'Could not connect this page' });
    } finally { setPicking(null); }
  }

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

  async function disconnectPage(pageId: string) {
    if (!token) return;
    if (!window.confirm(lang === 'vi' ? 'Ngắt page này khỏi tiệm? Các page khác và nội dung bot giữ nguyên.' : 'Detach this page? Other pages and the bot content stay.')) return;
    setError(null);
    try { await apiFetch('/messenger/disconnect', { method: 'POST', token, body: { pageId } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Disconnect failed'); }
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
      const [conf, th, whs, act, lds] = await Promise.all([
        apiFetch<MConf>('/messenger', { token }),
        apiFetch<MThread[]>('/messenger/threads', { token }).catch(() => [] as MThread[]),
        apiFetch<WebhookStatus>('/messenger/webhook-status', { token }).catch(() => ({ connected: false } as WebhookStatus)),
        apiFetch<ActivityRes>('/messenger/activity', { token }).catch(() => ({ page: '', pageId: '', events: [] } as ActivityRes)),
        apiFetch<SalesLead[]>('/messenger/leads', { token }).catch(() => [] as SalesLead[]),
      ]);
      setC(conf); setThreads(th); setWh(whs); setActivity(act.events || []); setActivityPage(act.page || '');
      setLeads(lds);
      setSendTo((prev) => prev || th[0]?.id || '');
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Lightweight auto-refresh: keeps Activity/threads current without reloading
  // the page (reviewer sees new webhook events appear on their own).
  const silentRefresh = useCallback(async () => {
    if (!token) return;
    const [th, act] = await Promise.all([
      apiFetch<MThread[]>('/messenger/threads', { token }).catch(() => null),
      apiFetch<ActivityRes>('/messenger/activity', { token }).catch(() => null),
    ]);
    if (th) setThreads(th);
    if (act) { setActivity(act.events || []); setActivityPage(act.page || ''); }
  }, [token]);
  useEffect(() => {
    const id = setInterval(silentRefresh, 8000);
    return () => clearInterval(id);
  }, [silentRefresh]);

  async function save(patch: Partial<MConf> & { pageToken?: string }) {
    if (!c) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = await apiFetch<MConf>('/messenger/settings', { method: 'POST', token, body: {
        pageId: c.pageId, igId: c.igId, enabled: c.enabled, greeting: c.greeting, closing: c.closing, agentName: c.agentName, bizIntro: c.bizIntro, aiInstruction: c.aiInstruction, botMode: c.botMode, leadEmail: c.leadEmail, humanActiveMins: c.humanActiveMins, graceMins: c.graceMins, ...patch,
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
  // Manual label when the Graph name lookup isn't available (pre-approval).
  async function renameThread(id: string, current: string) {
    const name = window.prompt('Customer name for this conversation:', current || '');
    if (!name || !name.trim()) return;
    try { await apiFetch(`/messenger/threads/${id}/rename`, { method: 'POST', token, body: { name: name.trim() } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Rename failed'); }
  }
  // Real user-initiated Send API call from the app UI (Messenger permission demo).
  async function sendTest() {
    if (!token || !sendMsg.trim()) return;
    setSending(true); setSendResult(null); setSentAt(null);
    try {
      const res = await apiFetch<{ ok: boolean; at?: string }>('/messenger/send', { method: 'POST', token, body: { threadId: sendTo || undefined, text: sendMsg.trim() } });
      setSendResult('ok'); setSendMsg('');
      setSentAtIso(res.at || null);
      setSentAt(res.at ? new Date(res.at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null);
      await load();
    } catch (e) {
      setSendResult(e instanceof Error ? e.message : 'Send failed');
    } finally { setSending(false); }
  }
  // Meta Review Mode helpers — English-only by design (reviewer-facing).
  function genReviewId() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const id = `META-REVIEW-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    setReviewId(id);
    if (!sendMsg.trim()) setSendMsg(`${id} — `);
  }
  async function clearReview() {
    if (!token) return;
    if (!window.confirm('This will remove only Meta Review test activity. Customer conversations will not be deleted.')) return;
    try {
      await apiFetch('/messenger/clear-review-data', { method: 'POST', token });
      setReviewNotice('Meta Review test activity cleared successfully.');
      setTimeout(() => setReviewNotice(null), 5000);
      await silentRefresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Clear failed'); }
  }
  async function clearAllConvos() {
    if (!token) return;
    if (!window.confirm('Delete ALL Messenger conversations for this salon? This clears the entire Activity log and conversation list so you can start a fresh recording. The Facebook connection, webhook and bot settings are kept.')) return;
    try {
      await apiFetch('/messenger/clear-conversations', { method: 'POST', token });
      setReviewNotice('All conversations cleared — you have a clean slate.');
      setTimeout(() => setReviewNotice(null), 5000);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Clear failed'); }
  }
  function copy(text: string, key: string) {
    try { navigator.clipboard?.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { /* ignore */ }
  }

  if (loading || !c) {
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('title')}</h1><p style={{ color: '#94a3b8' }}>{t('loading')}</p></section>;
  }

  // Meta Review Mode: show only reviewer-tagged messages (real data stays in DB).
  const shownActivity = reviewMode ? activity.filter((e) => e.text.includes('META-REVIEW-')) : activity;

  return (
    <section style={{ maxWidth: 820 }}>
      {c && !c.connected && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontSize: 13, lineHeight: 1.7, color: '#cbd5e1' }}>
          <b style={{ color: '#e2e8f0' }}>{lang === 'vi' ? '4 bước kết nối — chỉ cần nhớ một điều: PHẢI TICK PAGE' : '4 steps — the one thing to remember: TICK THE PAGE'}</b>
          <div>1️⃣ {lang === 'vi' ? 'Bấm nút xanh Connect with Facebook.' : 'Press the blue Connect with Facebook button.'}</div>
          <div>2️⃣ {lang === 'vi' ? <>Cửa sổ Meta hiện ra: chọn <b style={{ color: '#fbbf24' }}>“Opt in to all current and future Pages”</b> (và làm tương tự ở bước Businesses) — nhanh nhất, khỏi tick từng cái.</> : <>In the Meta window pick <b style={{ color: '#fbbf24' }}>“Opt in to all current and future Pages”</b> (same on the Businesses step) — fastest, no per-item ticking.</>}</div>
          <div>3️⃣ {lang === 'vi' ? 'Continue → giữ nguyên mọi quyền được bật → Save.' : 'Continue → keep every permission ON → Save.'}</div>
          <div>4️⃣ {lang === 'vi' ? 'Quay về đây: banner xanh = xong; nhiều page thì bấm “Dùng page này” cho đúng page.' : 'Back here: green banner = done; if several pages, press “Use this page” on the right one.'}</div>
        </div>
      )}
      {fbResult && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: fbResult.ok ? '#052e1e' : '#7f1d1d', color: fbResult.ok ? '#bbf7d0' : '#fecaca', border: `1px solid ${fbResult.ok ? '#10b981' : '#ef4444'}`, borderRadius: 10, padding: '11px 14px', fontSize: 13.5, lineHeight: 1.55, marginBottom: 14 }}>
          <span style={{ flex: 1 }}>{fbResult.ok ? '✅ ' : '⚠️ '}{fbResult.text}</span>
          {!fbResult.ok && (
            <button onClick={connectFacebook} style={{ background: '#fff', border: 'none', color: '#7f1d1d', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {lang === 'vi' ? '↻ Connect lại' : '↻ Retry connect'}
            </button>
          )}
          <button onClick={() => setFbResult(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}
      {c?.connectTrace && fbResult && !fbResult.ok && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>
            🔬 {lang === 'vi' ? 'Chi tiết kỹ thuật lần kết nối gần nhất' : 'Last connect attempt — technical trace'} · {new Date(c.connectTrace.at).toLocaleString('en-US')}
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {c.connectTrace.steps.join('\n')}
          </div>
        </div>
      )}
      {pickList && (
        <div style={{ ...ui.card, marginBottom: 16, border: '1px solid #6366f1' }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
            {lang === 'vi' ? '📄 Facebook cấp nhiều page — chọn ĐÚNG page của tiệm này' : '📄 Facebook granted several Pages — pick THIS salon\'s page'}
          </div>
          <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.5 }}>
            {lang === 'vi' ? 'Tài khoản của bạn quản lý nhiều page khách. Chỉ page được chọn mới gắn vào tiệm đang setup — các page khác không bị ảnh hưởng.' : 'Your account manages many client pages. Only the page you pick is bound to the salon being set up — the rest are untouched.'}
          </p>
          {pickList.length === 0 ? (
            <p style={{ color: '#f59e0b', fontSize: 13 }}>{lang === 'vi' ? 'Danh sách đã hết hạn — bấm Connect làm lại.' : 'The list expired — press Connect and run the flow again.'}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {pickList.length > 6 && (
                <input
                  value={pickSearch}
                  onChange={(e) => setPickSearch(e.target.value)}
                  placeholder={lang === 'vi' ? `🔎 Tìm trong ${pickList.length} page — gõ tên tiệm hoặc Page ID` : `🔎 Search ${pickList.length} pages — name or Page ID`}
                  style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px', color: '#e2e8f0', fontSize: 13, marginBottom: 2 }}
                />
              )}
              {pickList
                .filter((pg) => {
                  const q = pickSearch.trim().toLowerCase();
                  return !q || pg.name.toLowerCase().includes(q) || pg.id.includes(q);
                })
                .slice(0, 40)
                .map((pg) => (
                <div key={pg.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pg.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{pg.id}</div>
                  </div>
                  {pg.taken === 'this' || c.pages?.some((x) => x.pageId === pg.id) ? (
                    <span style={{ color: '#34d399', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap' }}>✓ {lang === 'vi' ? 'Đã nối' : 'Connected'}</span>
                  ) : pg.taken === 'other' ? (
                    <span title={pg.takenBy || ''} style={{ color: '#f59e0b', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      🔒 {lang === 'vi' ? 'Đang dùng ở' : 'In use by'} {pg.takenBy || (lang === 'vi' ? 'tiệm khác' : 'another salon')}
                    </span>
                  ) : (
                  <button onClick={() => choosePage(pg.id)} disabled={!!picking}
                    style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: picking && picking !== pg.id ? 0.5 : 1 }}>
                    {picking === pg.id ? '…' : (lang === 'vi' ? 'Dùng page này' : 'Use this page')}
                  </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('subtitle')}</p>
      {error && <div style={ui.banner}>{error}</div>}
      {notice && <div style={{ ...ui.card, marginBottom: 16, borderColor: '#22c55e', color: '#bbf7d0', fontSize: 13.5, whiteSpace: 'pre-line', lineHeight: 1.6 }}>{notice}</div>}

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
                {connecting ? t('connecting') : (c.connected ? (lang === 'vi' ? '＋ Thêm page / kết nối lại' : '＋ Add page / reconnect') : t('connectFb'))}
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

      {/* Connection details + live webhook subscription status (App Review evidence) */}
      {c.connected && (
        <div style={{ ...ui.card, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('connDetailsTitle')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Field label={t('pageName')} value={wh?.pageName || c.pageName || '—'} />
            <Field label={t('pageIdLabel')} value={wh?.pageId || c.pageId || '—'} mono />
            <Field label={t('connStatus')} value={t('connected')} good />
            <Field label={t('webhookSub')} value={wh?.subscribed ? t('statusActive') : t('statusInactive')} good={!!wh?.subscribed} warn={!wh?.subscribed} />
          </div>
          <div style={{ marginTop: 12, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', fontSize: 12.5 }}>
            <div style={{ color: '#94a3b8', marginBottom: 4 }}>{t('subscribedEvents')}</div>
            <div style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
              {(wh?.fields && wh.fields.length ? wh.fields : ['messages', 'messaging_postbacks', 'message_reactions']).map((f) => `\u2713 ${f}`).join('   ')}
            </div>
            {wh?.verifiedAt && <div style={{ color: '#64748b', marginTop: 6 }}>{t('lastVerified')}: {new Date(wh.verifiedAt).toLocaleString('en-US')}</div>}
            {typeof wh?.echoOk === 'boolean' && (
              <div style={{ color: wh.echoOk ? '#34d399' : '#f59e0b', marginTop: 6 }}>
                {wh.echoOk
                  ? (lang === 'vi' ? '\u2713 Nh\u1eadn di\u1ec7n tin nh\u00e2n vi\u00ean (message_echoes): ho\u1ea1t \u0111\u1ed9ng \u2014 bot t\u1ef1 nh\u01b0\u1eddng khi ng\u01b0\u1eddi th\u1eadt tr\u1ea3 l\u1eddi' : '\u2713 Staff-reply detection (message_echoes): active \u2014 the bot yields when a human answers')
                  : (lang === 'vi' ? '\u26a0 Nh\u1eadn di\u1ec7n tin nh\u00e2n vi\u00ean (message_echoes): CH\u01afA b\u1eadt \u2014 h\u1ec7 th\u1ed1ng \u0111ang t\u1ef1 s\u1eeda, b\u1ea5m l\u00e0m m\u1edbi trang sau 1 ph\u00fat; n\u1ebfu v\u1eabn c\u1ea3nh b\u00e1o, ki\u1ec3m tra Meta App \u2192 Messenger \u2192 Webhooks' : '\u26a0 Staff-reply detection (message_echoes): NOT enabled \u2014 auto-repair is running, refresh in a minute; if it persists check Meta App \u2192 Messenger \u2192 Webhooks')}
              </div>
            )}
          </div>
          {!wh?.subscribed && <p style={{ color: '#f59e0b', fontSize: 12, margin: '8px 0 0' }}>{t('notSubscribed')}</p>}
          {(c.pages?.length ?? 0) > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                {lang === 'vi' ? `Các page đang dùng chung bot này (${c.pages.length})` : `Pages sharing this bot (${c.pages.length})`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {c.pages.map((pg) => (
                  <div key={pg.pageId} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: pg.enabled ? '#22c55e' : '#64748b', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pg.pageName || pg.pageId}</div>
                      <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{pg.pageId}{pg.igId ? ` · IG ${pg.igId}` : ''}</div>
                    </div>
                    <button onClick={() => disconnectPage(pg.pageId)}
                      style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#f87171', borderRadius: 7, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {lang === 'vi' ? 'Ngắt page' : 'Detach'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evidence blocks appear only once a Page is connected — a fresh page
          starts with just the Connect card, then these light up on connect. */}
      {c.connected && <>
      {/* Send a test message — a real user-initiated Send API call from the app UI */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{t('sendTestTitle')}</div>
        <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.5 }}>{t('sendTestHint')}</p>
        {threads.length === 0 ? (
          <p style={{ color: '#f59e0b', fontSize: 13 }}>{t('noRecipient')}</p>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 10 }}>
              {t('sendingAs')}: <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{wh?.pageName || c.pageName || '—'}</span>
            </div>
            <label style={ui.label}>{t('recipient')}</label>
            <select value={sendTo} onChange={(e) => setSendTo(e.target.value)} style={{ ...ui.input, marginBottom: 4 }}>
              {threads.map((th) => (
                <option key={th.id} value={th.id}>{th.senderName || `PSID …${th.senderId.slice(-6)}`}</option>
              ))}
            </select>
            {(() => {
              const cur = threads.find((x) => x.id === sendTo) || threads[0];
              return cur?.lastText
                ? <div style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px' }}>Last message: {cur.lastText.slice(0, 90)}</div>
                : <div style={{ marginBottom: 10 }} />;
            })()}
            <label style={ui.label}>{t('messageLabel')}</label>
            <textarea value={sendMsg} onChange={(e) => setSendMsg(e.target.value)} rows={2} placeholder={t('sendMsgPh')} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={sendTest} disabled={sending || !sendMsg.trim()} style={ui.primaryBtn}>{sending ? t('sendingMsg') : t('sendMessageBtn')}</button>
              {sendResult === 'ok' && <span style={{ color: '#22c55e', fontSize: 12.5 }}>{t('sentOk')}{sentAt ? ` · ${sentAt}` : ''}</span>}
              {sendResult && sendResult !== 'ok' && <span style={{ color: '#fca5a5', fontSize: 12.5 }}>{sendResult}</span>}
            </div>
          </>
        )}
      </div>

      {/* Messenger activity — chronological in/out log (App Review evidence) */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{t('activityTitle')}</div>
          <button onClick={silentRefresh} style={{ ...ghost, padding: '4px 10px', fontSize: 11.5 }}>{t('refreshActivity')}</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: '#e2e8f0', marginLeft: 'auto' }}>
            <input type="checkbox" checked={reviewMode} onChange={(e) => setReviewMode(e.target.checked)} />
            Meta Review Mode
          </label>
        </div>
        {(activityPage || wh?.pageName || c.pageName) && (
          <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 10 }}>
            Page: <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{activityPage || wh?.pageName || c.pageName}</span>
          </div>
        )}
        {reviewMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12.5 }}>
            <span style={{ color: '#94a3b8' }}>Review Test ID:</span>
            <code style={{ color: '#e2e8f0', fontWeight: 700 }}>{reviewId || '—'}</code>
            <button onClick={genReviewId} style={{ ...ghost, padding: '4px 10px', fontSize: 11.5 }}>Generate new review ID</button>
            {reviewId && <button onClick={() => copy(reviewId, 'rid')} style={{ ...ghost, padding: '4px 10px', fontSize: 11.5 }}>{copied === 'rid' ? '✓' : 'Copy'}</button>}
            <button onClick={clearReview} style={{ ...ghost, padding: '4px 10px', fontSize: 11.5, color: '#fca5a5', borderColor: '#7f1d1d' }}>Clear review test data</button>
            <button onClick={clearAllConvos} style={{ ...ghost, padding: '4px 10px', fontSize: 11.5, color: '#fca5a5', borderColor: '#7f1d1d' }}>Clear ALL conversations</button>
            {reviewNotice && <span style={{ color: '#22c55e' }}>{reviewNotice}</span>}
          </div>
        )}
        {shownActivity.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13.5 }}>{reviewMode ? 'No review activity yet — send a message containing the Review Test ID.' : t('noActivity')}</p>
        ) : (
          <div style={{ overflowX: 'auto', maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: '#94a3b8', textAlign: 'left' }}>
                  <th style={thc}>{t('colTime')}</th><th style={thc}>{t('colDirection')}</th><th style={thc}>{t('colUser')}</th><th style={thc}>{t('colMessage')}</th><th style={thc}>{t('colStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {shownActivity.map((ev, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #1e293b', background: (sentAtIso && ev.at === sentAtIso) || Date.now() - new Date(ev.at).getTime() < 30000 ? 'rgba(34,197,94,0.10)' : undefined }}>
                    <td style={{ ...tdc, whiteSpace: 'nowrap' }}>{new Date(ev.at).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                    <td style={{ ...tdc, color: ev.direction === 'in' ? '#38bdf8' : '#a3e635', fontWeight: 600 }}>{ev.direction === 'in' ? t('dirIn') : t('dirOut')}</td>
                    <td style={{ ...tdc, fontFamily: 'monospace', color: '#94a3b8' }}>{ev.user}</td>
                    <td style={{ ...tdc, maxWidth: 320 }}>{ev.text}</td>
                    <td style={{ ...tdc, color: ev.status === 'Failed' ? '#fca5a5' : ev.status === 'Received' ? '#38bdf8' : '#a3e635', fontWeight: 600 }}>{ev.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </>}

      {/* Webhook manual setup — advanced. The app auto-subscribes the Page on connect. */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <button onClick={() => setShowWebhook((v) => !v)} style={{ ...ghost, fontSize: 12.5 }}>
          {showWebhook ? '▾ ' : '▸ '}{t('webhookAdvancedTitle')}
        </button>
        {showWebhook && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 10px', lineHeight: 1.5 }}>{t('webhookAutoNote')}</p>
            {([['webhookUrl', c.webhookUrl], ['verifyToken', c.verifyToken]] as const).map(([k, val]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <label style={ui.label}>{t(k)}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input readOnly value={val} style={{ ...ui.input, fontFamily: 'monospace', fontSize: 12.5 }} />
                  <button onClick={() => copy(val, k)} style={{ ...ghost, whiteSpace: 'nowrap' }}>{copied === k ? t('copied') : t('copy')}</button>
                </div>
              </div>
            ))}
            <p style={{ color: '#64748b', fontSize: 11.5, margin: '8px 0 0', lineHeight: 1.5 }}>{t('webhookHint')}</p>
          </div>
        )}
      </div>

      {/* Behaviour */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>
          {t('behaviorTitle')} <span style={{ fontSize: 12.5, fontWeight: 500, color: c.aiEnabled ? '#22c55e' : '#f59e0b' }}>· {c.aiEnabled ? t('aiOn') : t('aiOff')}</span>
        </div>
        {canPickMode && (
          <>
            <label style={ui.label}>{t('modeLabel')}</label>
            <div style={{ display: 'inline-flex', border: '1px solid #334155', borderRadius: 10, overflow: 'hidden', marginBottom: 6 }}>
              {(['booking', 'sales'] as const).map((m) => (
                <button key={m}
                  onClick={() => { setC({ ...c, botMode: m }); save({ botMode: m }); }}
                  style={{ padding: '8px 16px', fontSize: 13, border: 'none', cursor: 'pointer',
                    background: c.botMode === m ? '#6366f1' : 'transparent',
                    color: c.botMode === m ? '#fff' : '#64748b', fontWeight: c.botMode === m ? 700 : 500 }}>
                  {m === 'booking' ? t('modeBooking') : t('modeSales')}
                </button>
              ))}
            </div>
            <p style={{ color: '#64748b', fontSize: 11.5, margin: '0 0 12px', lineHeight: 1.5 }}>{t('modeHint')}</p>
            {c.botMode === 'sales' && (
              <>
                <label style={ui.label}>{t('leadEmail')}</label>
                <input value={c.leadEmail} placeholder={t('leadEmailPh')}
                  onChange={(e) => setC({ ...c, leadEmail: e.target.value })} onBlur={() => save({})}
                  style={{ ...ui.input, marginBottom: 12 }} />
              </>
            )}
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={ui.label}>{lang === 'vi' ? 'Tên nhân viên (bot xưng tên này)' : 'Staff name (the bot goes by it)'}</label>
            <input value={c.agentName} placeholder={lang === 'vi' ? 'vd: Vy' : 'e.g. Amy'}
              onChange={(e) => setC({ ...c, agentName: e.target.value })} onBlur={() => save({})} style={ui.input} />
          </div>
          <div>
            <label style={ui.label}>{lang === 'vi' ? 'Giới thiệu doanh nghiệp (1 câu bot dùng khi tự giới thiệu)' : 'Business intro (one line the bot uses)'}</label>
            <input value={c.bizIntro}
              placeholder={lang === 'vi' ? 'vd: agency marketing trọn gói — website, quảng cáo, chatbot AI, phần mềm đặt lịch cho salon, spa, nhà hàng' : 'e.g. full-service marketing agency — websites, ads, AI chat, booking software'}
              onChange={(e) => setC({ ...c, bizIntro: e.target.value })} onBlur={() => save({})} style={ui.input} />
          </div>
        </div>
        <p style={{ color: '#64748b', fontSize: 11.5, margin: '-4px 0 12px', lineHeight: 1.5 }}>
          {lang === 'vi'
            ? 'Đặt tên là bot nói chuyện như một nhân viên thật, không tự nhận là trợ lý. Nếu khách hỏi thẳng "bot hả?", bot không nói dối — nó khéo léo mời gọi lại ngay và ghi lead.'
            : 'With a name set, the bot speaks as a real team member and never calls itself an assistant. Asked point-blank "is this a bot?", it won\u2019t lie — it gracefully offers an instant call back and logs the lead.'}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12, maxWidth: 460 }}>
          <div>
            <label style={ui.label}>{lang === 'vi' ? 'Nhân viên "đang trực" trong (phút)' : 'Staff counts as active for (min)'}</label>
            <input type="number" min={1} max={720} value={c.humanActiveMins}
              onChange={(e) => setC({ ...c, humanActiveMins: Math.min(720, Math.max(1, Number(e.target.value) || 15)) })}
              onBlur={() => save({})} style={ui.input} />
          </div>
          <div>
            <label style={ui.label}>{lang === 'vi' ? 'Bot nhường người thật (phút)' : 'Bot yields to a human for (min)'}</label>
            <input type="number" min={0} max={60} value={c.graceMins}
              onChange={(e) => setC({ ...c, graceMins: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })}
              onBlur={() => save({})} style={ui.input} />
          </div>
        </div>
        <p style={{ color: '#64748b', fontSize: 11.5, margin: '-4px 0 12px', lineHeight: 1.5 }}>
          {lang === 'vi'
            ? 'Nhân viên vừa nhắn trong X phút thì mỗi tin mới của khách được nhường Y phút cho người thật; hết Y phút bot trả lời. Nhân viên im quá X phút thì bot trực lại ngay. Y = 0 nghĩa là bot không chờ.'
            : 'If staff messaged within X minutes, each new customer message waits Y minutes for a human; then the bot answers. Staff idle past X minutes → bot resumes instantly. Y = 0 means the bot never waits.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <label style={ui.label}>{t('greeting')}</label>
          <button type="button" onClick={() => setGreetOpen((v) => !v)}
            style={{ background: 'transparent', border: '1px solid #6366f1', color: '#a5b4fc', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', marginBottom: 6 }}>
            {lang === 'vi' ? '✨ Nhờ AI viết giúp' : '✨ Let AI write it'}
          </button>
        </div>
        <textarea value={c.greeting} placeholder={t('greetingPh')} rows={2} onChange={(e) => setC({ ...c, greeting: e.target.value })} onBlur={() => save({})} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5, marginBottom: greetOpen ? 8 : 12 }} />
        {greetOpen && (
          <div style={{ background: '#0f172a', border: '1px solid #312e81', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 8px', lineHeight: 1.5 }}>
              {lang === 'vi'
                ? 'AI đọc dịch vụ, ưu đãi đang chạy, giờ làm và địa chỉ của tiệm để viết. Gõ thêm ý bạn muốn nhấn mạnh (không bắt buộc).'
                : 'AI reads your services, live discounts, hours and address. Add anything you want emphasised (optional).'}
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input value={greetKeywords} onChange={(e) => setGreetKeywords(e.target.value)}
                placeholder={lang === 'vi' ? 'vd: nhấn mạnh bột dip, đang giảm 20% cho khách mới' : 'e.g. highlight dip powder, 20% off for new clients'}
                style={{ ...ui.input, flex: 1, minWidth: 220, marginBottom: 0 }} />
              <button type="button" onClick={suggestGreeting} disabled={greetBusy}
                style={{ background: '#6366f1', border: 'none', color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 12.5, fontWeight: 700, cursor: greetBusy ? 'wait' : 'pointer', opacity: greetBusy ? 0.6 : 1 }}>
                {greetBusy ? (lang === 'vi' ? 'Đang viết…' : 'Writing…') : (lang === 'vi' ? 'Gợi ý 3 câu' : 'Draft 3')}
              </button>
            </div>
            {greetErr && <p style={{ color: '#f87171', fontSize: 12, margin: '8px 0 0' }}>{greetErr}</p>}
            {greetOptions && greetOptions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {greetOptions.map((op, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#111827', border: '1px solid #334155', borderRadius: 8, padding: '9px 11px' }}>
                    <div style={{ flex: 1, color: '#e2e8f0', fontSize: 13, lineHeight: 1.55 }}>{op}</div>
                    <button type="button"
                      onClick={() => { setC({ ...c, greeting: op }); save({ greeting: op }); setGreetOpen(false); setGreetOptions(null); }}
                      style={{ background: '#22c55e', border: 'none', color: '#052e16', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {lang === 'vi' ? 'Dùng' : 'Use'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <label style={ui.label}>{lang === 'vi' ? 'Câu kết thúc / cảm ơn (tùy chọn)' : 'Goodbye / thank-you line (optional)'}</label>
        <textarea value={c.closing} rows={2}
          placeholder={lang === 'vi' ? 'vd: Cảm ơn anh/chị đã tin tưởng Lumio — chúc một ngày thật đẹp ạ! 🌸' : 'e.g. Thank you for trusting Lumio — have a lovely day! 🌸'}
          onChange={(e) => setC({ ...c, closing: e.target.value })} onBlur={() => save({})}
          style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5, marginBottom: 12 }} />
        <p style={{ color: '#64748b', fontSize: 11.5, margin: '-6px 0 12px', lineHeight: 1.5 }}>
          {lang === 'vi' ? 'Bot không dán nguyên văn — nó chào tạm biệt theo đúng tinh thần câu này, bằng ngôn ngữ của khách.' : 'Not pasted verbatim — the bot says goodbye in the spirit of this line, in the customer\u2019s language.'}
        </p>
        <label style={ui.label}>{t('extraNotes')}</label>
        <textarea value={c.aiInstruction} placeholder={t('extraNotesPh')} rows={3} onChange={(e) => setC({ ...c, aiInstruction: e.target.value })} onBlur={() => save({})} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
      </div>

      {/* Knowledge import: website / fanpage → proposed facts → human approves */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
          📥 {lang === 'vi' ? 'Nạp kiến thức tự động' : 'Auto-import knowledge'}
        </div>
        <p style={{ color: '#94a3b8', fontSize: 12.5, margin: '0 0 12px', lineHeight: 1.55 }}>
          {lang === 'vi'
            ? 'Đọc website hoặc fanpage, AI chưng cất thành các dòng thông tin — bạn duyệt rồi mới lưu. Bot chỉ nói những gì đã được duyệt.'
            : 'Reads your website or fanpage and distills it into fact rows — you approve before saving. The bot only speaks approved facts.'}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://lumioagency.com"
            style={{ ...ui.input, flex: 1, minWidth: 220 }} />
          <button onClick={() => importFacts('website')} disabled={!!importing || !importUrl.trim()}
            style={{ ...ui.primaryBtn, opacity: importing || !importUrl.trim() ? 0.6 : 1 }}>
            {importing === 'website' ? '…' : (lang === 'vi' ? '🌐 Đọc website' : '🌐 Read website')}
          </button>
          <button onClick={() => importFacts('page')} disabled={!!importing || !c.connected}
            title={c.connected ? '' : (lang === 'vi' ? 'Kết nối page trước' : 'Connect the page first')}
            style={{ ...ui.primaryBtn, background: '#1877f2', opacity: importing || !c.connected ? 0.6 : 1 }}>
            {importing === 'page' ? '…' : (lang === 'vi' ? '📘 Đọc từ Fanpage' : '📘 Read from Fanpage')}
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          <label style={ui.label}>{lang === 'vi' ? '✍️ Hoặc dán nội dung bạn muốn bot truyền tải (khuyến mãi, bảng giá, cách chào khách…)' : '✍️ Or paste anything the bot should carry (promos, price list, how to greet…)'}</label>
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={4}
            placeholder={lang === 'vi' ? 'Dán tự do — hệ thống tự nhận ra đâu là thông tin, đâu là giọng điệu, đâu là câu chào/câu cảm ơn.' : 'Paste freely — the system sorts out facts, tone, hello and thank-you lines by itself.'}
            style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
          <button onClick={() => importFacts('paste')} disabled={!!importing || pasteText.trim().length < 20}
            style={{ ...ui.primaryBtn, marginTop: 8, opacity: importing || pasteText.trim().length < 20 ? 0.6 : 1 }}>
            {lang === 'vi' ? '✨ Phân loại tự động' : '✨ Sort it out'}
          </button>
        </div>
        {importErr && <div style={{ color: '#f87171', fontSize: 13, marginTop: 10 }}>{importErr}</div>}
        {suggest && (
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {([['greeting', lang === 'vi' ? 'Câu chào' : 'Greeting'], ['closing', lang === 'vi' ? 'Câu kết thúc' : 'Goodbye'], ['instruction', lang === 'vi' ? 'Giọng điệu / luật' : 'Tone / rules']] as const).map(([k, title]) => {
              const v = suggest[k];
              if (!v) return null;
              return (
                <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, color: '#a5b4fc', marginBottom: 3 }}>{title}</div>
                    <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.5 }}>{v}</div>
                  </div>
                  <button
                    onClick={() => {
                      if (k === 'greeting') { setC({ ...c, greeting: v }); save({ greeting: v }); }
                      else if (k === 'closing') { setC({ ...c, closing: v }); save({ closing: v }); }
                      else { const nv = c.aiInstruction ? `${c.aiInstruction}\n${v}` : v; setC({ ...c, aiInstruction: nv }); save({ aiInstruction: nv }); }
                      setSuggest((sg) => sg ? { ...sg, [k]: null } : sg);
                    }}
                    style={{ ...ui.primaryBtn, padding: '6px 14px', fontSize: 12.5, flexShrink: 0 }}>
                    {lang === 'vi' ? 'Dùng' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {proposed && (
          <div style={{ marginTop: 14, border: '1px solid #334155', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#a5b4fc', marginBottom: 8 }}>
              {lang === 'vi' ? `AI đề xuất ${proposed.length} mục — bỏ tick mục nào sai rồi bấm thêm:` : `AI proposes ${proposed.length} row(s) — untick anything wrong, then add:`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
              {proposed.map((f, i) => (
                <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: '#cbd5e1', cursor: 'pointer' }}>
                  <input type="checkbox" checked={f.pick}
                    onChange={(e) => setProposed((ps) => ps ? ps.map((x, k) => k === i ? { ...x, pick: e.target.checked } : x) : ps)}
                    style={{ marginTop: 2 }} />
                  <span><b style={{ color: '#e2e8f0' }}>{f.label}:</b> {f.value}</span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={mergeProposed} disabled={!proposed.some((f) => f.pick)} style={{ ...ui.primaryBtn, opacity: proposed.some((f) => f.pick) ? 1 : 0.5 }}>
                {lang === 'vi' ? `➕ Thêm ${proposed.filter((f) => f.pick).length} mục vào Bot facts` : `➕ Add ${proposed.filter((f) => f.pick).length} row(s) to Bot facts`}
              </button>
              <button onClick={() => setProposed(null)} style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}>
                {lang === 'vi' ? 'Bỏ qua' : 'Discard'}
              </button>
            </div>
          </div>
        )}
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

      {/* Conversations — hidden until a Page is connected, so a fresh page
          shows nothing but the Connect card (clean App-Review opening shot). */}
      {c.connected && (
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
                        <div style={{ color: '#cbd5e1', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {th.senderName && <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{th.senderName} · </span>}{th.lastText || '—'}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 11 }}>{new Date(th.updatedAt).toLocaleString('en-US')}{th.handoff ? ` · ⚠️ ${t('handedOff')}` : ''}</div>
                      </div>
                      <button onClick={() => renameThread(th.id, th.senderName || '')} title="Set customer name" style={{ ...ghost, padding: '6px 10px' }}>✎</button>
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
      )}

      {/* Sales-mode leads: the bot's handover list for the human team. */}
      {c.connected && c.botMode === 'sales' && (
      <div style={{ ...ui.card, marginTop: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 10 }}>🔥 {t('leadsTitle')} ({leads.length})</div>
        {leads.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13.5 }}>{t('noLeads')}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                {['👤', '📞', '💅', '💬', ''].map((h, i) => <th key={i} style={{ textAlign: 'left', color: '#94a3b8', fontSize: 11, padding: '6px 8px', borderBottom: '1px solid #334155' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #1f2937' }}>
                    <td style={{ padding: '9px 8px', fontWeight: 700, color: '#e2e8f0' }}>{l.name}{l.salonName ? <span style={{ display: 'block', fontSize: 11, fontWeight: 500, color: '#64748b' }}>{l.salonName}{l.city ? ` · ${l.city}` : ''}</span> : null}</td>
                    <td style={{ padding: '9px 8px', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{l.phone}</td>
                    <td style={{ padding: '9px 8px', color: '#94a3b8', maxWidth: 220 }}>{l.interest || '—'}{l.note ? <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>{l.note}</span> : null}</td>
                    <td style={{ padding: '9px 8px', color: '#64748b', fontSize: 11.5, whiteSpace: 'nowrap' }}>{new Date(l.createdAt).toLocaleDateString('en-US')}</td>
                    <td style={{ padding: '9px 8px' }}>
                      <select value={l.status}
                        onChange={async (e) => {
                          const status = e.target.value;
                          setLeads((ls) => ls.map((x) => x.id === l.id ? { ...x, status } : x));
                          try { await apiFetch(`/messenger/leads/${l.id}/status`, { method: 'POST', token, body: { status } }); } catch { /* next refresh corrects */ }
                        }}
                        style={{ ...ui.input, padding: '5px 8px', fontSize: 12, width: 120 }}>
                        <option value="NEW">{t('ldNew')}</option>
                        <option value="CONTACTED">{t('ldCtd')}</option>
                        <option value="WON">{t('ldWon')}</option>
                        <option value="LOST">{t('ldLost')}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </section>
  );
}

const thc: React.CSSProperties = { padding: '6px 10px', fontWeight: 600, position: 'sticky', top: 0, background: '#1e293b', zIndex: 1 };
const tdc: React.CSSProperties = { padding: '6px 10px', color: '#cbd5e1', verticalAlign: 'top' };

function Field({ label, value, mono, good, warn }: { label: string; value: string; mono?: boolean; good?: boolean; warn?: boolean }) {
  return (
    <div>
      <div style={{ color: '#94a3b8', fontSize: 11.5, marginBottom: 3 }}>{label}</div>
      <div style={{ color: good ? '#22c55e' : warn ? '#f59e0b' : '#e2e8f0', fontSize: 13.5, fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}

const ghost: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 12.5, cursor: 'pointer',
};

const fbBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 10, padding: '12px 20px', borderRadius: 10,
  border: 'none', background: '#1877F2', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
