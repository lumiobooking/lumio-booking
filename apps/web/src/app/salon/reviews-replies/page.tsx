'use client';

// Salon-admin page for the Google review auto-reply system.
// - Connect the salon's Google Business Profile (OAuth).
// - Pick which Google location this salon is.
// - Configure the rule (4–5★ draft for one-tap approval, 1–3★ alert the manager).
// - Inbox: approve/post drafted replies, and see the reviews that need a human.
// Everything is tenant-scoped by the backend.

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface GrSettings {
  enabled: boolean; connected: boolean; connectedEmail: string;
  accountId: string; locationId: string; locationTitle: string; hasLocation: boolean;
  autoMinStars: number; alertMaxStars: number; approveFirst: boolean;
  alertEmail: string; tone: string; aiInstruction: string; aiEnabled: boolean; lastSyncAt: string | null;
  clientConfigured: boolean; redirectUri: string;
  counts: Record<string, number>;
}
interface GrReview {
  id: string; googleReviewId: string; reviewerName: string | null; reviewerPhoto: string | null;
  starRating: number; comment: string | null; status: string;
  draftReply: string | null; replyText: string | null; repliedAt: string | null;
  reviewCreatedAt: string | null;
}

type Lang = 'vi' | 'en';
const DICT: Record<string, { vi: string; en: string }> = {
  title: { vi: 'Trả lời đánh giá Google', en: 'Google review replies' },
  subtitle: { vi: 'Tự soạn trả lời cho đánh giá tốt (bạn duyệt 1 chạm); đánh giá xấu thì báo bạn xử lý.', en: 'Auto-draft replies to good reviews for one-tap approval; bad reviews are held for you.' },
  connectTitle: { vi: 'Kết nối Google Business Profile', en: 'Connect Google Business Profile' },
  connectDesc: { vi: 'Đăng nhập bằng tài khoản Google quản lý hồ sơ tiệm để hệ thống đọc và trả lời đánh giá.', en: 'Sign in with the Google account that manages this salon so we can read and reply to reviews.' },
  connectBtn: { vi: 'Kết nối Google', en: 'Connect Google' },
  connected: { vi: 'Đã kết nối', en: 'Connected' },
  disconnect: { vi: 'Ngắt kết nối', en: 'Disconnect' },
  notConfigured: { vi: '⚠️ Nền tảng chưa cấu hình OAuth Google (thiếu GBP_CLIENT_ID). Liên hệ Lumio.', en: '⚠️ Platform Google OAuth is not configured (missing GBP_CLIENT_ID). Contact Lumio.' },
  pendingApproval: { vi: 'Lưu ý: tính năng chỉ hoạt động sau khi Google duyệt quyền API (đơn Basic API Access).', en: 'Note: this only works after Google approves your API access (Basic API Access request).' },
  pickLocation: { vi: 'Chọn địa điểm tiệm trên Google', en: 'Choose this salon’s Google location' },
  loadLocations: { vi: 'Tải danh sách địa điểm', en: 'Load locations' },
  saveLocation: { vi: 'Lưu địa điểm', en: 'Save location' },
  noLocations: { vi: 'Chưa lấy được địa điểm (cần được Google duyệt và tài khoản phải quản lý hồ sơ).', en: 'No locations yet (needs Google approval and the account must manage the profile).' },
  locSet: { vi: 'đã chọn', en: 'selected' },
  changeLoc: { vi: 'Đổi địa điểm', en: 'Change location' },
  filterLoc: { vi: 'Lọc theo tên tiệm…', en: 'Filter by salon name…' },
  locCount: { vi: 'tiệm', en: 'shown' },
  pickFirst: { vi: 'Hãy chọn một tiệm trong danh sách trước.', en: 'Pick a location from the list first.' },
  resyncFresh: { vi: '↻ Xoá & đồng bộ lại', en: '↻ Reset & re-sync' },
  resyncHint: { vi: 'Xoá toàn bộ review đã lưu và kéo lại đúng địa điểm hiện tại (dọn dữ liệu lẫn từ trước).', en: 'Wipe all stored reviews and re-pull fresh for the current location.' },
  regen: { vi: '↻ Tạo lại', en: '↻ Regenerate' },
  aiInstr: { vi: 'Hướng dẫn AI viết trả lời (tùy chọn)', en: 'AI reply instructions (optional)' },
  aiInstrPh: { vi: 'VD: luôn ký "Đội ngũ ABC Nails", nhắc mở cửa 7 ngày, mời khách quay lại…', en: 'e.g. always sign as "The ABC Nails Team", mention we are open 7 days…' },
  aiOn: { vi: 'AI đang bật', en: 'AI on' },
  aiOff: { vi: 'đang dùng mẫu (thêm ANTHROPIC_API_KEY để bật AI)', en: 'using templates (add ANTHROPIC_API_KEY for AI)' },
  testAi: { vi: '🧪 Thử AI viết một câu', en: '🧪 Test AI reply' },
  testingAi: { vi: 'Đang thử…', en: 'Testing…' },
  testOk: { vi: 'AI đang hoạt động! Đây là câu AI vừa viết:', en: 'AI is working! Here is what it wrote:' },
  testFallback: { vi: 'AI chưa chạy — đang dùng mẫu. Xem lỗi bên dưới:', en: 'AI not active — using a template. See error below:' },
  testSample: { vi: 'Review mẫu', en: 'Sample review' },
  autoSyncNote: { vi: 'Tự đồng bộ mỗi 15 phút — khỏi bấm Sync. Review xấu tự gửi email cảnh báo ngay.', en: 'Auto-syncs every 15 min — no need to click Sync. Bad reviews email you automatically.' },
  ruleTitle: { vi: 'Quy tắc trả lời', en: 'Reply rule' },
  ruleAuto: { vi: 'Tự soạn trả lời cho đánh giá từ', en: 'Auto-draft a reply for reviews of' },
  ruleStarUp: { vi: '★ trở lên', en: '★ and up' },
  ruleAlert: { vi: 'Báo quản lý (không tự trả lời) cho đánh giá từ', en: 'Alert the manager (no auto-reply) for reviews of' },
  ruleStarDown: { vi: '★ trở xuống', en: '★ and below' },
  settingsTitle: { vi: 'Cài đặt', en: 'Settings' },
  enable: { vi: 'Bật xử lý tự động', en: 'Enable auto-processing' },
  approveFirst: { vi: 'Chờ tôi duyệt trước khi đăng (khuyên bật)', en: 'Wait for my approval before posting (recommended)' },
  tone: { vi: 'Giọng văn trả lời', en: 'Reply tone' },
  toneWarm: { vi: 'Ấm áp, thân thiện', en: 'Warm & friendly' },
  tonePro: { vi: 'Chuyên nghiệp', en: 'Professional' },
  toneShort: { vi: 'Ngắn gọn', en: 'Short' },
  alertEmail: { vi: 'Email nhận cảnh báo đánh giá xấu', en: 'Email for bad-review alerts' },
  alertEmailPh: { vi: 'để trống = dùng email tiệm', en: 'blank = use salon email' },
  save: { vi: 'Lưu', en: 'Save' },
  saved: { vi: 'Đã lưu ✓', en: 'Saved ✓' },
  syncNow: { vi: 'Đồng bộ đánh giá ngay', en: 'Sync reviews now' },
  syncing: { vi: 'Đang đồng bộ…', en: 'Syncing…' },
  lastSync: { vi: 'Lần đồng bộ gần nhất', en: 'Last sync' },
  never: { vi: 'chưa có', en: 'never' },
  inbox: { vi: 'Hộp đánh giá', en: 'Reviews inbox' },
  fNeeds: { vi: 'Cần xử lý', en: 'Needs attention' },
  fDraft: { vi: 'Chờ duyệt', en: 'To approve' },
  fReplied: { vi: 'Đã trả lời', en: 'Replied' },
  fAll: { vi: 'Tất cả', en: 'All' },
  empty: { vi: 'Chưa có đánh giá nào ở mục này.', en: 'No reviews here yet.' },
  draftLabel: { vi: 'Lời trả lời gợi ý (sửa được):', en: 'Suggested reply (editable):' },
  approvePost: { vi: '✓ Duyệt & đăng lên Google', en: '✓ Approve & post to Google' },
  posting: { vi: 'Đang đăng…', en: 'Posting…' },
  skip: { vi: 'Bỏ qua', en: 'Skip' },
  replyOnGoogle: { vi: 'Trả lời trên Google', en: 'Reply on Google' },
  markHandled: { vi: 'Đánh dấu đã xử lý', en: 'Mark handled' },
  yourReply: { vi: 'Trả lời của bạn:', en: 'Your reply:' },
  needsHuman: { vi: 'Đánh giá này cần bạn trả lời tay (không tự động).', en: 'This one needs a personal reply (no auto-reply).' },
  connectedOk: { vi: 'Đã kết nối Google thành công 🎉', en: 'Google connected successfully 🎉' },
  connectErr: { vi: 'Kết nối Google thất bại. Thử lại.', en: 'Google connection failed. Try again.' },
  loading: { vi: 'Đang tải…', en: 'Loading…' },
};

