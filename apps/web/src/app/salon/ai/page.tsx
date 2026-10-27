'use client';

/**
 * /salon/ai — THE SALON'S AI, SET UP IN ONE PLACE.
 *
 * Every note that shapes what the hotline, Messenger, Instagram, Zalo and the
 * website chat say lives here, grouped by who reads it:
 *   - Shared by every channel: persona & languages, the salon's knowledge,
 *     the owner's instructions (and the questions the AI could not answer),
 *     booking & hand-off, customer memory;
 *   - Messages only: the chat greeting (the same one the Facebook Page
 *     shows), extra notes for chat, how long the AI stays quiet, follow-ups;
 *   - Hotline only: the phone greeting (the keypad menu says it too), extra
 *     notes for the phone, how the caller's language is found, the transfer
 *     number, silence;
 *   - Checking: health, a sandbox and the logs.
 * The Messenger and Hotline pages keep only their wiring (page, number,
 * ringing). Notes typed on their old boxes are moved in here once, with an
 * Undo (banner at the top). Mockup: canvas "AI — Một chỗ cài đặt".
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { ui } from '../../../lib/ui';
import { useIsMobile } from '../../../lib/responsive';
import { FollowUpBox } from '../../../components/FollowUpBox';
import { AiInstructionsTab } from '../../../components/AiInstructionsTab';
import { TeachAiPanel, canTeachAi, type InsChannel } from '../../../components/TeachAiPanel';

type Lang = 'en' | 'vi' | 'es' | 'zh' | 'ko' | 'fr' | 'ja';
type Tab = 'overview' | 'teach' | 'persona' | 'knowledge' | 'booking' | 'chat' | 'voice' | 'memory' | 'sandbox';
const TABS: Tab[] = ['persona', 'knowledge', 'teach', 'booking', 'memory', 'chat', 'voice', 'overview', 'sandbox'];
/** The sections in the order the owner reads them, by who uses them. */
const GROUPS: { id: 'shared' | 'chat' | 'voice' | 'check'; vi: string; en: string; color: string; tabs: Tab[] }[] = [
  { id: 'shared', vi: 'CHUNG CHO MỌI KÊNH', en: 'SHARED BY EVERY CHANNEL', color: 'var(--ca5b4fc)', tabs: ['persona', 'knowledge', 'teach', 'booking', 'memory'] },
  { id: 'chat', vi: 'CHỈ MESSENGER & CHAT', en: 'MESSAGES ONLY', color: 'var(--c38bdf8)', tabs: ['chat'] },
  { id: 'voice', vi: 'CHỈ HOTLINE', en: 'HOTLINE ONLY', color: 'var(--cfbbf24)', tabs: ['voice'] },
  { id: 'check', vi: 'KIỂM TRA', en: 'CHECKING', color: 'var(--c94a3b8)', tabs: ['overview', 'sandbox'] },
];
/** Old links (?tab=channels) land on the messages section. */
const ALIAS: Record<string, Tab> = { channels: 'chat' };
const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt' }, { id: 'es', label: 'Español' },
  { id: 'zh', label: '中文' }, { id: 'ko', label: '한국어' }, { id: 'fr', label: 'Français' }, { id: 'ja', label: '日本語' },
];

interface Brain {
  persona: { agentName: string; tone: 'warm' | 'professional' | 'brief'; intro: string; greeting: string; signoff: string };
  languages: { primary: Lang; allowed: Lang[]; voiceOpening: 'auto' | 'menu' | 'single' };
  knowledge: { facts: { label: string; value: string; on: boolean; from?: string; until?: string }[]; rules: string };
  booking: { canBook: boolean; allowGroup: boolean; maxParty: number; canReschedule: boolean; canCancel: boolean; askExtras: boolean; whenFull: 'offer-nearest' | 'say-full' | 'waitlist' };
  handoff: { transferNumber: string; silenceRetries: number; staffQuietMins: number; notifyOwnerPush: boolean; notifyDeskPush: boolean; notifyOwnerSms: boolean };
  channels: { voice: { greeting: string; extra: string }; chat: { greeting: string; extra: string; sendPhotos: boolean; nudgeHours: number; yieldMins: number } };
  version: number; updatedAt: string | null; updatedBy: string | null;
}
interface OldNote { source: string; where: { vi: string; en: string }; into: { vi: string; en: string }; text: string }
interface View {
  brain: Brain; legacy: boolean; canEdit: boolean; salon: { name: string; market: string };
  oldNotes?: { notes: OldNote[]; mergedAt: string | null; canUndo: boolean };
  channels: { voice: { provisioned: boolean; enabled: boolean; number: string | null; mode: string; schedule: string }; messenger: { connected: boolean; enabled: boolean; pageName: string | null; instagram: boolean } };
}
interface Health { days: number; total: number; byChannel: Record<string, number>; booked: number; bookedCount: number; endReasons: Record<string, number>; slowTurns: number; errorEnds: number; refusedBookings: number; openCallbacks: number; labels: Record<string, { vi: string; en: string }> }
interface Callback { id: string; channel: string; reason: string; summary: string; phone: string | null; name: string | null; customerId: string | null; createdAt: string; doneAt: string | null }
interface Session { id: string; channel: string; externalId: string; customerId: string | null; customerName: string | null; phone: string | null; lang: string | null; outcome: string; endReason: string; turns: number; toolCalls: number; slowTurns: number; maxTurnMs: number; bookedIds: string[]; failures: { at: string; what: string }[]; startedAt: string; endedAt: string | null }
interface MemoryRow { customerId: string; name: string | null; phone: string | null; preferredLang: string | null; lastChannel: string | null; lastContactAt: string | null; openIntent: string | null; profileShort: string }
interface MemoryDetail { customer: { id: string; name: string; phone: string | null; email: string | null }; memory: { profile: string; preferredLang: string | null; openIntent: { text: string; at: string; channel: string } | null; lastChannel: string | null; lastContactAt: string | null; salonNote: string } | null; sessions: Session[]; visits: { at: string; service: string; staff: string | null; priceCents: number }[] }

const L = (vi: boolean, v: string, e: string) => (vi ? v : e);
const CH_LABEL: Record<string, string> = { voice: 'Hotline', messenger: 'Messenger', instagram: 'Instagram', zalo: 'Zalo', web: 'Web chat' };

