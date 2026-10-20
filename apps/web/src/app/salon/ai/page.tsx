'use client';

/**
 * /salon/ai — THE SALON'S AI BRAIN. One place for everything the hotline,
 * Messenger, Instagram, Zalo and the website chat say and remember:
 * persona & languages, knowledge & rules, booking policy & hand-off, the
 * channels, the customer memory, a sandbox and the log of why each
 * conversation ended. Mockup: artifact "Bộ não AI — mockup".
 */
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { ui } from '../../../lib/ui';

type Lang = 'en' | 'vi' | 'es' | 'zh' | 'ko' | 'fr' | 'ja';
type Tab = 'overview' | 'persona' | 'knowledge' | 'booking' | 'channels' | 'memory' | 'sandbox';
const TABS: Tab[] = ['overview', 'persona', 'knowledge', 'booking', 'channels', 'memory', 'sandbox'];
const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' }, { id: 'vi', label: 'Tiếng Việt' }, { id: 'es', label: 'Español' },
  { id: 'zh', label: '中文' }, { id: 'ko', label: '한국어' }, { id: 'fr', label: 'Français' }, { id: 'ja', label: '日本語' },
];

interface Brain {
  persona: { agentName: string; tone: 'warm' | 'professional' | 'brief'; intro: string; greeting: string; signoff: string };
  languages: { primary: Lang; allowed: Lang[]; voiceOpening: 'auto' | 'menu' | 'single' };
  knowledge: { facts: { label: string; value: string; on: boolean }[]; rules: string };
  booking: { canBook: boolean; allowGroup: boolean; maxParty: number; canReschedule: boolean; canCancel: boolean; askExtras: boolean; whenFull: 'offer-nearest' | 'say-full' | 'waitlist' };
  handoff: { transferNumber: string; silenceRetries: number; staffQuietMins: number; notifyOwnerPush: boolean; notifyDeskPush: boolean; notifyOwnerSms: boolean };
  channels: { voice: { greeting: string; extra: string }; chat: { greeting: string; extra: string; sendPhotos: boolean; nudgeHours: number } };
  version: number; updatedAt: string | null; updatedBy: string | null;
}
interface View {
  brain: Brain; legacy: boolean; canEdit: boolean; salon: { name: string; market: string };
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
  const tab: Tab = (TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const setTab = (t: Tab) => router.replace(`${pathname}?tab=${t}`);

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
      setBrain(next); setDirty(false);
      setView((v) => (v ? { ...v, brain: next, legacy: false } : v));
      setMsg(L(vi, `✓ Đã lưu — phiên bản ${next.version}, áp dụng cho mọi kênh`, `✓ Saved — version ${next.version}, applied to every channel`));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setBusy(false); }
  };

  if (!view || !brain) return <div style={{ padding: 24, color: msg ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>{msg ?? L(vi, 'Đang tải…', 'Loading…')}</div>;
  const canEdit = view.canEdit;

  const tabLabel: Record<Tab, string> = {
    overview: L(vi, 'Tổng quan & sức khoẻ', 'Overview & health'),
    persona: L(vi, 'Nhân cách & ngôn ngữ', 'Persona & languages'),
    knowledge: L(vi, 'Kiến thức & quy tắc', 'Knowledge & rules'),
    booking: L(vi, 'Đặt lịch & chuyển người', 'Booking & hand-off'),
    channels: L(vi, 'Kênh', 'Channels'),
    memory: L(vi, 'Trí nhớ khách', 'Customer memory'),
    sandbox: L(vi, 'Thử nói chuyện & nhật ký', 'Try it & logs'),
  };

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

      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '16px 0' }}>
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            style={tab === t
              ? { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid #6366f1', background: '#6366f1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
              : { minHeight: 36, padding: '0 12px', borderRadius: 999, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ccbd5e1)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            {tabLabel[t]}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview token={token} vi={vi} view={view} onGo={setTab} />}
      {tab === 'persona' && <Persona brain={brain} patch={patch} vi={vi} canEdit={canEdit} />}
      {tab === 'knowledge' && <Knowledge brain={brain} patch={patch} vi={vi} canEdit={canEdit} />}
      {tab === 'booking' && <Booking brain={brain} patch={patch} vi={vi} canEdit={canEdit} />}
      {tab === 'channels' && <Channels brain={brain} patch={patch} vi={vi} canEdit={canEdit} view={view} />}
      {tab === 'memory' && <Memory token={token} vi={vi} canEdit={canEdit} />}
      {tab === 'sandbox' && <Sandbox token={token} vi={vi} />}
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
        <button type="button" onClick={() => onGo('channels')} style={{ ...ghost, marginTop: 10 }}>{L(vi, 'Cài đặt kênh', 'Channel settings')}</button>
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
        <label style={f.label}>{f.L('Lời chào mở đầu (dùng chung; từng kênh có thể đổi ở mục Kênh)', 'Opening greeting (shared; a channel may override it under Channels)')}</label>
        <textarea value={p.greeting} disabled={!canEdit} rows={2} maxLength={300} onChange={(e) => setP('greeting', e.target.value)} style={{ ...f.input, resize: 'vertical', marginBottom: 12 }} />
        <label style={f.label}>{f.L('Lời kết', 'Sign-off')}</label>
        <input value={p.signoff} disabled={!canEdit} maxLength={200} onChange={(e) => setP('signoff', e.target.value)} style={f.input} />
        <div style={{ ...f.hint, marginTop: 10 }}>{f.L('Trên điện thoại, câu "trợ lý tự động" theo luật được thêm trước lời chào — tiệm không phải tự viết.', 'On the phone the legally required "automated assistant" line is added before the greeting for you.')}</div>
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

// ---------------------------------------------------------------- 3 · knowledge & rules

function Knowledge({ brain, patch, vi, canEdit }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean }) {
  const f = field(vi);
  const facts = brain.knowledge.facts;
  const setFact = (i: number, k: 'label' | 'value' | 'on', v: string | boolean) => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: b.knowledge.facts.map((x, j) => (j === i ? { ...x, [k]: v } : x)) } }));
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
              </div>
              {canEdit && <button type="button" onClick={() => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: b.knowledge.facts.filter((_, j) => j !== i) } }))} style={ui.dangerBtn}>{L(vi, 'Xoá', 'Remove')}</button>}
            </div>
          ))}
          {canEdit && facts.length < 80 && (
            <button type="button" onClick={() => patch((b) => ({ ...b, knowledge: { ...b.knowledge, facts: [...b.knowledge.facts, { label: '', value: '', on: true }] } }))}
              style={{ background: 'transparent', border: '1px dashed var(--line-strong)', color: 'var(--ink-link)', borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
              + {L(vi, 'Thêm câu hỏi thường gặp', 'Add a FAQ')}
            </button>
          )}
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
        <label style={f.label}>{f.L('Hotline: số nối máy tới người thật', 'Hotline: the number a caller is transferred to')}</label>
        <input value={h.transferNumber} disabled={!canEdit} maxLength={40} inputMode="tel" placeholder="+1 512 555 0147" onChange={(e) => setH('transferNumber', e.target.value)} style={{ ...f.input, marginBottom: 4 }} />
        <div style={f.hint}>{f.L('Trống = không nối máy; AI hẹn gọi lại và tạo việc cho tiệm.', 'Blank = no transfer; the assistant promises a call back and leaves the desk a task.')}</div>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 12, lineHeight: 1.6 }}>
          <div><b style={{ color: 'var(--ce2e8f0)' }}>1.</b> {f.L('Nối máy tới số trên (nếu có).', 'Transfer to the number above (if any).')}</div>
          <div><b style={{ color: 'var(--ce2e8f0)' }}>2.</b> {f.L('Không ai nghe / không có số → nói "nhân viên sẽ gọi lại", tạo việc gọi lại + báo tiệm.', 'Nobody answers / no number → "a team member will call back", a callback task + the salon is told.')}</div>
          <div><b style={{ color: 'var(--ce2e8f0)' }}>3.</b> {f.L('Khách im lặng: hỏi lại', 'Silence: ask again')}{num(h.silenceRetries, (n) => setH('silenceRetries', n), 1, 5)}{f.L('lần rồi mới làm bước 2 — không cúp máy ngang.', 'times before step 2 — never a bare hang-up.')}</div>
        </div>
        <label style={{ ...f.label, marginTop: 12 }}>{f.L('Trên chat', 'On chat')}</label>
        <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', lineHeight: 1.6 }}>
          <div>• {f.L('Không biết thì nói "để em hỏi lại tiệm" và tạo việc trả lời; không bịa.', 'When unsure: "let me check with the salon", and a task is created; never a guess.')}</div>
          <div>• {f.L('Thợ/lễ tân gõ vào là AI im trong', 'When staff type, the assistant stays quiet for')}{num(h.staffQuietMins, (n) => setH('staffQuietMins', n), 1, 720)}{f.L('phút.', 'minutes.')}</div>
        </div>
        <label style={{ ...f.label, marginTop: 12 }}>{f.L('Báo cho ai khi có việc gọi lại', 'Who is told about a callback')}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Pill on={h.notifyOwnerPush} disabled={!canEdit} label={f.L('Push chủ tiệm', 'Push the owner')} onClick={() => setH('notifyOwnerPush', !h.notifyOwnerPush)} />
          <Pill on={h.notifyDeskPush} disabled={!canEdit} label={f.L('Push lễ tân đang ca', 'Push the desk on shift')} onClick={() => setH('notifyDeskPush', !h.notifyDeskPush)} />
          <Pill on={h.notifyOwnerSms} disabled={!canEdit} label={f.L('SMS chủ tiệm (sắp có)', 'SMS the owner (soon)')} onClick={() => setH('notifyOwnerSms', !h.notifyOwnerSms)} />
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: 'var(--wash-red)', border: '1px solid var(--line)', fontSize: 13, color: 'var(--ce2e8f0)', marginTop: 12, lineHeight: 1.5 }}>
          <b>{L(vi, 'AI chỉ gác máy khi', 'The assistant hangs up only when')}</b> {L(vi, 'khách đã chào tạm biệt, hoặc đã đặt xong và nói không còn gì. Hết lượt suy nghĩ, lỗi máy chủ, quá chậm → đều đi bước 1–2 ở trên.', 'the customer said goodbye, or is booked and needs nothing else. Out of tool budget, a server error, too slow → steps 1–2 above.')}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 5 · channels