export default function ReviewRepliesPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => DICT[k]?.[lang as Lang] ?? k;

  const [s, setS] = useState<GrSettings | null>(null);
  const [reviews, setReviews] = useState<GrReview[]>([]);
  const [filter, setFilter] = useState<'NEEDS_ATTENTION' | 'DRAFTED' | 'REPLIED' | 'ALL'>('DRAFTED');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [locations, setLocations] = useState<{ name: string; title: string; address: string }[] | null>(null);
  const [pickAccount, setPickAccount] = useState('');
  const [pickLoc, setPickLoc] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [aiTest, setAiTest] = useState<{ ok: boolean; mode: string; sample: string; reply: string; error?: string } | null>(null);

  const loadReviews = useCallback(async (status: string) => {
    if (!token) return;
    const q = status === 'ALL' ? '' : `?status=${status}`;
    const rows = await apiFetch<GrReview[]>(`/google-reviews/list${q}`, { token }).catch(() => [] as GrReview[]);
    setReviews(rows);
    const d: Record<string, string> = {};
    for (const r of rows) if (r.draftReply) d[r.id] = r.draftReply;
    setDrafts((prev) => ({ ...d, ...prev }));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const st = await apiFetch<GrSettings>('/google-reviews', { token });
      setS(st);
      await loadReviews(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Banner after the OAuth round-trip (Google → /salon/reviews-replies?gbp=…).
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('gbp');
      if (p === 'connected') setFlash(t('connectedOk'));
      else if (p === 'error') setError(t('connectErr'));
      if (p) window.history.replaceState({}, '', '/salon/reviews-replies');
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (!loading) loadReviews(filter); }, [filter, loading, loadReviews]);

  async function connect() {
    try {
      const r = await apiFetch<{ url: string }>('/google-reviews/connect', { token });
      window.location.href = r.url;
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }
  async function disconnect() {
    setS(await apiFetch<GrSettings>('/google-reviews/disconnect', { method: 'POST', token }));
    setLocations(null);
  }
  async function loadLocations() {
    setError(null);
    try {
      const r = await apiFetch<{ accountId: string; locations: { name: string; title: string; address: string }[] }>('/google-reviews/locations', { token });
      setLocations(r.locations); setPickAccount(r.accountId);
      if (r.locations[0]) setPickLoc(r.locations[0].name);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  }
  async function saveLocation() {
    if (!pickLoc) { setError(t('pickFirst')); return; }
    setError(null); setSaving(true); setSaved(false);
    try {
      const title = (locations ?? []).find((l) => l.name === pickLoc)?.title || '';
      const next = await apiFetch<GrSettings>('/google-reviews/location', { method: 'POST', token, body: { accountId: pickAccount, locationId: pickLoc, locationTitle: title } });
      setS(next); setSaved(true); setTimeout(() => setSaved(false), 2500);
      setLocations(null); setLocFilter(''); // collapse picker → shows the "Change location" button + saved title
      setReviews([]); // clear the old location's reviews from view immediately
      await sync(); // pull the newly-selected location's reviews right away
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  }
  async function saveSettings(patch: Partial<GrSettings>) {
    if (!s) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = await apiFetch<GrSettings>('/google-reviews/settings', { method: 'POST', token, body: patch });
      setS(next); setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }
  async function sync() {
    setSyncing(true); setError(null);
    try {
      await apiFetch('/google-reviews/sync', { method: 'POST', token });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setSyncing(false); }
  }
  async function resync() {
    setSyncing(true); setError(null); setReviews([]);
    try {
      await apiFetch('/google-reviews/resync', { method: 'POST', token });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSyncing(false); }
  }
  async function testAi() {
    setTesting(true); setError(null); setAiTest(null);
    try {
      const r = await apiFetch<{ ok: boolean; mode: string; sample: string; reply: string; error?: string }>('/google-reviews/test-ai', { method: 'POST', token });
      setAiTest(r);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setTesting(false); }
  }
  async function approve(id: string) {
    setBusyId(id); setError(null);
    try {
      await apiFetch(`/google-reviews/${id}/approve`, { method: 'POST', token, body: { text: drafts[id] } });
      await loadReviews(filter);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusyId(null); }
  }
  async function regenerate(id: string) {
    setBusyId(id); setError(null);
    try {
      const r = await apiFetch<{ draft: string }>(`/google-reviews/${id}/regenerate`, { method: 'POST', token });
      setDrafts((d) => ({ ...d, [id]: r.draft }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusyId(null); }
  }
  async function skip(id: string) {
    setBusyId(id);
    try { await apiFetch(`/google-reviews/${id}/skip`, { method: 'POST', token }); await loadReviews(filter); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusyId(null); }
  }

  const stars = (n: number) => '★'.repeat(Math.max(0, Math.min(5, n))) + '☆'.repeat(Math.max(0, 5 - n));
  // Filter the (possibly long) location list by name so the salon is easy to find.
  const filteredLocs = (locations ?? []).filter((l) => `${l.title} ${l.address}`.toLowerCase().includes(locFilter.trim().toLowerCase()));

  if (loading || !s) {
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('title')}</h1><p style={{ color: '#94a3b8' }}>{t('loading')}</p></section>;
  }

  const c = s.counts || {};
  return (
    <section style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('subtitle')}</p>

      {flash && <div style={{ ...ui.banner, background: '#14532d', color: '#bbf7d0' }}>{flash}</div>}
      {error && <div style={ui.banner}>{error}</div>}
      {!s.clientConfigured && <div style={{ ...ui.banner, background: '#78350f', color: '#fed7aa' }}>{t('notConfigured')}</div>}

      {/* Connection */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        {!s.connected ? (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>{t('connectTitle')}</div>
            <p style={{ color: '#94a3b8', fontSize: 13.5, margin: '0 0 14px', lineHeight: 1.5 }}>{t('connectDesc')}</p>
            <button onClick={connect} disabled={!s.clientConfigured} style={{ ...ui.primaryBtn, opacity: s.clientConfigured ? 1 : 0.5 }}>{t('connectBtn')}</button>
            <p style={{ color: '#64748b', fontSize: 12, margin: '12px 0 0' }}>{t('pendingApproval')}</p>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, color: '#e2e8f0' }}>
                <span style={{ color: '#22c55e', fontWeight: 700 }}>● {t('connected')}</span>
                {s.connectedEmail ? <span style={{ color: '#94a3b8' }}> · {s.connectedEmail}</span> : null}
              </div>
              <button onClick={disconnect} style={ui.dangerBtn}>{t('disconnect')}</button>
            </div>

            {/* Location picker — always available (even after one is set) + searchable,
                since an agency account can manage many salons. */}
            <div style={{ marginTop: 14, borderTop: '1px solid #334155', paddingTop: 14 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', marginBottom: 8 }}>
                {t('pickLocation')}
                {s.hasLocation && <span style={{ color: '#22c55e', fontWeight: 500, marginLeft: 8, fontSize: 12.5 }}>✓ {t('locSet')}</span>}
              </div>
              {s.hasLocation && s.locationTitle && (
                <div style={{ fontSize: 13, color: '#cbd5e1', marginBottom: 10 }}>📍 <strong>{s.locationTitle}</strong>{saved && <span style={{ color: '#22c55e', marginLeft: 8, fontSize: 12 }}>{t('saved')}</span>}</div>
              )}
              {locations === null ? (
                <button onClick={loadLocations} style={ui.primaryBtn}>{s.hasLocation ? t('changeLoc') : t('loadLocations')}</button>
              ) : locations.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>{t('noLocations')}</p>
              ) : (
                <div>
                  <input value={locFilter} onChange={(e) => setLocFilter(e.target.value)} placeholder={t('filterLoc')} style={{ ...ui.input, marginBottom: 8, maxWidth: 420 }} />
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <select value={pickLoc} onChange={(e) => setPickLoc(e.target.value)} size={Math.min(8, Math.max(2, filteredLocs.length))}
                      style={{ ...ui.input, width: 'auto', minWidth: 320, maxWidth: '100%', height: 'auto' }}>
                      {filteredLocs.map((l) => <option key={l.name} value={l.name}>{l.title}{l.address ? ` — ${l.address}` : ''}</option>)}
                    </select>
                    <button onClick={saveLocation} style={ui.primaryBtn}>{t('saveLocation')}</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>{filteredLocs.length}/{locations.length} {t('locCount')}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Rule + settings */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0', marginBottom: 12 }}>{t('settingsTitle')}</div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 14, color: '#e2e8f0' }}>
          <input type="checkbox" checked={s.enabled} onChange={(e) => saveSettings({ enabled: e.target.checked })} />
          {t('enable')}
        </label>

        {/* Rule */}
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 12, marginBottom: 12, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.9 }}>
          <div>
            {t('ruleAuto')}{' '}
            <select value={s.autoMinStars} onChange={(e) => saveSettings({ autoMinStars: Number(e.target.value) })} style={selStyle}>
              <option value={4}>4</option><option value={5}>5</option>
            </select>{' '}{t('ruleStarUp')} <span style={{ color: '#22c55e' }}>→ {t('fDraft')}</span>
          </div>
          <div>
            {t('ruleAlert')}{' '}
            <select value={s.alertMaxStars} onChange={(e) => saveSettings({ alertMaxStars: Number(e.target.value) })} style={selStyle}>
              <option value={2}>2</option><option value={3}>3</option>
            </select>{' '}{t('ruleStarDown')} <span style={{ color: '#f59e0b' }}>→ {t('fNeeds')}</span>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer', fontSize: 14, color: '#e2e8f0' }}>
          <input type="checkbox" checked={s.approveFirst} onChange={(e) => saveSettings({ approveFirst: e.target.checked })} />
          {t('approveFirst')}
        </label>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label style={ui.label}>{t('tone')}</label>
            <select value={s.tone} onChange={(e) => saveSettings({ tone: e.target.value })} style={ui.input}>
              <option value="warm">{t('toneWarm')}</option>
              <option value="professional">{t('tonePro')}</option>
              <option value="short">{t('toneShort')}</option>
            </select>
          </div>
          <div style={{ flex: '2 1 300px' }}>
            <label style={ui.label}>{t('alertEmail')}</label>
            <input value={s.alertEmail} placeholder={t('alertEmailPh')} onChange={(e) => setS({ ...s, alertEmail: e.target.value })}
              onBlur={(e) => saveSettings({ alertEmail: e.target.value })} style={ui.input} />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={ui.label}>
            {t('aiInstr')}{' '}
            {s.aiEnabled
              ? <span style={{ color: '#22c55e' }}>· ✨ {t('aiOn')}</span>
              : <span style={{ color: '#f59e0b' }}>· {t('aiOff')}</span>}
          </label>
          <textarea value={s.aiInstruction} placeholder={t('aiInstrPh')} rows={2}
            onChange={(e) => setS({ ...s, aiInstruction: e.target.value })}
            onBlur={(e) => saveSettings({ aiInstruction: e.target.value })}
            style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ marginTop: 8 }}>
            <button onClick={testAi} disabled={testing} style={{ ...ghostBtn, padding: '7px 12px', fontSize: 12.5 }}>{testing ? t('testingAi') : t('testAi')}</button>
          </div>
          {aiTest && (
            <div style={{ marginTop: 10, background: '#0f172a', border: `1px solid ${aiTest.ok ? '#14532d' : '#7f1d1d'}`, borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12, color: aiTest.ok ? '#22c55e' : '#f59e0b', fontWeight: 700, marginBottom: 6 }}>
                {aiTest.ok ? `✨ ${t('testOk')}` : `⚠️ ${t('testFallback')}`}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{t('testSample')}: &ldquo;{aiTest.sample}&rdquo;</div>
              <div style={{ fontSize: 13.5, color: '#e2e8f0', lineHeight: 1.5 }}>💬 {aiTest.reply}</div>
              {aiTest.error && <div style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 6 }}>{aiTest.error}</div>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={sync} disabled={syncing || !s.connected || !s.hasLocation} style={{ ...ui.primaryBtn, opacity: (s.connected && s.hasLocation) ? 1 : 0.5 }}>
            {syncing ? t('syncing') : t('syncNow')}
          </button>
          <button onClick={resync} disabled={syncing || !s.connected || !s.hasLocation} title={t('resyncHint')}
            style={{ ...ghostBtn, padding: '9px 12px', fontSize: 12.5, opacity: (s.connected && s.hasLocation) ? 1 : 0.5 }}>
            {t('resyncFresh')}
          </button>
          {saving ? <span style={{ color: '#94a3b8', fontSize: 12 }}>…</span> : saved ? <span style={{ color: '#22c55e', fontSize: 12 }}>{t('saved')}</span> : null}
          <span style={{ color: '#64748b', fontSize: 12, marginLeft: 'auto' }}>
            {t('lastSync')}: {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('en-US') : t('never')}
          </span>
        </div>
        {s.enabled && s.hasLocation && (
          <div style={{ fontSize: 11.5, color: '#22c55e', marginTop: 8 }}>🔄 {t('autoSyncNote')}</div>
        )}
      </div>

      {/* Inbox */}
      <div style={{ ...ui.card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{t('inbox')}</div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', flexWrap: 'wrap' }}>
            {([['DRAFTED', 'fDraft', c.DRAFTED], ['NEEDS_ATTENTION', 'fNeeds', c.NEEDS_ATTENTION], ['REPLIED', 'fReplied', c.REPLIED], ['ALL', 'fAll', undefined]] as const).map(([key, lbl, n]) => (
              <button key={key} onClick={() => setFilter(key)}
                style={{ ...tabStyle, ...(filter === key ? tabActive : {}) }}>
                {t(lbl)}{typeof n === 'number' ? ` (${n})` : ''}
              </button>
            ))}
          </div>
        </div>

        {reviews.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13.5, padding: '10px 0' }}>{t('empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reviews.map((r) => (
              <div key={r.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: r.starRating >= 4 ? '#22c55e' : '#f59e0b', fontSize: 16, letterSpacing: 1 }}>{stars(r.starRating)}</span>
                  <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14 }}>{r.reviewerName || 'Google user'}</span>
                  {r.reviewCreatedAt && <span style={{ color: '#64748b', fontSize: 12 }}>{new Date(r.reviewCreatedAt).toLocaleDateString('en-US')}</span>}
                </div>
                {r.comment && <div style={{ color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.5, marginBottom: 10 }}>{r.comment}</div>}

                {r.status === 'DRAFTED' && (
                  <div>
                    <div style={{ ...ui.label, marginTop: 4 }}>{t('draftLabel')}</div>
                    <textarea value={drafts[r.id] ?? r.draftReply ?? ''} onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                      rows={3} style={{ ...ui.input, resize: 'vertical', lineHeight: 1.5 }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => approve(r.id)} disabled={busyId === r.id} style={ui.primaryBtn}>{busyId === r.id ? t('posting') : t('approvePost')}</button>
                      <button onClick={() => regenerate(r.id)} disabled={busyId === r.id} style={ghostBtn}>{t('regen')}</button>
                      <button onClick={() => skip(r.id)} disabled={busyId === r.id} style={ghostBtn}>{t('skip')}</button>
                    </div>
                  </div>
                )}

                {r.status === 'NEEDS_ATTENTION' && (
                  <div>
                    <div style={{ color: '#f59e0b', fontSize: 12.5, marginBottom: 8 }}>⚠️ {t('needsHuman')}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a href="https://business.google.com/reviews" target="_blank" rel="noreferrer" style={{ ...ui.primaryBtn, textDecoration: 'none', display: 'inline-block' }}>{t('replyOnGoogle')}</a>
                      <button onClick={() => skip(r.id)} disabled={busyId === r.id} style={ghostBtn}>{t('markHandled')}</button>
                    </div>
                  </div>
                )}

                {r.status === 'REPLIED' && r.replyText && (
                  <div style={{ borderLeft: '3px solid #22c55e', paddingLeft: 10, marginTop: 4 }}>
                    <div style={{ ...ui.label, marginBottom: 2 }}>{t('yourReply')}</div>
                    <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.5 }}>{r.replyText}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const selStyle: React.CSSProperties = {
  background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: 6, padding: '2px 6px', fontSize: 13.5, fontWeight: 700,
};
const tabStyle: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap',
};
const tabActive: React.CSSProperties = { background: '#6366f1', color: 'white', borderColor: '#6366f1', fontWeight: 700 };
const ghostBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
};
