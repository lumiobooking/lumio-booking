'use client';

/**
 * Every place the shop can be reached or published to, on one screen.
 *
 * Facebook, Instagram, Google Business, TikTok, Zalo and the website chat
 * each used to be connected from the screen that first needed them — the
 * bot page, the reviews page, the posting calendar. Five doors for the same
 * act, and a new staff member could not tell which channels a shop had
 * without opening all five. This page is the one door: what is connected,
 * to which account, what each connection is used for, and the button that
 * starts or ends it. The screens that USE a channel keep their own status
 * line and link here.
 *
 * Connecting is the owner's act (every /connect route is SALON_ADMIN); a
 * technician sees the state and is told who can change it.
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { SalonShell } from '../../../components/SalonShell';
import { ZaloOaPanel } from '../../../components/ZaloOaPanel';
import { WebChatPanel } from '../../../components/WebChatPanel';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { notify } from '../../../lib/feedback';

interface MetaConf {
  connected: boolean; pageName: string; enabled: boolean; fbConfigured: boolean;
  pages: { pageId: string; pageName: string | null; igId: string | null; igUsername?: string | null; enabled: boolean }[];
}
interface GbpConf {
  connected: boolean; connectedEmail: string; locationTitle: string; hasLocation: boolean; enabled: boolean; clientConfigured?: boolean;
}
interface TikTokConf {
  connected: boolean; displayName: string | null; username: string | null; avatarUrl: string | null; needsReconnect: boolean;
  creator: { privacyOptions: string[]; maxDurationSec: number } | null; clientConfigured: boolean; lastError: string | null;
}

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string; forbidden: boolean };

export default function ChannelsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);
  const canConnect = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN' || Boolean(user?.supportSession);

  const [meta, setMeta] = useState<Load<MetaConf>>({ state: 'loading' });
  const [gbp, setGbp] = useState<Load<GbpConf>>({ state: 'loading' });
  const [tt, setTt] = useState<Load<TikTokConf>>({ state: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);

  const pull = useCallback(async <T,>(path: string, set: (v: Load<T>) => void) => {
    try { set({ state: 'ok', data: await apiFetch<T>(path, { token }) }); }
    catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      set({ state: 'error', message: msg, forbidden: /403|forbidden|not allowed|không có quyền/i.test(msg) });
    }
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    await Promise.all([pull<MetaConf>('/messenger', setMeta), pull<GbpConf>('/google-reviews', setGbp), pull<TikTokConf>('/tiktok', setTt)]);
  }, [token, pull]);
  useEffect(() => { load(); }, [load]);

  // Back from a consent screen: say how it went.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const g = q.get('gbp'); const t = q.get('tiktok');
    if (g === 'connected' || t === 'connected') notify('success', T('Đã kết nối.', 'Connected.'));
    if (g === 'error' || t === 'error') notify('error', `${T('Kết nối không thành công', 'Connection failed')} (${q.get('msg') || 'error'}).`);
    if (g || t) window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Leave for a provider's consent screen. */
  async function go(key: string, path: string) {
    if (!token || busy) return;
    setBusy(key);
    try {
      const { url } = await apiFetch<{ url: string }>(path, { token });
      window.location.href = url;
    } catch (e) { notify('error', e instanceof Error ? e.message : 'error'); setBusy(null); }
  }
  async function post(key: string, path: string, confirmText: string) {
    if (!token || busy) return;
    if (!window.confirm(confirmText)) return;
    setBusy(key);
    try { await apiFetch(path, { method: 'POST', token }); await load(); }
    catch (e) { notify('error', e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  }

  const ownerOnly = !canConnect && (
    <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>{T('Chỉ chủ tiệm (hoặc đội Lumio) kết nối/ngắt được.', 'Only the owner (or the Lumio team) can connect or disconnect.')}</div>
  );

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{T('Kết nối kênh social', 'Social channels')}</h1>
      <p style={{ color: 'var(--c94a3b8)', marginTop: 0, fontSize: 14, lineHeight: 1.55 }}>
        {T('Facebook, Instagram, Google Business, TikTok, Zalo và chat trên website — kết nối một lần ở đây, dùng cho cả đăng bài, bot trả lời và trả lời đánh giá. Chủ tiệm tự cấp quyền trên máy của mình; không ai cần mật khẩu của tiệm.',
           'Facebook, Instagram, Google Business, TikTok, Zalo and website chat — connect once here, used by post scheduling, the reply bot and review replies. The owner grants access from their own device; nobody needs the shop’s passwords.')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14, marginTop: 16 }}>
        {/* ---- Facebook + Instagram ---- */}
        <Card
          icon="📘" title="Facebook · Instagram"
          uses={[T('Đăng bài & lịch đăng', 'Posts & schedule'), T('Bot trả lời Messenger / Instagram DM', 'Messenger / Instagram DM bot'), T('Hộp thư', 'Inbox')]}
          status={meta.state === 'ok' ? (meta.data.pages.length ? 'ok' : 'off') : meta.state === 'error' ? 'error' : 'loading'}
          vi={vi}
        >
          {meta.state === 'ok' && (
            meta.data.pages.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {meta.data.pages.map((p) => (
                  <div key={p.pageId} style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                    <b>{p.pageName ?? p.pageId}</b>
                    {p.igUsername ? <span style={{ color: 'var(--c94a3b8)' }}> · Instagram @{p.igUsername}</span> : <span style={{ color: 'var(--c64748b)' }}> · {T('chưa liên kết Instagram', 'no Instagram linked')}</span>}
                    {!p.enabled && <span style={{ color: 'var(--cfde68a)' }}> · {T('đang tắt', 'switched off')}</span>}
                  </div>
                ))}
                {meta.data.pages.length > 3 && (
                  <div style={{ fontSize: 12, color: 'var(--cfde68a)' }}>{T(`Tiệm đang gắn ${meta.data.pages.length} Trang — thường là chọn nhầm khi kết nối. Vào Bot trả lời tin nhắn → "Chỉ giữ page này".`, `${meta.data.pages.length} Pages are bound — usually a mis-pick at connect time. Open Messenger bot → "Keep only this page".`)}</div>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{T('Chưa kết nối Trang Facebook. Chủ tiệm là admin của Trang bấm Kết nối, chọn đúng một Trang.', 'No Facebook Page yet. The Page admin presses Connect and picks exactly one Page.')}</div>
            )
          )}
          {meta.state === 'error' && <Err vi={vi} e={meta} />}
          <Actions>
            {canConnect && <button style={primary} disabled={busy === 'meta' || (meta.state === 'ok' && !meta.data.fbConfigured)} onClick={() => go('meta', '/messenger/connect')}>
              {meta.state === 'ok' && meta.data.pages.length ? T('Kết nối lại / thêm Trang', 'Reconnect / add a Page') : T('Kết nối Facebook →', 'Connect Facebook →')}
            </button>}
            <Link href="/salon/messenger" style={linkBtn}>{T('Cài đặt bot →', 'Bot settings →')}</Link>
          </Actions>
          {ownerOnly}
        </Card>

        {/* ---- Google Business Profile ---- */}
        <Card
          icon="📍" title="Google Business Profile"
          uses={[T('Trả lời đánh giá Google (AI)', 'Google review replies (AI)'), T('Đăng bài lên Google Maps', 'Posts on Google Maps')]}
          status={gbp.state === 'ok' ? (gbp.data.connected ? (gbp.data.hasLocation ? 'ok' : 'warn') : 'off') : gbp.state === 'error' ? 'error' : 'loading'}
          vi={vi}
        >
          {gbp.state === 'ok' && (
            gbp.data.connected ? (
              <div style={{ fontSize: 13, color: 'var(--ce2e8f0)' }}>
                <b>{gbp.data.locationTitle || T('(chưa chọn địa điểm)', '(no location chosen)')}</b>
                {gbp.data.connectedEmail && <span style={{ color: 'var(--c94a3b8)' }}> · {gbp.data.connectedEmail}</span>}
                {!gbp.data.hasLocation && <div style={{ color: 'var(--cfde68a)', fontSize: 12, marginTop: 3 }}>{T('Đã kết nối tài khoản nhưng chưa chọn địa điểm — vào Đánh giá Google để chọn.', 'Account connected but no location chosen — open Google reviews to pick one.')}</div>}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{T('Chưa kết nối. Dùng tài khoản Google đang quản lý hồ sơ tiệm trên Maps.', 'Not connected. Use the Google account that manages the shop on Maps.')}</div>
            )
          )}
          {gbp.state === 'error' && <Err vi={vi} e={gbp} />}
          <Actions>
            {canConnect && (gbp.state === 'ok' && gbp.data.connected
              ? <button style={ghost} disabled={busy === 'gbp'} onClick={() => post('gbp', '/google-reviews/disconnect', T('Ngắt kết nối Google? Bot ngừng trả lời đánh giá và bài Google Maps sẽ không đăng.', 'Disconnect Google? Review replies and Maps posts will stop.'))}>{T('Ngắt', 'Disconnect')}</button>
              : <button style={primary} disabled={busy === 'gbp'} onClick={() => go('gbp', '/google-reviews/connect')}>{T('Kết nối Google →', 'Connect Google →')}</button>)}
            <Link href="/salon/reviews-replies" style={linkBtn}>{T('Đánh giá Google →', 'Google reviews →')}</Link>
          </Actions>
          {ownerOnly}
        </Card>

        {/* ---- TikTok ---- */}
        <Card
          icon="🎵" title="TikTok"
          uses={[T('Đăng video theo lịch', 'Scheduled video posts')]}
          status={tt.state === 'ok' ? (tt.data.connected ? (tt.data.needsReconnect ? 'warn' : 'ok') : 'off') : tt.state === 'error' ? 'error' : 'loading'}
          vi={vi}
        >
          {tt.state === 'ok' && (
            tt.data.connected ? (
              <div style={{ fontSize: 13, color: 'var(--ce2e8f0)', display: 'flex', alignItems: 'center', gap: 8 }}>
                {tt.data.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tt.data.avatarUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                )}
                <span>
                  <b>{tt.data.displayName ?? 'TikTok'}</b>{tt.data.username && <span style={{ color: 'var(--c94a3b8)' }}> · @{tt.data.username}</span>}
                  {tt.data.needsReconnect && <div style={{ color: 'var(--cfde68a)', fontSize: 12 }}>{T('Quyền đã hết hạn (TikTok cấp tối đa 1 năm) — kết nối lại.', 'Permission expired (TikTok grants at most a year) — reconnect.')}</div>}
                  {tt.data.creator && tt.data.creator.privacyOptions.length === 1 && tt.data.creator.privacyOptions[0] === 'SELF_ONLY' && (
                    <div style={{ color: 'var(--cfde68a)', fontSize: 12 }}>{T('App Lumio chưa được TikTok duyệt: bài chỉ đăng riêng tư cho tới khi duyệt xong.', 'Lumio’s app is not audited by TikTok yet: posts stay private until it is.')}</div>
                  )}
                  {tt.data.lastError && <div style={{ color: 'var(--cfca5a5)', fontSize: 12 }}>{tt.data.lastError}</div>}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>
                {tt.data.clientConfigured
                  ? T('Chưa kết nối. Chủ tài khoản TikTok bấm Kết nối trên máy của mình → đăng nhập → Cho phép.', 'Not connected. The TikTok account owner presses Connect on their own device → sign in → Allow.')
                  : T('Nền tảng chưa cấu hình TikTok (thiếu client key) — đội Lumio đang đăng ký app với TikTok.', 'TikTok is not configured on the platform yet (no client key) — the Lumio team is registering the app with TikTok.')}
              </div>
            )
          )}
          {tt.state === 'error' && <Err vi={vi} e={tt} />}
          <Actions>
            {canConnect && tt.state === 'ok' && (
              tt.data.connected ? (
                <>
                  {tt.data.needsReconnect && <button style={primary} disabled={busy === 'tt'} onClick={() => go('tt', '/tiktok/connect')}>{T('Kết nối lại TikTok', 'Reconnect TikTok')}</button>}
                  <button style={ghost} disabled={busy === 'tt'} onClick={() => post('tt', '/tiktok/disconnect', T('Ngắt kết nối TikTok? Bài đã chốt lịch lên TikTok sẽ không đăng.', 'Disconnect TikTok? Posts locked for TikTok will not go out.'))}>{T('Ngắt', 'Disconnect')}</button>
                </>
              ) : (
                <button style={primary} disabled={busy === 'tt' || !tt.data.clientConfigured} onClick={() => go('tt', '/tiktok/connect')}>{busy === 'tt' ? T('Đang mở TikTok…', 'Opening TikTok…') : T('Kết nối TikTok →', 'Connect TikTok →')}</button>
              )
            )}
            <Link href="/salon/content?tab=queue" style={linkBtn}>{T('Lịch đăng bài →', 'Post schedule →')}</Link>
          </Actions>
          {ownerOnly}
        </Card>
      </div>

      {/* ---- Zalo OA and the website widget keep their own panels: each is
           a form, not a button, and both already exist. Rendered here so the
           page is complete, not to make a third copy of either. ---- */}
      <div style={{ ...ui.card, marginTop: 14, padding: 16 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)' }}>💬 Zalo Official Account</div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 2 }}>{T('Dùng cho: bot trả lời Zalo, hộp thư. Cần gói OA Tăng trưởng/Toàn diện để có API.', 'Used for: the Zalo reply bot and the inbox. Needs a Growth/Complete OA tier for API access.')}</div>
        <ZaloOaPanel token={token} embedded />
      </div>
      <div style={{ marginTop: 14 }}>
        <WebChatPanel token={token} />
      </div>
    </section>
  );
}