function Channels({ brain, patch, vi, canEdit, view }: { brain: Brain; patch: (fn: (b: Brain) => Brain) => void; vi: boolean; canEdit: boolean; view: View }) {
  const f = field(vi);
  const v = brain.channels.voice, c = brain.channels.chat;
  const setV = (k: keyof Brain['channels']['voice'], val: string) => patch((b) => ({ ...b, channels: { ...b.channels, voice: { ...b.channels.voice, [k]: val } } }));
  const setC = (k: keyof Brain['channels']['chat'], val: unknown) => patch((b) => ({ ...b, channels: { ...b.channels, chat: { ...b.channels.chat, [k]: val } } }));
  const status = (on: boolean) => <span style={{ fontSize: 11, fontWeight: 800, color: on ? 'var(--ink-good)' : 'var(--c94a3b8)', border: '1px solid var(--line)', borderRadius: 999, padding: '3px 8px' }}>{on ? L(vi, '● ĐANG BẬT', '● ON') : L(vi, '○ TẮT', '○ OFF')}</span>;
  return (
    <div>
      <div style={{ ...ui.banner, marginBottom: 14 }}>{L(vi, 'Mọi kênh nhận cùng: nhân cách, ngôn ngữ, kiến thức, quy tắc, cách đặt lịch, cách chuyển người và trí nhớ khách. Ở đây chỉ chỉnh những gì thật sự khác nhau giữa điện thoại và chat; phần nối dây (số, page, chuông, giờ) vẫn ở trang riêng của kênh.', 'Every channel gets the same persona, languages, knowledge, rules, booking policy, hand-off and memory. Only what truly differs between phone and chat is set here; wiring (number, page, ringing, hours) stays on each channel\'s own page.')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14 }}>
        <Card title="☎ Hotline">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {status(view.channels.voice.provisioned && view.channels.voice.enabled)}
            <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{view.channels.voice.number ?? L(vi, 'Chưa có số Lumio', 'No Lumio number yet')}</span>
            <Link href="/salon/voice" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>{L(vi, 'Số, chuông, giờ nghe máy →', 'Number, ringing, hours →')}</Link>
          </div>
          <label style={f.label}>{f.L('Lời chào riêng cho điện thoại (trống = dùng lời chào chung)', 'Phone-only greeting (blank = the shared greeting)')}</label>
          <input value={v.greeting} disabled={!canEdit} maxLength={300} onChange={(e) => setV('greeting', e.target.value)} style={{ ...f.input, marginBottom: 12 }} />
          <label style={f.label}>{f.L('Dặn thêm chỉ khi nói điện thoại', 'Extra notes for the phone only')}</label>
          <textarea value={v.extra} disabled={!canEdit} rows={3} maxLength={1500} onChange={(e) => setV('extra', e.target.value)} placeholder={f.L('vd: Nói chậm, rõ; nhắc khách đọc SĐT từng số.', 'e.g. Speak slowly; ask the caller to read the number digit by digit.')} style={{ ...f.input, resize: 'vertical' }} />
        </Card>
        <Card title={`💬 ${L(vi, 'Messenger, Instagram, Zalo, web chat', 'Messenger, Instagram, Zalo, web chat')}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            {status(view.channels.messenger.connected && view.channels.messenger.enabled)}
            <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{view.channels.messenger.pageName ?? L(vi, 'Chưa nối page', 'No page connected')}{view.channels.messenger.instagram ? ' · Instagram' : ''}</span>
            <Link href="/salon/messenger" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)' }}>{L(vi, 'Nối page, Zalo, mã nhúng →', 'Connect page, Zalo, embed →')}</Link>
          </div>
          <label style={f.label}>{f.L('Lời chào riêng cho chat (trống = dùng lời chào chung)', 'Chat-only greeting (blank = the shared greeting)')}</label>
          <input value={c.greeting} disabled={!canEdit} maxLength={300} onChange={(e) => setC('greeting', e.target.value)} style={{ ...f.input, marginBottom: 12 }} />
          <label style={f.label}>{f.L('Dặn thêm chỉ cho chat', 'Extra notes for chat only')}</label>
          <textarea value={c.extra} disabled={!canEdit} rows={3} maxLength={1500} onChange={(e) => setC('extra', e.target.value)} style={{ ...f.input, resize: 'vertical', marginBottom: 8 }} />
          <Toggle on={c.sendPhotos} disabled={!canEdit} onChange={(val) => setC('sendPhotos', val)} label={L(vi, 'Gửi ảnh mẫu khi khách hỏi "có mẫu nào không"', 'Send sample photos when asked')} />
          <div style={{ fontSize: 13, color: 'var(--ccbd5e1)', padding: '4px 0' }}>{L(vi, 'Nhắc khách chưa chốt sau', 'Nudge an unfinished chat after')}<input type="number" min={0} max={72} value={c.nudgeHours} disabled={!canEdit} onChange={(e) => setC('nudgeHours', Math.max(0, Math.min(72, Number(e.target.value) || 0)))} style={{ ...f.input, width: 70, display: 'inline-block', padding: '5px 8px', margin: '0 6px' }} />{L(vi, 'giờ (0 = không nhắc)', 'hours (0 = never)')}</div>
        </Card>
      </div>
      <div style={{ ...ui.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 24 }}>🔒</span>
        <div style={{ flex: 1, minWidth: 260 }}><div style={{ fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Mỗi tiệm một bộ não, khoá theo tiệm', 'One brain per salon, locked to the salon')}</div><div style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{L(vi, 'Bộ não, trí nhớ khách, nhật ký và việc gọi lại đều gắn với đúng tiệm đang đăng nhập. Tiệm khác không đọc được.', 'The brain, memories, logs and callbacks belong to the salon you are signed into. No other salon can read them.')}</div></div>
      </div>
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
            {open.turns.map((t, i) => <div key={i}><b style={{ color: t.role === 'user' ? 'var(--ce2e8f0)' : 'var(--ink-link)' }}>{t.role === 'user' ? L(vi, 'Khách', 'Customer') : 'AI'}</b> <span style={{ color: 'var(--ccbd5e1)' }}>{t.content}</span></div>)}
          </div>
        </div>
      )}
    </div>
  );
}