export default function AiBrainPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const phone = useIsMobile(720);
  const asked = params.get('tab') ?? '';
  const chosen: Tab | null = (TABS as string[]).includes(asked) ? (asked as Tab) : ALIAS[asked] ?? null;
  // A phone opens on the list of sections (mockup board 4); a wider screen on the first one.
  const tab: Tab = chosen ?? 'persona';
  const listOnly = phone && !chosen;
  const setTab = (t: Tab) => router.replace(`${pathname}?tab=${t}`);
  const toList = () => router.replace(pathname);

  const [view, setView] = useState<View | null>(null);
  const [brain, setBrain] = useState<Brain | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<View>('/ai-brain/settings', { token }).then((v) => { setView(v); setBrain(v.brain); setDirty(false); }).catch((e) => setMsg(e instanceof Error ? e.message : 'Error'));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const patch = (fn: (b: Brain) => Brain) => { setBrain((b) => (b ? fn(b) : b)); setDirty(true); setMsg(null); };
  const save = async () => {
    if (!brain) return;
    setBusy(true); setMsg(null);
    try {
      const next = await apiFetch<Brain>('/ai-brain/settings', { method: 'PATCH', token, body: brain });
      // The chat greeting's home is the Messenger connection: saving it there
      // also puts it on the Page's welcome screen.
      if (view && view.channels.messenger.connected && brain.channels.chat.greeting !== view.brain.channels.chat.greeting) {
        await apiFetch('/messenger/settings', { method: 'POST', token, body: { greeting: brain.channels.chat.greeting } }).catch(() => undefined);
        next.channels.chat.greeting = brain.channels.chat.greeting;
      }
      setBrain(next); setDirty(false);
      setView((v) => (v ? { ...v, brain: next, legacy: false } : v));
      setMsg(L(vi, `✓ Đã lưu — phiên bản ${next.version}, áp dụng cho mọi kênh`, `✓ Saved — version ${next.version}, applied to every channel`));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };

  if (!view || !brain) return <div style={{ padding: 24, color: msg ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{msg ?? L(vi, 'Đang tải…', 'Loading…')}</div>;
  const canEdit = view.canEdit;

  const tabLabel: Record<Tab, string> = {
    persona: L(vi, 'Nhân cách & ngôn ngữ', 'Persona & languages'),
    knowledge: L(vi, 'Kiến thức tiệm', 'The salon’s knowledge'),
    teach: L(vi, 'Lời dặn của chủ tiệm', 'Owner’s instructions'),
    booking: L(vi, 'Đặt lịch & chuyển người', 'Booking & hand-off'),
    memory: L(vi, 'Trí nhớ khách', 'Customer memory'),
    chat: L(vi, 'Cách trả lời tin nhắn', 'How it answers messages'),
    voice: L(vi, 'Cách nói trên điện thoại', 'How it talks on the phone'),
    overview: L(vi, 'Sức khoẻ & việc gọi lại', 'Health & callbacks'),
    sandbox: L(vi, 'Thử AI & nhật ký', 'Try it & logs'),
  };
  const tabSub: Partial<Record<Tab, string>> = {
    persona: [brain.persona.agentName, brain.languages.allowed.map((l) => l.toUpperCase()).join(', ')].filter(Boolean).join(' · '),
    knowledge: L(vi, `${brain.knowledge.facts.length} điều AI cần biết`, `${brain.knowledge.facts.length} things to know`),
    booking: [brain.booking.canBook ? L(vi, 'Tự đặt', 'Books') : L(vi, 'Không tự đặt', 'No booking'), brain.booking.allowGroup ? L(vi, `nhóm ≤ ${brain.booking.maxParty}`, `groups ≤ ${brain.booking.maxParty}`) : ''].filter(Boolean).join(' · '),
    chat: brain.channels.chat.greeting ? L(vi, 'Có lời chào', 'Greeting set') : L(vi, 'Chưa có lời chào', 'No greeting'),
    voice: brain.handoff.transferNumber ? L(vi, `Chuyển ${brain.handoff.transferNumber}`, `Transfers to ${brain.handoff.transferNumber}`) : L(vi, 'Chưa có số chuyển máy', 'No transfer number'),
  };
  const nav = (
    <nav aria-label={L(vi, 'Các phần cài đặt AI', 'AI settings sections')} style={{ flex: phone ? '1 1 100%' : '0 0 250px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {GROUPS.map((g) => (
        <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '.06em', color: g.color, padding: '0 10px 6px' }}>{vi ? g.vi : g.en}</span>
          {g.tabs.map((t) => {
            const on = !listOnly && tab === t;
            return (
              <button key={t} type="button" aria-current={on ? 'page' : undefined} onClick={() => setTab(t)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: phone ? 56 : 40, padding: '6px 10px', borderRadius: 10, border: phone ? '1px solid var(--line)' : 'none', marginBottom: phone ? 6 : 0,
                  background: on ? 'var(--c1e293b)' : phone ? 'var(--c111827)' : 'transparent', color: on ? 'var(--cf1f5f9)' : 'var(--ccbd5e1)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: on || phone ? 700 : 600 }}>{tabLabel[t]}</span>
                  {phone && tabSub[t] && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c94a3b8)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tabSub[t]}</span>}
                </span>
                {phone && <span aria-hidden style={{ color: 'var(--c94a3b8)' }}>›</span>}
              </button>
            );
          })}
        </div>
      ))}
      {!phone && (
        <p style={{ margin: 0, padding: 10, border: '1px dashed var(--line-strong)', borderRadius: 10, fontSize: 12.5, lineHeight: 1.5, color: 'var(--c94a3b8)' }}>
          {L(vi, 'Nối Page, Instagram, Zalo, số hotline: ở trang ', 'Connecting the Page, Instagram, Zalo and the hotline number: on the ')}
          <Link href="/salon/messenger" style={{ color: 'var(--ink-link)' }}>Messenger</Link>{L(vi, ' và ', ' and ')}<Link href="/salon/voice" style={{ color: 'var(--ink-link)' }}>Hotline</Link>{L(vi, '. Trang này chỉ dạy AI.', ' pages. This page only teaches the AI.')}
        </p>
      )}
    </nav>
  );

  return (
    <div style={{ padding: '20px 16px 80px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 320px' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ce2e8f0)', margin: 0 }}>🧠 {L(vi, 'Bộ não AI', 'AI brain')} · {view.salon.name}</h1>
          <p style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '4px 0 0', lineHeight: 1.5 }}>
            {L(vi, 'Một bộ não cho hotline, Messenger, Instagram, Zalo và web chat. Sửa ở đây, mọi kênh đổi theo.', 'One brain for the hotline, Messenger, Instagram, Zalo and web chat. Change it here, every channel follows.')}
            {' '}<span style={{ color: 'var(--c64748b)' }}>{brain.version ? L(vi, `Phiên bản ${brain.version}`, `Version ${brain.version}`) : L(vi, 'Chưa lưu lần nào (đang dùng cài đặt cũ)', 'Never saved (reading the old screens)')}{brain.updatedBy ? ` · ${brain.updatedBy}` : ''}</span>
          </p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {msg && <span style={{ fontSize: 13, color: msg.startsWith('✓') ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{msg}</span>}
            <button type="button" disabled={busy || !dirty} onClick={save} style={{ ...ui.primaryBtn, padding: '11px 18px', fontSize: 14, opacity: busy || !dirty ? 0.6 : 1 }}>{busy ? L(vi, 'Đang lưu…', 'Saving…') : L(vi, 'Lưu — áp dụng cho mọi kênh', 'Save — apply to every channel')}</button>
          </div>
        )}
      </div>
      {view.legacy && (
        <div style={{ ...ui.banner, marginTop: 12 }}>{L(vi, 'Bộ não này được ghép từ cài đặt cũ ở trang Messenger và Hotline. Bấm Lưu một lần để cố định; từ đó chỉ sửa ở đây.', 'This brain is assembled from the old Messenger and Hotline screens. Save once to fix it here; from then on this is the only place.')}</div>
      )}
      {!canEdit && <div style={{ ...ui.banner, marginTop: 12 }}>{L(vi, 'Chỉ chủ tiệm hoặc quản lý sửa được. Bạn đang xem.', 'Only the owner or a manager can change this. You are viewing.')}</div>}

      {canEdit && view.oldNotes && <OldNotes token={token} vi={vi} info={view.oldNotes} onDone={load} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start', marginTop: 16 }}>
        {(!phone || listOnly) && nav}
        {!listOnly && (
          <div style={{ flex: '999 1 560px', minWidth: 0 }}>
            {phone && (
              <button type="button" onClick={toList} style={{ ...ghost, marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}>‹ {L(vi, 'Tất cả mục', 'All sections')}</button>
            )}
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--ce2e8f0)', margin: '0 0 4px' }}>{tabLabel[tab]}</h2>
            <p style={{ fontSize: 12.5, fontWeight: 700, margin: '0 0 14px', color: tab === 'chat' ? 'var(--c38bdf8)' : tab === 'voice' ? 'var(--cfbbf24)' : 'var(--ca5b4fc)' }}>
              {tab === 'chat' ? L(vi, 'Dùng cho: Messenger · Instagram · Zalo · chat web', 'Used by: Messenger · Instagram · Zalo · web chat')
                : tab === 'voice' ? L(vi, 'Dùng cho: Hotline', 'Used by: the hotline')
                  : tab === 'overview' || tab === 'sandbox' ? L(vi, 'Kiểm tra AI đang làm gì', 'Check what the AI is doing')
                    : L(vi, 'Dùng cho: mọi kênh', 'Used by: every channel')}
            </p>
            {tab === 'overview' && <Overview token={token} vi={vi} view={view} onGo={setTab} />}
            {tab === 'teach' && <AiInstructionsTab token={token} vi={vi} />}
            {tab === 'persona' && <Persona brain={brain} patch={patch} vi={vi} canEdit={canEdit} />}
            {tab === 'knowledge' && <Knowledge brain={brain} patch={patch} vi={vi} canEdit={canEdit} token={token} pageConnected={view.channels.messenger.connected} />}
            {tab === 'booking' && <Booking brain={brain} patch={patch} vi={vi} canEdit={canEdit} />}
            {tab === 'chat' && <ChatSection brain={brain} patch={patch} vi={vi} canEdit={canEdit} view={view} token={token} />}
            {tab === 'voice' && <VoiceSection brain={brain} patch={patch} vi={vi} canEdit={canEdit} view={view} />}
            {tab === 'memory' && <Memory token={token} vi={vi} canEdit={canEdit} />}
            {tab === 'sandbox' && <Sandbox token={token} vi={vi} />}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section style={{ ...ui.card, marginBottom: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', margin: '2px 0 10px', lineHeight: 1.5 }}>{hint}</div>}
      {!hint && <div style={{ height: 8 }} />}
      {children}
    </section>
  );
}
function Toggle({ on, onChange, label, hint, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', cursor: disabled ? 'default' : 'pointer' }}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
      <span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{label}</span>
        {hint && <span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2, lineHeight: 1.45 }}>{hint}</span>}
      </span>
    </label>
  );
}
function Pill({ on, label, onClick, disabled }: { on: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={on
        ? { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1.5px solid #6366f1', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
        : { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1.5px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
      {label}
    </button>
  );
}
const field = (vi: boolean) => ({ label: { ...ui.label }, input: { ...ui.input }, hint: { fontSize: 12, color: 'var(--c94a3b8)', marginTop: 4 } as React.CSSProperties, L: (v: string, e: string) => L(vi, v, e) });
const ghost: React.CSSProperties = { ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--line-strong)', color: 'var(--ce2e8f0)' };
const fmtWhen = (iso: string | null | undefined, vi: boolean) => (iso ? new Date(iso).toLocaleString(vi ? 'vi-VN' : undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—');

// ---------------------------------------------------------------- 1 · overview

function Overview({ token, vi, view, onGo }: { token: string | null; vi: boolean; view: View; onGo: (t: Tab) => void }) {
  const [h, setH] = useState<Health | null>(null);
  const [cbs, setCbs] = useState<Callback[]>([]);
  const load = useCallback(() => {
    if (!token) return;
    apiFetch<Health>('/ai-brain/health?days=7', { token }).then(setH).catch(() => setH(null));
    apiFetch<Callback[]>('/ai-brain/callbacks', { token }).then(setCbs).catch(() => setCbs([]));
  }, [token]);
  useEffect(() => { load(); }, [load]);
  const done = async (id: string) => { await apiFetch(`/ai-brain/callbacks/${id}/done`, { method: 'PATCH', token }); load(); };
  const reasons = h ? Object.entries(h.endReasons).sort((a, b) => b[1] - a[1]) : [];
  const max = Math.max(1, ...reasons.map((r) => r[1]));
  const colorOf = (r: string) => (r === 'goodbye' || r === 'booked_done' ? 'var(--ink-good)' : r === 'transfer' ? 'var(--ink-link)' : r === 'caller_hangup' || r === 'in_progress' || r === 'voicemail' || r === 'off_hours' ? 'var(--c94a3b8)' : r === 'error' || r === 'deadline' || r === 'tool_loop' ? 'var(--ink-bad)' : 'var(--ink-warn)');
  const tile = (label: string, value: string | number, sub: string, color?: string) => (
    <div style={{ ...ui.card, padding: 14 }}><div style={{ fontSize: 12, color: 'var(--c94a3b8)', fontWeight: 600 }}>{label}</div><div style={{ fontSize: 26, fontWeight: 800, marginTop: 2, color: color ?? 'var(--ce2e8f0)' }}>{value}</div><div style={{ fontSize: 12, color: 'var(--ccbd5e1)' }}>{sub}</div></div>
  );
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        {tile(L(vi, 'Cuộc trò chuyện AI (7 ngày)', 'AI conversations (7 days)'), h?.total ?? '…', Object.entries(h?.byChannel ?? {}).map(([c, n]) => `${n} ${CH_LABEL[c] ?? c}`).join(' · ') || '—')}
        {tile(L(vi, 'Đặt lịch thành công', 'Booked'), h?.booked ?? '…', L(vi, `${h?.bookedCount ?? 0} lịch`, `${h?.bookedCount ?? 0} appointments`), 'var(--ink-good)')}
        {tile(L(vi, 'AI kết thúc vì lỗi', 'Ended by an error'), h?.errorEnds ?? '…', L(vi, `${h?.slowTurns ?? 0} lượt trả lời chậm`, `${h?.slowTurns ?? 0} slow turns`), (h?.errorEnds ?? 0) > 0 ? 'var(--ink-bad)' : 'var(--ink-good)')}
        {tile(L(vi, 'Việc gọi lại còn mở', 'Open callbacks'), h?.openCallbacks ?? '…', L(vi, `${h?.refusedBookings ?? 0} lần quy tắc từ chối đặt`, `${h?.refusedBookings ?? 0} bookings refused by rules`), (h?.openCallbacks ?? 0) > 0 ? 'var(--ink-warn)' : undefined)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card title={L(vi, 'Vì sao cuộc trò chuyện kết thúc', 'Why conversations ended')} hint={L(vi, 'Mỗi cuộc gọi, mỗi hội thoại đều ghi lý do. Không còn "cúp máy không ai biết".', 'Every call and chat records its reason. No more silent hang-ups.')}>
          {reasons.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chưa có dữ liệu — từ lần deploy này trở đi mới ghi.', 'No data yet — recorded from this release on.')}</div>}
          {reasons.map(([r, n]) => (
            <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ width: 170, fontSize: 13, color: 'var(--ccbd5e1)' }}>{h?.labels[r]?.[vi ? 'vi' : 'en'] ?? r}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--raised)' }}><div style={{ width: `${Math.round((n / max) * 100)}%`, height: 10, borderRadius: 5, background: colorOf(r) }} /></div>
              <b style={{ width: 30, textAlign: 'right', color: 'var(--ce2e8f0)' }}>{n}</b>
            </div>
          ))}
        </Card>
        <Card title={L(vi, 'Việc gọi lại cho tiệm', 'Callbacks for the desk')} hint={L(vi, 'Khi AI không chắc, không nghe rõ hay gặp lỗi — khách không bị bỏ rơi. Tiệm nhận thông báo ngay.', 'When the assistant is unsure, cannot hear, or hits an error — the customer is not dropped. The salon is told at once.')}>
          {cbs.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Không có việc nào đang mở.', 'Nothing open.')}</div>}
          {cbs.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, background: 'var(--wash-amber)' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-warn)', whiteSpace: 'nowrap' }}>{fmtWhen(c.createdAt, vi)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: 'var(--ce2e8f0)' }}>{c.name || c.phone || L(vi, 'Khách', 'Customer')} · {CH_LABEL[c.channel] ?? c.channel}</div>
                <div style={{ fontSize: 12, color: 'var(--ccbd5e1)' }}>{(h?.labels[c.reason]?.[vi ? 'vi' : 'en']) ?? c.reason} — {c.summary}</div>
              </div>
              {c.phone && <a href={`tel:${c.phone}`} style={{ ...ui.primaryBtn, textDecoration: 'none' }}>{L(vi, 'Gọi', 'Call')}</a>}
              {c.customerId && <Link href={`/salon/customers/${c.customerId}`} style={{ ...ghost, textDecoration: 'none' }}>{L(vi, 'Hồ sơ', 'Profile')}</Link>}
              <button type="button" onClick={() => done(c.id)} style={ghost}>{L(vi, 'Xong', 'Done')}</button>
            </div>
          ))}
        </Card>
      </div>
      <Card title={L(vi, 'Các kênh đang nói bằng bộ não này', 'Channels speaking with this brain')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { k: 'voice', on: view.channels.voice.provisioned && view.channels.voice.enabled, sub: view.channels.voice.number ?? L(vi, 'Chưa có số', 'No number yet'), href: '/salon/voice' },
            { k: 'messenger', on: view.channels.messenger.connected && view.channels.messenger.enabled, sub: view.channels.messenger.pageName ?? L(vi, 'Chưa nối', 'Not connected'), href: '/salon/messenger' },
            { k: 'instagram', on: view.channels.messenger.instagram, sub: view.channels.messenger.instagram ? L(vi, 'Đã nối', 'Connected') : L(vi, 'Nối ở trang Messenger', 'Connect on the Messenger page'), href: '/salon/messenger' },
            { k: 'zalo', on: false, sub: L(vi, 'Nối ở trang Messenger', 'Connect on the Messenger page'), href: '/salon/messenger' },
            { k: 'web', on: true, sub: L(vi, 'Mã nhúng ở trang Messenger', 'Embed code on the Messenger page'), href: '/salon/messenger' },
          ].map((c) => (
            <Link key={c.k} href={c.href} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, textDecoration: 'none', color: 'var(--ce2e8f0)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{CH_LABEL[c.k]}</b><span style={{ fontSize: 11, fontWeight: 800, color: c.on ? 'var(--ink-good)' : 'var(--c94a3b8)' }}>{c.on ? L(vi, '● BẬT', '● ON') : L(vi, '○ TẮT', '○ OFF')}</span></div>
              <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 4 }}>{c.sub}</div>
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}><button type="button" onClick={() => onGo('chat')} style={ghost}>{L(vi, 'Cách trả lời tin nhắn', 'Messages')}</button><button type="button" onClick={() => onGo('voice')} style={ghost}>{L(vi, 'Cách nói trên điện thoại', 'Phone')}</button></div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 2 · persona & languages

function Persona({ brain, patch, vi, canEdit }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean }) {
  const f = field(vi);
  const p = brain.persona;
  const setP = (k: keyof Brain['persona'], v: string) => patch((b) => ({ ...b, persona: { ...b.persona, [k]: v } }));
  const allowed = brain.languages.allowed;
  const toggleLang = (l: Lang) => patch((b) => {
    const has = b.languages.allowed.includes(l);
    const next = has ? b.languages.allowed.filter((x) => x !== l) : [...b.languages.allowed, l];
    return { ...b, languages: { ...b.languages, allowed: next.includes(b.languages.primary) ? next : [b.languages.primary, ...next] } };
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
      <Card title={L(vi, 'Nhân cách', 'Persona')} hint={L(vi, 'Một nhân cách cho mọi kênh. Khách gọi hay nhắn đều gặp cùng một "em lễ tân".', 'One persona for every channel. Calling or texting, the customer meets the same receptionist.')}>
        <label style={f.label}>{f.L('Tên trợ lý', 'Assistant name')}</label>
        <input value={p.agentName} disabled={!canEdit} maxLength={40} onChange={(e) => setP('agentName', e.target.value)} placeholder={f.L('vd: Linh', 'e.g. Linh')} style={{ ...f.input, marginBottom: 12 }} />
        <label style={f.label}>{f.L('Giọng điệu', 'Tone')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {([['warm', f.L('Thân thiện, ấm', 'Warm & friendly')], ['professional', f.L('Chuyên nghiệp', 'Professional')], ['brief', f.L('Ngắn gọn', 'Brief')]] as const).map(([k, lbl]) => (
            <Pill key={k} on={p.tone === k} disabled={!canEdit} label={lbl} onClick={() => patch((b) => ({ ...b, persona: { ...b.persona, tone: k } }))} />
          ))}
        </div>
        <label style={f.label}>{f.L('Giới thiệu tiệm trong một câu', 'The salon in one sentence')}</label>
        <textarea value={p.intro} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => setP('intro', e.target.value)} style={{ ...f.input, resize: 'vertical', marginBottom: 12 }} />
        <label style={f.label}>{f.L('Lời kết', 'Sign-off')}</label>
        <input value={p.signoff} disabled={!canEdit} maxLength={200} onChange={(e) => setP('signoff', e.target.value)} style={f.input} />
        <div style={{ ...f.hint, marginTop: 10 }}>{f.L('Lời chào mở đầu ở mục "Cách trả lời tin nhắn" và "Cách nói trên điện thoại" — hai kênh chào khác nhau.', 'The opening greeting is under "Messages" and "Phone" — the two channels greet differently.')}</div>
      </Card>
      <Card title={L(vi, 'Ngôn ngữ', 'Languages')} hint={L(vi, 'Khách nhắn tiếng nào, trả lời tiếng đó — trong các tiếng tiệm cho phép.', 'The customer\'s language is answered in kind — among the ones the salon allows.')}>
        <label style={f.label}>{f.L('Ngôn ngữ chính (mở đầu khi chưa biết khách nói gì)', 'Primary language (the opening, before the customer has spoken)')}</label>
        <select value={brain.languages.primary} disabled={!canEdit} onChange={(e) => patch((b) => ({ ...b, languages: { ...b.languages, primary: e.target.value as Lang, allowed: b.languages.allowed.includes(e.target.value as Lang) ? b.languages.allowed : [e.target.value as Lang, ...b.languages.allowed] } }))} style={{ ...f.input, marginBottom: 12 }}>
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        <label style={f.label}>{f.L('Tự nhận và trả lời bằng', 'Detect and answer in')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {LANGS.map((l) => <Pill key={l.id} on={allowed.includes(l.id)} disabled={!canEdit || l.id === brain.languages.primary} label={`${allowed.includes(l.id) ? '✓ ' : '+ '}${l.label}`} onClick={() => toggleLang(l.id)} />)}
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.5, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, color: 'var(--ce2e8f0)' }}>{f.L('Quy tắc không đổi được', 'Rules that never change')}</div>
          <div>• {f.L('Không trộn hai thứ tiếng trong một câu.', 'Never two languages in one reply.')}</div>
          <div>• {f.L('"ok", "thank you", "cảm ơn" chêm vào không đổi ngôn ngữ; chỉ đổi khi khách viết trọn câu bằng tiếng khác.', '"ok", "thank you" do not switch the language; only a whole sentence in another language does.')}</div>
          <div>• {f.L('Ngôn ngữ của khách được ghi vào trí nhớ: lần sau nói đúng tiếng đó từ câu đầu.', 'The customer\'s language is remembered: next time it is used from the first line.')}</div>
          <div>• {f.L('Ghi chú của tiệm viết tiếng Việt cũng được — AI tự dịch khi nói với khách.', 'Notes may be written in Vietnamese — the assistant translates when talking to the customer.')}</div>
          <div>• {f.L('Hotline nghe và nói tiếng Anh, tiếng Việt; các tiếng khác dùng cho chat.', 'The hotline listens and speaks English and Vietnamese; the other languages are for chat.')}</div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 3 · knowledge & rules

function Knowledge({ brain, patch, vi, canEdit, token, pageConnected }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean; token: string | null; pageConnected: boolean }) {
  const f = field(vi);
  const facts = brain.knowledge.facts;
  const today = new Date().toISOString().slice(0, 10);
  const setFact = (i: number, k: 'label' | 'value' | 'on' | 'from' | 'until', v: string | boolean | undefined) => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: b.knowledge.facts.map((x, j) => {
    if (j !== i) return x;
    const next = { ...x, [k]: v };
    if ((k === 'from' || k === 'until') && !v) delete (next as Record<string, unknown>)[k];
    return next;
  }) } }));
  const ruleLines = brain.knowledge.rules.split('\n').map((l) => l.trim()).filter(Boolean).length;
  return (
    <div>
      <div style={{ ...ui.card, marginBottom: 14, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '12px 20px' }}>
        <span style={{ fontWeight: 800, color: 'var(--ce2e8f0)', marginRight: 6 }}>{L(vi, 'AI tự đọc từ hệ thống (không cần nhập lại):', 'Read from the system by itself (nothing to retype):')}</span>
        {[L(vi, 'Dịch vụ & giá', 'Services & prices'), L(vi, 'Giờ mở cửa & ngày nghỉ', 'Hours & days off'), L(vi, 'Thợ & kỹ năng', 'Staff & skills'), L(vi, 'Khuyến mãi theo kênh', 'Promotions by channel'), L(vi, 'Địa chỉ, SĐT, chính sách huỷ', 'Address, phone, cancellation policy'), L(vi, 'Add-on "hỏi trước khi đặt"', '"Ask before booking" add-ons')].map((t) => (
          <span key={t} style={{ minHeight: 30, display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 999, background: 'var(--raised)', color: 'var(--ccbd5e1)', fontSize: 12, fontWeight: 600, border: '1px solid var(--line)' }}>{t}</span>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card title={L(vi, 'Kiến thức riêng của tiệm (FAQ)', 'The salon\'s own knowledge (FAQ)')} hint={L(vi, 'Dùng cho cả hotline lẫn chat. Trước đây hotline không thấy phần này nếu tiệm chưa nối Messenger.', 'Used by the hotline and every chat. The hotline used to miss it when Messenger was not connected.')}>
          {facts.map((x, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, border: '1px solid var(--line)', borderRadius: 10, marginBottom: 8, opacity: x.on ? 1 : 0.6 }}>
              <input type="checkbox" checked={x.on} disabled={!canEdit} aria-label={L(vi, 'Bật', 'On')} onChange={(e) => setFact(i, 'on', e.target.checked)} style={{ width: 18, height: 18, marginTop: 10 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={x.label} disabled={!canEdit} maxLength={80} placeholder={L(vi, 'Chủ đề (vd: Đậu xe)', 'Topic (e.g. Parking)')} onChange={(e) => setFact(i, 'label', e.target.value)} style={{ ...f.input, fontWeight: 700, marginBottom: 6 }} />
                <textarea value={x.value} disabled={!canEdit} rows={2} maxLength={600} placeholder={L(vi, 'Câu trả lời cho khách', 'What to tell the customer')} onChange={(e) => setFact(i, 'value', e.target.value)} style={{ ...f.input, resize: 'vertical' }} />
                {/* A seasonal fact (holiday hours, an opening offer) is told only between these days and drops out on its own. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 6, fontSize: 12, color: 'var(--c94a3b8)' }}>
                  <span>{L(vi, 'Chỉ áp dụng từ', 'Only from')}</span>
                  <input type="date" value={x.from ?? ''} disabled={!canEdit} aria-label={L(vi, 'Từ ngày', 'From')} onChange={(e) => setFact(i, 'from', e.target.value || undefined)} style={{ ...f.input, width: 150, padding: '5px 8px', fontSize: 12.5 }} />
                  <span>{L(vi, 'đến', 'to')}</span>
                  <input type="date" value={x.until ?? ''} disabled={!canEdit} aria-label={L(vi, 'Đến ngày', 'Until')} onChange={(e) => setFact(i, 'until', e.target.value || undefined)} style={{ ...f.input, width: 150, padding: '5px 8px', fontSize: 12.5 }} />
                  {!x.from && !x.until && <span>{L(vi, '(trống = luôn đúng)', '(blank = always)')}</span>}
                  {x.until && x.until < today && <b style={{ color: 'var(--ink-warn)' }}>{L(vi, 'Hết hạn — AI không dùng nữa', 'Expired — no longer used')}</b>}
                </div>
              </div>
              {canEdit && <button type="button" onClick={() => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: b.knowledge.facts.filter((_, j) => j !== i) } }))} style={ui.dangerBtn}>{L(vi, 'Xoá', 'Remove')}</button>}
            </div>
          ))}
          {canEdit && facts.length < 80 && (
            <button type="button" onClick={() => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: [...b.knowledge.facts, { label: '', value: '', on: true }] } }))}
              style={{ background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              + {L(vi, 'Thêm điều AI cần biết', 'Add something the AI should know')}
            </button>
          )}
          {canEdit && <KnowledgeImport token={token} vi={vi} pageConnected={pageConnected} patch={patch} />}
        </Card>
        <Card title={L(vi, 'Cách tiệm vận hành — quy tắc cho AI', 'How the salon runs — rules for the assistant')} hint={L(vi, 'Viết như dặn nhân viên mới. Tiếng Việt hay tiếng Anh đều được. Một ô duy nhất, mọi kênh đọc.', 'Write it like briefing a new employee, in Vietnamese or English. One box, every channel reads it.')}>
          <textarea value={brain.knowledge.rules} disabled={!canEdit} rows={12} maxLength={4000} onChange={(e) => patch((b) => ({ ...b, knowledge: { ...b.knowledge, rules: e.target.value } }))}
            placeholder={L(vi, '- Khách hỏi full set: báo "từ $60", rồi hỏi vẽ design hay màu trơn.\n- Kim chỉ làm pedicure.\n- Cuối tuần đông: hết chỗ thứ 7 thì mời sáng Chủ nhật.', '- Full set: quote "from $60", then ask design or solid colour.\n- Kim only does pedicures.\n- Saturdays are busy: when full, offer Sunday morning.')}
            style={{ ...f.input, resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <span style={{ minHeight: 28, display: 'inline-flex', alignItems: 'center', padding: '0 10px', borderRadius: 999, border: '1px solid var(--line)', color: 'var(--ink-good)', fontSize: 12, fontWeight: 700 }}>✓ {L(vi, `${ruleLines} dòng quy tắc`, `${ruleLines} rule lines`)}</span>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{brain.knowledge.rules.length}/4000</span>
          </div>
          <div style={{ padding: 12, borderRadius: 10, background: 'var(--raised)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 12, lineHeight: 1.5 }}>
            <b style={{ color: 'var(--ce2e8f0)' }}>{L(vi, 'Thứ tự ưu tiên khi mâu thuẫn', 'Priority when things conflict')}</b><br />
            {L(vi, '1. Lịch thật (giờ trống, giờ mở cửa) · 2. Quy tắc ở ô này · 3. Menu & giá · 4. FAQ · 5. Trí nhớ khách. AI không hứa điều nằm ngoài 5 thứ này.', '1. The real book (open times, hours) · 2. The rules here · 3. Menu & prices · 4. FAQ · 5. Customer memory. Nothing outside these five is promised.')}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 4 · booking & hand-off

function Booking({ brain, patch, vi, canEdit }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean }) {
  const f = field(vi);
  const b = brain.booking, h = brain.handoff;
  const setB = (k: keyof Brain['booking'], v: unknown) => patch((x) => ({ ...x, booking: { ...x.booking, [k]: v } }));
  const setH = (k: keyof Brain['handoff'], v: unknown) => patch((x) => ({ ...x, handoff: { ...x.handoff, [k]: v } }));
  const num = (v: number, onChange: (n: number) => void, lo: number, hi: number) => (
    <input type="number" value={v} min={lo} max={hi} disabled={!canEdit} onChange={(e) => onChange(Math.max(lo, Math.min(hi, Number(e.target.value) || lo)))} style={{ ...f.input, width: 70, display: 'inline-block', padding: '5px 8px', margin: '0 6px' }} />
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
      <Card title={L(vi, 'AI được làm gì với lịch', 'What the assistant may do with the book')} hint={L(vi, 'Cùng một bộ công cụ đặt lịch cho hotline và chat.', 'One set of booking tools for the hotline and every chat.')}>
        <Toggle on={b.canBook} disabled={!canEdit} onChange={(v) => setB('canBook', v)} label={L(vi, 'Đặt lịch mới', 'Book new appointments')} hint={L(vi, 'Luôn đọc lại dịch vụ, giờ, tên, 4 số cuối SĐT và chờ khách "đúng rồi" trước khi ghi lịch.', 'Always reads back service, time, name and the phone\'s last four digits, and waits for a yes.')} />
        <Toggle on={b.allowGroup} disabled={!canEdit || !b.canBook} onChange={(v) => setB('allowGroup', v)} label={L(vi, 'Đặt cho nhóm', 'Book groups')} hint={L(vi, 'Mỗi người một thợ, cùng giờ.', 'One technician each, same time.')} />
        {b.allowGroup && <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', padding: '0 0 8px 28px' }}>{L(vi, 'Tối đa', 'Up to')}{num(b.maxParty, (n) => setB('maxParty', n), 1, 10)}{L(vi, 'người; đông hơn → nhờ tiệm gọi lại.', 'people; larger parties → the desk calls back.')}</div>}
        <Toggle on={b.canReschedule} disabled={!canEdit} onChange={(v) => setB('canReschedule', v)} label={L(vi, 'Dời lịch', 'Reschedule')} hint={L(vi, 'Theo chính sách báo trước của tiệm. AI nói đúng lý do khi không dời được.', 'Within the salon\'s notice policy; the assistant says the real reason when it cannot.')} />
        <Toggle on={b.canCancel} disabled={!canEdit} onChange={(v) => setB('canCancel', v)} label={L(vi, 'Huỷ lịch', 'Cancel')} hint={L(vi, 'Tắt: AI chỉ ghi nhận và báo tiệm. Bật: huỷ sau khi khách xác nhận rõ ràng.', 'Off: the assistant notes it and tells the desk. On: cancels after a clear confirmation.')} />
        <Toggle on={b.askExtras} disabled={!canEdit} onChange={(v) => setB('askExtras', v)} label={L(vi, 'Hỏi add-on "hỏi trước khi đặt"', 'Ask the "ask before booking" add-ons')} hint={L(vi, 'Ví dụ "Có vẽ design không?" — hỏi một lần, đúng dịch vụ.', 'E.g. "Would you like a design?" — once, on the right service.')} />
        <label style={{ ...f.label, marginTop: 8 }}>{f.L('Khách xin giờ đã kín', 'When the asked time is taken')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([['offer-nearest', f.L('Mời 2–3 giờ gần nhất', 'Offer 2–3 nearest times')], ['say-full', f.L('Chỉ nói "đã kín"', 'Just say it is taken')], ['waitlist', f.L('Ghi vào danh sách chờ', 'Offer the waiting list')]] as const).map(([k, lbl]) => (
            <Pill key={k} on={b.whenFull === k} disabled={!canEdit} label={lbl} onClick={() => setB('whenFull', k)} />
          ))}
        </div>
        <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-good)', marginTop: 12, lineHeight: 1.5 }}>
          <b>{L(vi, 'Đặt xong là trả lời ngay.', 'Booked means answered at once.')}</b> {L(vi, 'Tin nhắn xác nhận gửi sau; cuộc gọi không bị treo chờ SMS.', 'Confirmation texts go out afterwards; the call never waits on them.')}
        </div>
      </Card>
      <Card title={L(vi, 'Khi AI không chắc, không nghe rõ, hay gặp lỗi', 'When the assistant is unsure, cannot hear, or hits an error')} hint={L(vi, 'Thay cho "Xin lỗi, hệ thống trục trặc. Tạm biệt." — khách luôn có một lối ra.', 'Instead of "Sorry, trouble. Goodbye." — the customer always has a way out.')}>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>
          <div><b style={{ color: 'var(--ce2e8f0)' }}>1.</b> {f.L('Điện thoại: nối máy tới số lễ tân (mục "Cách nói trên điện thoại").', 'Phone: transfer to the desk (under "Phone").')}</div>
          <div><b style={{ color: 'var(--ce2e8f0)' }}>2.</b> {f.L('Không ai nghe / không có số / trên chat → "nhân viên sẽ liên hệ lại", tạo việc gọi lại + báo tiệm. Không bịa.', 'Nobody answers / no number / on chat → "a team member will get back to you", a callback task + the salon is told. Never a guess.')}</div>
        </div>
        <label style={{ ...f.label, marginTop: 12 }}>{f.L('Báo cho ai khi có việc gọi lại', 'Who is told about a callback')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill on={h.notifyOwnerPush} disabled={!canEdit} label={f.L('Push chủ tiệm', 'Push the owner')} onClick={() => setH('notifyOwnerPush', !h.notifyOwnerPush)} />
          <Pill on={h.notifyDeskPush} disabled={!canEdit} label={f.L('Push lễ tân đang ca', 'Push the desk on shift')} onClick={() => setH('notifyDeskPush', !h.notifyDeskPush)} />
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--wash-red)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ce2e8f0)', marginTop: 12, lineHeight: 1.5 }}>
          <b>{L(vi, 'AI chỉ gác máy khi', 'The assistant hangs up only when')}</b> {L(vi, 'khách đã chào tạm biệt, hoặc đã đặt xong và nói không còn gì. Hết lượt suy nghĩ, lỗi máy chủ, quá chậm → đều đi bước 1–2 ở trên.', 'the customer said goodbye, or is booked and needs nothing else. Out of tool budget, a server error, too slow → steps 1–2 above.')}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- messages only

function ChatSection({ brain, patch, vi, canEdit, view, token }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean; view: View; token: string | null }) {
  const f = field(vi);
  const c = brain.channels.chat;
  const setC = (k: keyof Brain['channels']['chat'], val: unknown) => patch((b) => ({ ...b, channels: { ...b.channels, chat: { ...b.channels.chat, [k]: val } } }));
  const setH = (k: keyof Brain['handoff'], v: unknown) => patch((x) => ({ ...x, handoff: { ...x.handoff, [k]: v } }));
  const connected = view.channels.messenger.connected;
  return (
    <div>
      <div style={{ ...ui.card, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: connected && view.channels.messenger.enabled ? 'var(--ink-good)' : 'var(--c94a3b8)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}>{connected && view.channels.messenger.enabled ? L(vi, '● ĐANG BẬT', '● ON') : L(vi, '○ TẮT', '○ OFF')}</span>
        <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{view.channels.messenger.pageName ?? L(vi, 'Chưa nối page', 'No page connected')}{view.channels.messenger.instagram ? ' · Instagram' : ''}</span>
        <Link href="/salon/messenger" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>{L(vi, 'Nối page, Zalo, mã nhúng →', 'Connect page, Zalo, embed →')}</Link>
      </div>
      <Card title={L(vi, 'Lời chào & dặn thêm cho tin nhắn', 'Greeting & extra notes for messages')}>
        <label style={f.label}>{f.L('Lời chào khi khách nhắn lần đầu (cũng hiện trên màn hình chào của Page)', 'Greeting on the first message (also shown on the Page\'s welcome screen)')}</label>
        <textarea value={c.greeting} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => setC('greeting', e.target.value)} style={{ ...f.input, resize: 'vertical', marginBottom: 4 }} />
        <div style={{ ...f.hint, marginBottom: 12 }}>{connected ? f.L('Lưu là cập nhật luôn lên Facebook Page.', 'Saving also updates the Facebook Page.') : f.L('Nối Page ở trang Messenger để lời chào hiện trên Facebook.', 'Connect the Page on the Messenger page for it to show on Facebook.')}</div>
        <label style={f.label}>{f.L('Dặn thêm chỉ khi nhắn tin', 'Extra notes for messages only')}</label>
        <textarea value={c.extra} disabled={!canEdit} rows={3} maxLength={1500} onChange={(e) => setC('extra', e.target.value)} placeholder={f.L('vd: Trả lời ngắn, tối đa 3 câu.', 'e.g. Keep replies to three lines.')} style={{ ...f.input, resize: 'vertical' }} />
      </Card>
      <Card title={L(vi, 'Khi nhân viên đang trả lời', 'When staff are answering')} hint={L(vi, 'Nhân viên vừa nhắn trong X phút thì mỗi tin mới của khách được nhường Y phút cho người thật; hết Y phút AI mới trả lời.', 'If staff wrote within X minutes, each new customer message waits Y minutes for a person before the AI answers.')}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label style={{ ...f.label, display: 'flex', flexDirection: 'column', gap: 6 }}>{f.L('Nhân viên "đang trực" trong (phút) — X', 'Staff count as active for (min) — X')}
            <input type="number" min={1} max={720} value={brain.handoff.staffQuietMins} disabled={!canEdit} onChange={(e) => setH('staffQuietMins', Math.max(1, Math.min(720, Number(e.target.value) || 1)))} style={f.input} />
          </label>
          <label style={{ ...f.label, display: 'flex', flexDirection: 'column', gap: 6 }}>{f.L('AI nhường người thật (phút) — Y', 'AI yields to a person for (min) — Y')}
            <input type="number" min={0} max={60} value={c.yieldMins} disabled={!canEdit} onChange={(e) => setC('yieldMins', Math.max(0, Math.min(60, Number(e.target.value) || 0)))} style={f.input} />
          </label>
        </div>
      </Card>
      <FollowUpBox token={token} vi={vi} />
    </div>
  );
}

// ---------------------------------------------------------------- hotline only

function VoiceSection({ brain, patch, vi, canEdit, view }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean; view: View }) {
  const f = field(vi);
  const v = brain.channels.voice, h = brain.handoff;
  const setV = (k: keyof Brain['channels']['voice'], val: string) => patch((b) => ({ ...b, channels: { ...b.channels, voice: { ...b.channels.voice, [k]: val } } }));
  const setH = (k: keyof Brain['handoff'], val: unknown) => patch((x) => ({ ...x, handoff: { ...x.handoff, [k]: val } }));
  const on = view.channels.voice.provisioned && view.channels.voice.enabled;
  return (
    <div>
      <div style={{ ...ui.card, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: on ? 'var(--ink-good)' : 'var(--c94a3b8)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}>{on ? L(vi, '● ĐANG BẬT', '● ON') : L(vi, '○ TẮT', '○ OFF')}</span>
        <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{view.channels.voice.number ?? L(vi, 'Chưa có số Lumio', 'No Lumio number yet')}</span>
        <Link href="/salon/voice" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>{L(vi, 'Số, chuông, giờ nghe, giọng đọc →', 'Number, ringing, hours, voice →')}</Link>
      </div>
      <Card title={L(vi, 'Lời chào & dặn thêm cho điện thoại', 'Greeting & extra notes for the phone')}>
        <label style={f.label}>{f.L('Lời chào khi nhấc máy (dùng cả khi có menu bấm phím)', 'Greeting when answering (also used with the keypad menu)')}</label>
        <textarea value={v.greeting} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => setV('greeting', e.target.value)} style={{ ...f.input, resize: 'vertical', marginBottom: 4 }} />
        <div style={{ ...f.hint, marginBottom: 12 }}>{f.L('Câu "trợ lý tự động" theo luật được thêm trước lời chào — tiệm không phải tự viết.', 'The legally required "automated assistant" line is added before it for you.')}</div>
        <label style={f.label}>{f.L('Dặn thêm chỉ khi nói điện thoại', 'Extra notes for the phone only')}</label>
        <textarea value={v.extra} disabled={!canEdit} rows={3} maxLength={1500} onChange={(e) => setV('extra', e.target.value)} placeholder={f.L('vd: Nói chậm, rõ; đọc lại số điện thoại cho khách xác nhận.', 'e.g. Speak slowly; read the phone number back to confirm.')} style={{ ...f.input, resize: 'vertical' }} />
      </Card>
      <Card title={L(vi, 'Chuyển máy & khi khách im lặng', 'Transfers & silence')}>
        <label style={f.label}>{f.L('Số chuyển máy cho lễ tân', 'The desk number to transfer to')}</label>
        <input value={h.transferNumber} disabled={!canEdit} maxLength={40} inputMode="tel" placeholder="+1 512 555 0147" onChange={(e) => setH('transferNumber', e.target.value)} style={{ ...f.input, marginBottom: 4 }} />
        <div style={{ ...f.hint, marginBottom: 12 }}>{f.L('Cùng một số với trang Hotline. Trống = không nối máy; AI hẹn gọi lại và tạo việc cho tiệm.', 'The same number as on the Hotline page. Blank = no transfer; the AI promises a call back and leaves the desk a task.')}</div>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{f.L('Khách im lặng: hỏi lại', 'Silence: ask again')}
          <input type="number" min={1} max={5} value={h.silenceRetries} disabled={!canEdit} onChange={(e) => setH('silenceRetries', Math.max(1, Math.min(5, Number(e.target.value) || 1)))} style={{ ...f.input, width: 70, display: 'inline-block', padding: '5px 8px', margin: '0 6px' }} />
          {f.L('lần rồi mới chuyển máy / hẹn gọi lại — không cúp máy ngang.', 'times, then transfer / promise a call back — never a bare hang-up.')}</div>
      </Card>
      <Card title={L(vi, 'Ngôn ngữ trên điện thoại', 'Languages on the phone')}>
        <label style={f.label}>{f.L('Hotline: cách nhận ra tiếng của người gọi', 'Hotline: how the caller\'s language is found')}</label>
        {([
          ['auto', f.L('Tự nhận', 'Automatic'), f.L('Mở đầu bằng ngôn ngữ chính; nghe câu đầu không ra thì nghe lại bằng tiếng kia. Không bắt khách bấm phím.', 'Open in the primary language; if the first words cannot be heard, listen once in the other. No keypad.')],
          ['menu', f.L('Menu bấm phím', 'Keypad menu'), f.L('"For English press 1 · Tiếng Việt bấm 2". Chắc chắn nhất khi tiệm đông khách Việt lớn tuổi.', '"For English press 1 · Tiếng Việt bấm 2". The surest choice for many older Vietnamese callers.')],
          ['single', f.L('Chỉ một ngôn ngữ', 'One language only'), f.L('Tiệm chỉ phục vụ một tiếng trên điện thoại.', 'The phone serves one language.')],
        ] as const).map(([k, lbl, hint]) => (
          <label key={k} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, border: `1.5px solid ${brain.languages.voiceOpening === k ? '#6366f1' : 'var(--line)'}`, borderRadius: 10, marginBottom: 8, cursor: canEdit ? 'pointer' : 'default' }}>
            <input type="radio" name="vo" checked={brain.languages.voiceOpening === k} disabled={!canEdit} onChange={() => patch((b) => ({ ...b, languages: { ...b.languages, voiceOpening: k } }))} style={{ marginTop: 3 }} />
            <span><b style={{ color: 'var(--ce2e8f0)' }}>{lbl}</b><span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{hint}</span></span>
          </label>
        ))}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 6 · memory

function Memory({ token, vi, canEdit }: { token: string | null; vi: boolean; canEdit: boolean }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<MemoryRow[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<MemoryDetail | null>(null);
  const [note, setNote] = useState('');
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { if (token) apiFetch<MemoryRow[]>('/ai-brain/memories', { token }).then(setRows).catch(() => setRows([])); }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!token || !sel) { setD(null); return; }
    apiFetch<MemoryDetail>(`/ai-brain/memories/${sel}`, { token }).then((x) => { setD(x); setNote(x.memory?.salonNote ?? ''); setProfile(x.memory?.profile ?? ''); }).catch(() => setD(null));
  }, [token, sel]);
  const list = useMemo(() => { const n = q.trim().toLowerCase(); return rows.filter((r) => !n || String(r.name ?? '').toLowerCase().includes(n) || String(r.phone ?? '').includes(n)); }, [rows, q]);
  const saveMem = async () => {
    if (!sel) return; setBusy(true);
    try { await apiFetch(`/ai-brain/memories/${sel}`, { method: 'PATCH', token, body: { salonNote: note, profile } }); const x = await apiFetch<MemoryDetail>(`/ai-brain/memories/${sel}`, { token }); setD(x); load(); } finally { setBusy(false); }
  };
  const erase = async () => {
    if (!sel || !window.confirm(L(vi, 'Xoá toàn bộ trí nhớ AI về khách này? Hồ sơ khách và lịch sử đặt lịch vẫn giữ.', 'Erase everything the assistant remembers about this customer? Their record and bookings are kept.'))) return;
    await apiFetch(`/ai-brain/memories/${sel}`, { method: 'DELETE', token }); setSel(null); load();
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
      <div style={{ ...ui.card, flex: '1 1 300px', padding: 12 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L(vi, 'Tìm theo tên, SĐT…', 'Search name, phone…')} style={{ ...ui.input, marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', padding: '0 4px 6px' }}>{L(vi, `${rows.length} khách có trí nhớ`, `${rows.length} remembered customers`)}</div>
        {list.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', padding: 6 }}>{L(vi, 'Chưa có — trí nhớ hình thành từ các cuộc gọi và chat sau lần deploy này.', 'None yet — memory builds from calls and chats after this release.')}</div>}
        {list.slice(0, 80).map((r) => (
          <button key={r.customerId} type="button" onClick={() => setSel(r.customerId)}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', borderRadius: 10, border: `1px solid ${sel === r.customerId ? '#6366f1' : 'var(--line)'}`, background: 'transparent', color: 'var(--ce2e8f0)', cursor: 'pointer', marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{r.name || r.phone || '—'}</b><span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{fmtWhen(r.lastContactAt, vi)}</span></div>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{[r.lastChannel ? CH_LABEL[r.lastChannel] ?? r.lastChannel : null, r.preferredLang?.toUpperCase(), r.openIntent ? `⏳ ${r.openIntent}` : null].filter(Boolean).join(' · ')}</div>
          </button>
        ))}
      </div>
      <div style={{ ...ui.card, flex: '2 1 420px' }}>
        {!d && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chọn một khách để xem AI nhớ gì về họ — mọi kênh, một người.', 'Pick a customer to see what the assistant remembers — every channel, one person.')}</div>}
        {d && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{d.customer.name}</div>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{d.customer.phone ?? ''}{d.customer.email ? ` · ${d.customer.email}` : ''}</span>
              {d.memory?.preferredLang && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-link)', border: '1px solid var(--line)', borderRadius: 999, padding: '2px 8px' }}>{LANGS.find((l) => l.id === d.memory!.preferredLang)?.label ?? d.memory.preferredLang}</span>}
              <Link href={`/salon/customers/${d.customer.id}`} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>{L(vi, 'Mở hồ sơ khách', 'Open profile')}</Link>
            </div>
            {d.memory?.openIntent && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: 'var(--wash-amber)', border: '1px solid var(--line)' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--ink-warn)' }}>{L(vi, 'VIỆC ĐANG DANG DỞ', 'UNFINISHED')} · {CH_LABEL[d.memory.openIntent.channel] ?? d.memory.openIntent.channel} · {fmtWhen(d.memory.openIntent.at, vi)}</div>
                <div style={{ fontSize: 14, color: 'var(--ce2e8f0)', marginTop: 4 }}>{d.memory.openIntent.text}</div>
              </div>
            )}
            <label style={{ ...ui.label, marginTop: 12 }}>{L(vi, 'AI nhớ gì (tự chưng cất từ các cuộc trò chuyện; tiệm sửa được)', 'What the assistant remembers (distilled from conversations; editable)')}</label>
            <textarea value={profile} disabled={!canEdit} rows={6} maxLength={1500} onChange={(e) => setProfile(e.target.value)} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
            <label style={{ ...ui.label, marginTop: 10 }}>{L(vi, 'Ghi chú của tiệm cho AI về khách này', 'The salon\'s own note for the assistant')}</label>
            <input value={note} disabled={!canEdit} maxLength={600} onChange={(e) => setNote(e.target.value)} placeholder={L(vi, 'vd: Khách VIP, luôn ưu tiên thợ Kim', 'e.g. VIP, always offer Kim first')} style={ui.input} />
            {canEdit && (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" disabled={busy} onClick={saveMem} style={ui.primaryBtn}>{L(vi, 'Lưu trí nhớ', 'Save memory')}</button>
                <button type="button" onClick={erase} style={ui.dangerBtn}>{L(vi, 'Xoá trí nhớ (khách yêu cầu)', 'Erase memory (on request)')}</button>
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 6px' }}>{L(vi, 'Dòng thời gian — mọi kênh, một người', 'Timeline — every channel, one person')}</div>
            {[...d.sessions.map((s) => ({ at: s.startedAt, kind: CH_LABEL[s.channel] ?? s.channel, text: `${s.turns} ${L(vi, 'lượt', 'turns')} · ${s.bookedIds.length ? L(vi, `đặt ${s.bookedIds.length} lịch`, `${s.bookedIds.length} booked`) : L(vi, 'chưa đặt', 'not booked')} · ${s.endReason}`, color: 'var(--ink-link)' })),
              ...d.visits.map((v) => ({ at: v.at, kind: L(vi, 'ĐÃ ĐẾN', 'VISIT'), text: `${v.service}${v.staff ? ` · ${v.staff}` : ''}`, color: 'var(--ink-good)' }))]
              .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20).map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 10, marginBottom: 6, fontSize: 13 }}>
                  <span style={{ width: 110, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', fontSize: 12 }}>{fmtWhen(e.at, vi)}</span>
                  <span style={{ width: 90, fontSize: 11, fontWeight: 800, color: e.color }}>{e.kind}</span>
                  <span style={{ flex: 1, color: 'var(--ccbd5e1)' }}>{e.text}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 7 · sandbox & logs

function Sandbox({ token, vi }: { token: string | null; vi: boolean }) {
  const mayTeach = canTeachAi(useAuth().user);
  const [teach, setTeach] = useState<{ question: string; reply: string; channel: InsChannel; source: { kind: 'session' | 'manual'; id: string | null }; context: { role: 'user' | 'assistant'; content: string }[] } | null>(null);
  const [channel, setChannel] = useState<'chat' | 'voice'>('chat');
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string; trace?: string[]; ms?: number; lang?: string }[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unbooked' | 'callback' | 'slow'>('all');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [open, setOpen] = useState<(Session & { turns: { role: string; content: string; at?: string }[] }) | null>(null);
  const [labels, setLabels] = useState<Record<string, { vi: string; en: string }>>({});

  useEffect(() => {
    if (!token) return;
    apiFetch<Session[]>(`/ai-brain/sessions${filter === 'all' ? '' : `?filter=${filter}`}`, { token }).then(setSessions).catch(() => setSessions([]));
    apiFetch<Health>('/ai-brain/health?days=1', { token }).then((h) => setLabels(h.labels)).catch(() => undefined);
  }, [token, filter]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next); setInput(''); setBusy(true); setErr(null);
    try {
      const r = await apiFetch<{ reply: string; lang: string; trace: string[]; ms: number }>('/ai-brain/sandbox', { method: 'POST', token, body: { channel, messages: next.map((m) => ({ role: m.role, content: m.content })) } });
      setMsgs((m) => [...m, { role: 'assistant', content: r.reply || '…', trace: r.trace, ms: r.ms, lang: r.lang }]);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  const openSession = async (id: string) => {
    try { setOpen(await apiFetch(`/ai-brain/sessions/${id}`, { token })); } catch { setOpen(null); }
  };
  const reasonLabel = (r: string) => labels[r]?.[vi ? 'vi' : 'en'] ?? r;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card title={L(vi, 'Thử nói chuyện', 'Try a conversation')} hint={L(vi, 'Đóng vai khách để kiểm tra bộ não trước khi khách thật gặp. Không ghi lịch thật, không gửi SMS, không vào trí nhớ.', 'Play the customer to test the brain before a real one meets it. No real booking, no texts, no memory written.')}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <Pill on={channel === 'chat'} label={L(vi, 'Như trên chat', 'As on chat')} onClick={() => setChannel('chat')} />
            <Pill on={channel === 'voice'} label={L(vi, 'Như trên hotline (chữ)', 'As on the phone (text)')} onClick={() => setChannel('voice')} />
            <button type="button" onClick={() => { setMsgs([]); setErr(null); }} style={{ ...ghost, marginLeft: 'auto' }}>{L(vi, 'Làm mới', 'Reset')}</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--raised)', minHeight: 260, maxHeight: 420, overflowY: 'auto' }}>
            {msgs.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Gõ như khách — tiếng nào cũng được. Ví dụ: "Hola, ¿cuánto cuesta un full set?"', 'Type as a customer, in any language. E.g. "Hola, ¿cuánto cuesta un full set?"')}</div>}
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
                <div style={m.role === 'user'
                  ? { background: '#6366f1', color: '#fff', borderRadius: '14px 14px 4px 14px', padding: '8px 12px', fontSize: 14 }
                  : { background: 'var(--c111827)', color: 'var(--ce2e8f0)', border: '1px solid var(--line)', borderRadius: '14px 14px 14px 4px', padding: '8px 12px', fontSize: 14 }}>{m.content}</div>
                {m.role === 'assistant' && (m.trace?.length || m.ms) ? <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 3 }}>↳ {m.lang?.toUpperCase()} · {m.ms} ms{m.trace?.length ? ` · ${m.trace.join(' · ')}` : ''}</div> : null}
                {m.role === 'assistant' && mayTeach && (
                  <button type="button" onClick={() => {
                    const prior = msgs.slice(0, i);
                    const q = [...prior].reverse().find((x) => x.role === 'user')?.content ?? '';
                    const at = prior.map((x) => x.content).lastIndexOf(q);
                    setTeach({ question: q, reply: m.content, channel: channel === 'voice' ? 'voice' : 'messenger', source: { kind: 'manual', id: null }, context: prior.slice(0, Math.max(0, at)).map((x) => ({ role: x.role, content: x.content })) });
                  }} style={{ marginTop: 4, minHeight: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>✎ {L(vi, 'Sửa câu này', 'Fix this reply')}</button>
                )}
              </div>
            ))}
          </div>
          {err && <div style={{ fontSize: 13, color: 'var(--ink-bad)', marginTop: 6 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder={L(vi, 'Gõ như khách…', 'Type as a customer…')} style={{ ...ui.input, flex: 1 }} />
            <button type="button" disabled={busy} onClick={send} style={ui.primaryBtn}>{busy ? '…' : L(vi, 'Gửi', 'Send')}</button>
          </div>
        </Card>
        <Card title={L(vi, 'Nhật ký cuộc trò chuyện', 'Conversation log')} hint={L(vi, 'Mỗi cuộc gọi, mỗi hội thoại: kết quả và lý do kết thúc. Bấm để xem lại.', 'Every call and chat: the outcome and why it ended. Tap to review.')}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {([['all', L(vi, 'Tất cả', 'All')], ['unbooked', L(vi, 'Chưa đặt được', 'Not booked')], ['callback', L(vi, 'Có việc gọi lại', 'Needed a callback')], ['slow', L(vi, 'Trả lời chậm', 'Slow replies')]] as const).map(([k, lbl]) => <Pill key={k} on={filter === k} label={lbl} onClick={() => setFilter(k)} />)}
          </div>
          {sessions.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L(vi, 'Chưa có — ghi từ lần deploy này trở đi.', 'None yet — recorded from this release on.')}</div>}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {sessions.map((s) => (
              <button key={s.id} type="button" onClick={() => openSession(s.id)}
                style={{ display: 'flex', width: '100%', gap: 10, alignItems: 'center', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid var(--line)', padding: '9px 0', cursor: 'pointer', color: 'var(--ce2e8f0)', fontSize: 13 }}>
                <span style={{ width: 110, color: 'var(--c94a3b8)', fontSize: 12, whiteSpace: 'nowrap' }}>{fmtWhen(s.startedAt, vi)}</span>
                <span style={{ width: 80, fontWeight: 700 }}>{CH_LABEL[s.channel] ?? s.channel}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.customerName || s.phone || '—'}{s.lang ? ` · ${s.lang.toUpperCase()}` : ''}</span>
                <span style={{ fontWeight: 700, color: s.bookedIds.length ? 'var(--ink-good)' : 'var(--ink-warn)', whiteSpace: 'nowrap' }}>{s.bookedIds.length ? L(vi, `Đặt ${s.bookedIds.length}`, `Booked ${s.bookedIds.length}`) : L(vi, 'Chưa đặt', 'Not booked')}</span>
                <span style={{ width: 150, fontSize: 12, color: 'var(--ccbd5e1)', textAlign: 'right' }}>{reasonLabel(s.endReason)}</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
      {open && (
        <div style={{ ...ui.card, marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: 'var(--ce2e8f0)' }}>{CH_LABEL[open.channel] ?? open.channel} · {fmtWhen(open.startedAt, vi)}</span>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{open.customerName || open.phone || ''} · {open.turns} {L(vi, 'lượt', 'turns')} · {L(vi, 'chậm nhất', 'slowest')} {(open.maxTurnMs / 1000).toFixed(1)} s · {open.toolCalls} {L(vi, 'công cụ', 'tools')}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--ink-warn)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}>{reasonLabel(open.endReason)}</span>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
          {open.failures.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-bad)', marginTop: 6 }}>{open.failures.map((f) => f.what).join(' · ')}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--raised)', fontSize: 13, maxHeight: 360, overflowY: 'auto' }}>
            {open.turns.length === 0 && <span style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Không có nội dung.', 'No transcript.')}</span>}
            {open.turns.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ flex: 1, minWidth: 0 }}><b style={{ color: t.role === 'user' ? 'var(--ce2e8f0)' : 'var(--ink-link)' }}>{t.role === 'user' ? L(vi, 'Khách', 'Customer') : 'AI'}</b> <span style={{ color: 'var(--ccbd5e1)' }}>{t.content}</span></span>
                {t.role === 'assistant' && mayTeach && t.content.trim() && (
                  <button type="button" onClick={() => {
                    const prior = open.turns.slice(0, i);
                    let qi = prior.length - 1;
                    while (qi >= 0 && prior[qi].role !== 'user') qi -= 1;
                    const ch = (['voice', 'messenger', 'instagram', 'zalo', 'web'].includes(open.channel) ? open.channel : 'messenger') as InsChannel;
                    setTeach({ question: qi >= 0 ? prior[qi].content : '', reply: t.content, channel: ch, source: { kind: 'session', id: open.id }, context: prior.slice(0, Math.max(0, qi)).filter((x) => x.role === 'user' || x.role === 'assistant').map((x) => ({ role: x.role as 'user' | 'assistant', content: x.content })) });
                  }} style={{ flexShrink: 0, minHeight: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>✎ {L(vi, 'Sửa', 'Fix')}</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {teach && (
        <TeachAiPanel token={token} vi={vi} question={teach.question} reply={teach.reply} channel={teach.channel} source={teach.source} context={teach.context}
          callback={teach.channel === 'voice' && open?.phone ? { phone: open.phone, name: open.customerName } : null}
          onClose={() => setTeach(null)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- import knowledge (website, page, pasted text)

interface Proposed { label: string; value: string; pick: boolean }

/** Read the salon's website / Facebook Page / pasted text into proposed facts the owner ticks before they land in the brain. */
function KnowledgeImport({ token, vi, pageConnected, patch }: { token: string | null; vi: boolean; pageConnected: boolean; patch: (fn: (b: Brain) => Brain) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<Proposed[] | null>(null);
  const [extra, setExtra] = useState<{ greeting?: string | null; closing?: string | null; instruction?: string | null } | null>(null);
  const run = async (source: 'website' | 'page' | 'paste') => {
    if (!token || busy) return;
    setBusy(source); setErr(null); setRows(null); setExtra(null);
    try {
      const r = await apiFetch<{ facts: { label: string; value: string }[]; greeting?: string | null; closing?: string | null; instruction?: string | null }>('/messenger/import-facts', {
        method: 'POST', token, body: { source, url: source === 'website' ? url.trim() : undefined, text: source === 'paste' ? text.trim() : undefined },
      });
      setRows(r.facts.map((x) => ({ label: x.label, value: x.value, pick: true })));
      if (r.greeting || r.closing || r.instruction) setExtra({ greeting: r.greeting, closing: r.closing, instruction: r.instruction });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(null); }
  };
  const add = () => {
    if (!rows) return;
    const chosen = rows.filter((r) => r.pick);
    patch((b) => {
      const facts = [...b.knowledge.facts];
      for (const x of chosen) {
        const i = facts.findIndex((y) => y.label.trim().toLowerCase() === x.label.trim().toLowerCase());
        if (i >= 0) facts[i] = { ...facts[i], value: x.value, on: true };
        else facts.push({ label: x.label, value: x.value, on: true });
      }
      return { ...b, knowledge: { ...b.knowledge, facts: facts.slice(0, 80) } };
    });
    setRows(null);
  };
  const use = (k: 'greeting' | 'closing' | 'instruction', v: string) => {
    patch((b) => k === 'greeting' ? { ...b, channels: { ...b.channels, chat: { ...b.channels.chat, greeting: v } } }
      : k === 'closing' ? { ...b, persona: { ...b.persona, signoff: v } }
        : { ...b, knowledge: { ...b.knowledge, rules: [b.knowledge.rules.trim(), v].filter(Boolean).join('\n').slice(0, 4000) } });
    setExtra((x) => (x ? { ...x, [k]: null } : x));
  };
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} style={{ ...ghost, width: '100%', marginTop: 8 }}>{L(vi, 'Nạp từ website, Fanpage hoặc dán văn bản', 'Import from a website, the Page, or pasted text')}</button>;
  }
  return (
    <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{L(vi, 'AI đọc rồi đề xuất từng dòng — bạn tick dòng đúng, bấm Thêm, rồi Lưu.', 'The AI reads it and proposes rows — tick the right ones, Add, then Save.')}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={L(vi, 'Địa chỉ website', 'Website address')} style={{ ...ui.input, flex: '1 1 200px' }} />
        <button type="button" disabled={!!busy || !url.trim()} onClick={() => void run('website')} style={{ ...ui.primaryBtn, opacity: busy || !url.trim() ? 0.6 : 1 }}>{busy === 'website' ? '…' : L(vi, 'Đọc website', 'Read website')}</button>
        {pageConnected && <button type="button" disabled={!!busy} onClick={() => void run('page')} style={{ ...ui.primaryBtn, background: '#1877f2', opacity: busy ? 0.6 : 1 }}>{busy === 'page' ? '…' : L(vi, 'Đọc Fanpage', 'Read the Page')}</button>}
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={L(vi, 'Hoặc dán bảng giá, khuyến mãi, cách chào khách…', 'Or paste a price list, offers, how you greet…')} style={{ ...ui.input, resize: 'vertical' }} />
      <button type="button" disabled={!!busy || text.trim().length < 20} onClick={() => void run('paste')} style={{ ...ghost, alignSelf: 'flex-start', opacity: busy || text.trim().length < 20 ? 0.6 : 1 }}>{busy === 'paste' ? '…' : L(vi, 'Phân loại đoạn đã dán', 'Sort the pasted text')}</button>
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{err}</div>}
      {extra && (['greeting', 'closing', 'instruction'] as const).map((k) => extra[k] ? (
        <div key={k} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 10, border: '1px solid var(--line)', borderRadius: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ccbd5e1)' }}><b style={{ color: 'var(--ce2e8f0)' }}>{k === 'greeting' ? L(vi, 'Lời chào tin nhắn', 'Chat greeting') : k === 'closing' ? L(vi, 'Câu kết', 'Sign-off') : L(vi, 'Quy tắc', 'Rule')}: </b>{extra[k]}</div>
          <button type="button" onClick={() => use(k, String(extra[k]))} style={ghost}>{L(vi, 'Dùng', 'Use')}</button>
        </div>
      ) : null)}
      {rows && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => (
            <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--ccbd5e1)', cursor: 'pointer' }}>
              <input type="checkbox" checked={r.pick} onChange={(e) => setRows((xs) => xs ? xs.map((x, j) => (j === i ? { ...x, pick: e.target.checked } : x)) : xs)} style={{ marginTop: 3 }} />
              <span><b style={{ color: 'var(--ce2e8f0)' }}>{r.label}:</b> {r.value}</span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={!rows.some((r) => r.pick)} onClick={add} style={ui.primaryBtn}>{L(vi, `Thêm ${rows.filter((r) => r.pick).length} dòng`, `Add ${rows.filter((r) => r.pick).length} rows`)}</button>
            <button type="button" onClick={() => setRows(null)} style={ghost}>{L(vi, 'Bỏ qua', 'Discard')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the old notes, moved in once

function OldNotes({ token, vi, info, onDone }: { token: string | null; vi: boolean; info: NonNullable<View['oldNotes']>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const go = async (path: 'merge' | 'undo') => {
    setBusy(true); setErr(null);
    try { await apiFetch(`/ai-brain/legacy/${path}`, { method: 'POST', token }); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };
  if (info.notes.length === 0) {
    if (!info.mergedAt || !info.canUndo) return null;
    return (
      <div style={{ ...ui.banner, marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ flex: 1 }}>{L(vi, `Đã gom ghi chú cũ về đây lúc ${fmtWhen(info.mergedAt, vi)}. Từ giờ chỉ sửa ở trang này.`, `Old notes were moved here on ${fmtWhen(info.mergedAt, vi)}. From now on this is the only place.`)}</span>
        <button type="button" disabled={busy} onClick={() => void go('undo')} style={ghost}>{L(vi, 'Hoàn tác', 'Undo')}</button>
        {err && <span style={{ color: 'var(--ink-bad)' }}>{err}</span>}
      </div>
    );
  }
  return (
    <div style={{ ...ui.card, marginTop: 12, border: '2px solid #f59e0b', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <b style={{ color: 'var(--ce2e8f0)' }}>{L(vi, `${info.notes.length} ghi chú cũ AI đang KHÔNG đọc`, `${info.notes.length} old notes the AI is NOT reading`)}</b>
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 2, lineHeight: 1.5 }}>{L(vi, 'Bạn đã gõ chúng ở trang Messenger / Hotline cũ. Gom về đây để AI làm theo — thêm vào cuối, không xoá gì, hoàn tác được.', 'They were typed on the old Messenger / Hotline screens. Move them here so the AI follows them — appended, nothing removed, with Undo.')}</div>
        </div>
        <button type="button" onClick={() => setShow((v) => !v)} style={ghost}>{show ? L(vi, 'Ẩn', 'Hide') : L(vi, 'Xem', 'Show')}</button>
        <button type="button" disabled={busy} onClick={() => void go('merge')} style={{ ...ui.primaryBtn, opacity: busy ? 0.6 : 1 }}>{L(vi, `Gom ${info.notes.length} ghi chú vào đây`, `Move ${info.notes.length} notes here`)}</button>
      </div>
      {show && info.notes.map((n, i) => (
        <div key={i} style={{ padding: 10, borderRadius: 10, border: '1px solid var(--line)', fontSize: 13 }}>
          <div style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{vi ? n.where.vi : n.where.en} → <b style={{ color: 'var(--ce2e8f0)' }}>{vi ? n.into.vi : n.into.en}</b></div>
          <div style={{ color: 'var(--ccbd5e1)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{n.text}</div>
        </div>
      ))}
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 13 }}>{err}</div>}
    </div>
  );
}