// ---- pieces ---------------------------------------------------------------------

const STATE: Record<string, { color: string; bg: string; vi: string; en: string }> = {
  ok: { color: '#22c55e', bg: 'var(--c052e16)', vi: 'Đã kết nối ✓', en: 'Connected ✓' },
  warn: { color: '#f59e0b', bg: 'var(--c451a03)', vi: 'Cần chú ý', en: 'Needs attention' },
  error: { color: '#ef4444', bg: 'var(--c450a0a)', vi: 'Không đọc được', en: 'Could not read' },
  off: { color: 'var(--c64748b)', bg: 'var(--c1e293b)', vi: 'Chưa kết nối', en: 'Not connected' },
  loading: { color: 'var(--c64748b)', bg: 'var(--c1e293b)', vi: 'Đang tải…', en: 'Loading…' },
};

function Card({ icon, title, uses, status, vi, children }: { icon: string; title: string; uses: string[]; status: string; vi: boolean; children: ReactNode }) {
  const st = STATE[status] ?? STATE.off;
  return (
    <div style={{ ...ui.card, padding: 16, display: 'flex', flexDirection: 'column', gap: 8, borderColor: status === 'ok' ? 'var(--c1e293b)' : status === 'warn' ? '#f59e0b' : 'var(--c1e293b)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <b style={{ fontSize: 15, color: 'var(--ce2e8f0)' }}>{title}</b>
        <span style={{ marginLeft: 'auto', background: st.bg, color: st.color, border: `1px solid ${st.color}`, borderRadius: 999, padding: '2px 10px', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{vi ? st.vi : st.en}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Dùng cho' : 'Used for'}: {uses.join(' · ')}</div>
      {children}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 4 }}>{children}</div>;
}

function Err({ vi, e }: { vi: boolean; e: { message: string; forbidden: boolean } }) {
  return (
    <div style={{ fontSize: 12.5, color: e.forbidden ? 'var(--c94a3b8)' : 'var(--cfca5a5)' }}>
      {e.forbidden
        ? (vi ? 'Chỉ chủ tiệm xem được kết nối này.' : 'Only the owner can see this connection.')
        : `${vi ? 'Không đọc được trạng thái' : 'Could not read the status'}: ${e.message}`}
    </div>
  );
}

const primary: CSSProperties = { padding: '7px 13px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
const ghost: CSSProperties = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const linkBtn: CSSProperties = { padding: '7px 13px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ca5b4fc)', fontSize: 13, textDecoration: 'none', display: 'inline-block' };
