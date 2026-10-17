'use client';

// ---------------------------------------------------------------------------
// Google "Book online" for every salon — the agency's readiness board.
//
// Each salon is READY (in tonight's feed to Google), needs a FIX (held back,
// with the exact lines Google would refuse) or is OFF. The board also shows
// the last upload and lets the team download today's six feed files to hand
// to Google by hand during the sandbox, and run the upload now.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { C } from '../AgencyParts';

interface Issue { code: string; level: 'error' | 'warn'; message: string; serviceId?: string; serviceName?: string }
interface BookingLink { state: 'linked' | 'skipped' | 'error' | 'removed'; uri: string | null; at: string; reason?: string; others?: number }
interface Row { id: string; name: string; slug: string; status: 'ready' | 'fix' | 'off'; feedable: number; issues: Issue[]; profileTitle: string | null; profileAt: string | null; mapsUrl: string | null; bookingLink?: BookingLink | null }
interface LinkRun { at: string; linked: number; skipped: number; failed: number; removed: number }
interface RunReport { at: string; tenants: number; ready: number; held: number; files: string[]; uploaded: boolean; error?: string }
interface Board { rows: Row[]; lastRun: RunReport | null; lastLinkRun?: LinkRun | null; sftpConfigured: boolean; partnerId: string | null }

/** The salon's own "Book" link on Google (Place Actions API), as the last run left it. */
const LINK_LOOK: Record<BookingLink['state'] | 'none', { label: string; ink: string; bg: string }> = {
  linked: { label: '🔗 Đã gắn Đặt lịch', ink: 'var(--ink-good)', bg: 'rgba(34,197,94,.14)' },
  error: { label: 'Lỗi gắn link', ink: 'var(--ink-bad)', bg: 'var(--wash-red)' },
  skipped: { label: 'Chưa gắn', ink: 'var(--c94a3b8)', bg: 'var(--c1e293b)' },
  removed: { label: 'Đã gỡ link', ink: 'var(--c94a3b8)', bg: 'var(--c1e293b)' },
  none: { label: 'Chưa chạy', ink: 'var(--c94a3b8)', bg: 'var(--c1e293b)' },
};

const LOOK = {
  ready: { label: 'Sẵn sàng', ink: 'var(--ink-good)', bg: 'rgba(34,197,94,.14)' },
  fix: { label: 'Cần sửa', ink: 'var(--ink-warn)', bg: 'var(--wash-amber-3)' },
  off: { label: 'Tắt', ink: 'var(--c94a3b8)', bg: 'var(--c1e293b)' },
} as const;

function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AgencyGoogleBookPage() {
  const router = useRouter();
  const { token, user, ready } = useAuth();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'fix' | 'ready' | 'off'>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!ready) return;
    if (!user || (user.role !== 'SUPPORT' && user.role !== 'SUPER_ADMIN')) router.replace('/login');
  }, [ready, user, router]);

  const load = useCallback(() => {
    if (!token) return;
    setError(null);
    apiFetch<Board>('/support/google-book/readiness', { token }).then(setBoard).catch((e) => setError(e instanceof Error ? e.message : 'error'));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const act = async (key: string, path: string, body?: unknown) => {
    if (!token) return;
    setBusy(key); setError(null);
    try { await apiFetch(path, { method: 'POST', token, body: body ?? {} }); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  };

  const download = async () => {
    if (!token) return;
    setBusy('dl');
    try {
      const r = await apiFetch<{ files: { name: string; body: string }[]; ready: string[]; held: string[] }>('/support/google-book/feeds', { token });
      for (const f of r.files) {
        const blob = new Blob([f.body], { type: 'application/json' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(null); }
  };

  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => undefined);
  };
  // What Google's partner interest form asks for, read off the board: the salons that would go live
  // at launch (status 'ready') and five of their Maps listings.
  const form = useMemo(() => {
    const all = board?.rows ?? [];
    const live = all.filter((r) => r.status === 'ready');
    const withMaps = live.filter((r) => r.mapsUrl);
    const five = withMaps.slice(0, 5);
    return { live: live.length, total: all.length, withMaps: withMaps.length, five, links: five.map((r) => r.mapsUrl as string).join(', ') };
  }, [board]);

  const counts = useMemo(() => {
    const c = { all: 0, ready: 0, fix: 0, off: 0 };
    for (const r of board?.rows ?? []) { c.all++; c[r.status]++; }
    return c;
  }, [board]);
  const links = useMemo(() => {
    const c = { linked: 0, error: 0, other: 0, topError: '' as string, topCount: 0 };
    const why = new Map<string, number>();
    for (const r of board?.rows ?? []) {
      const s = r.bookingLink?.state;
      if (s === 'linked') c.linked++;
      else if (s === 'error') { c.error++; const k = r.bookingLink?.reason ?? ''; why.set(k, (why.get(k) ?? 0) + 1); }
      else c.other++;
    }
    // The error most salons share is usually ONE setting to fix (an API not enabled), not N problems.
    for (const [k, n] of why) if (n > c.topCount) { c.topError = k; c.topCount = n; }
    return c;
  }, [board]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (board?.rows ?? []).filter((r) => (filter === 'all' || r.status === filter) && (!needle || `${r.name} ${r.slug}`.toLowerCase().includes(needle)))
      .sort((a, b) => ({ fix: 0, ready: 1, off: 2 }[a.status] - { fix: 0, ready: 1, off: 2 }[b.status]) || a.name.localeCompare(b.name));
  }, [board, filter, q]);

  if (!ready || !board) return <main style={{ minHeight: '100dvh', background: C.bg, color: C.sub, padding: 24 }}>{error ?? 'Loading…'}</main>;
  const run = board.lastRun;

  return (
    <main style={{ minHeight: '100dvh', background: C.bg, color: C.ink2, padding: '24px 20px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <a href="/agency" style={{ color: C.link, textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Tiệm</a>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: C.ink }}>Nút “Đặt lịch” trên Google</h1>
          <span style={{ fontSize: 13, color: C.sub }}>feed Actions Center · {counts.ready} sẵn sàng · {counts.fix} cần sửa · {counts.off} tắt</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => act('links', '/support/google-book/booking-links/sync')} disabled={busy === 'links'} style={primary}>{busy === 'links' ? 'Đang gắn…' : '🔗 Gắn nút Đặt lịch cho mọi tiệm'}</button>
          <button type="button" onClick={download} disabled={busy === 'dl'} style={ghost}>{busy === 'dl' ? '…' : '⬇ Tải 6 file feed hôm nay'}</button>
          <button type="button" onClick={() => act('run', '/support/google-book/run')} disabled={busy === 'run'} style={primary}>{busy === 'run' ? 'Đang chạy…' : '▶ Tạo & upload ngay'}</button>
        </div>

        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.ink }}>Link “Đặt lịch” trên hồ sơ Google của từng tiệm</div>
            <div style={{ fontSize: 13, color: C.sub }}><b style={{ color: C.good }}>{links.linked}</b> đã gắn · <b style={{ color: links.error ? C.bad : C.sub }}>{links.error}</b> lỗi · {links.other} chưa gắn{board.lastLinkRun ? ` · chạy lúc ${when(board.lastLinkRun.at)}` : ''}</div>
          </div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 6, lineHeight: 1.55 }}>
            {links.topCount > 0 && (
              <div style={{ margin: '0 0 8px', padding: '9px 12px', borderRadius: 10, background: 'var(--wash-red)', color: 'var(--ink-bad)', fontWeight: 700, fontSize: 13 }}>
                {links.topCount} tiệm lỗi cùng lý do: {links.topError || 'không rõ'}
              </div>
            )}
            Lumio đặt trang đặt lịch của tiệm (<code>lumiobooking.com/&lt;tiệm&gt;/gbp</code>) làm <b>link đặt lịch ưu tiên</b> trên chính hồ sơ Google của tiệm — đúng ô “Bookings → link đặt lịch” chủ tiệm tự điền — qua Place Actions API, tự chạy mỗi đêm. Trên Google Maps/Search, khách thấy nút/ô “Đặt lịch hẹn · Book” mở thẳng trang đặt lịch của tiệm. Tiệm được gắn khi: đang bật, đã nối đúng hồ sơ Google của mình, có dịch vụ đặt online. Nút đặt ngay <i>trong</i> Google (Reserve with Google) vẫn chỉ dành cho đối tác Google duyệt.
          </div>
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
          <Tile label="Lần chạy cuối" value={run ? when(run.at) : 'chưa chạy'} sub={run ? `${run.ready} tiệm vào feed · ${run.held} giữ lại${run.error ? ` · ${run.error}` : ''}` : 'chạy hằng đêm ~03:00 UTC khi RWG_FEED_AUTORUN=true'} tone={run?.error ? 'warn' : 'ok'} />
          <Tile label="Upload SFTP" value={board.sftpConfigured ? 'đã cấu hình' : 'chưa cấu hình'} sub={board.sftpConfigured ? 'RWG_SFTP_HOST / USER / KEY' : 'lấy host, user, SSH key trong Partner Portal → Configuration → Feeds; đặt env RWG_SFTP_HOST, RWG_SFTP_USER, RWG_SFTP_KEY'} tone={board.sftpConfigured ? 'ok' : 'warn'} />
          <Tile label="Conversion partner id" value={board.partnerId ? board.partnerId : 'chưa có'} sub={board.partnerId ? 'NEXT_PUBLIC_RWG_PARTNER_ID — trang đặt lịch gửi rwg_token khi khách đặt xong' : 'Google cấp sau khi nhận đối tác; đặt NEXT_PUBLIC_RWG_PARTNER_ID rồi deploy'} tone={board.partnerId ? 'ok' : 'warn'} />
        </div>

        <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>Điền form đăng ký đối tác Google</div>
            <div style={{ fontSize: 12, color: C.muted }}>số liệu lấy thẳng từ bảng bên dưới — chỉ tính tiệm “Sẵn sàng”</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(0, 2.2fr) auto', gap: '8px 14px', alignItems: 'center', marginTop: 10, fontSize: 13 }}>
            <div style={{ color: C.sub }}>Estimated count of merchant locations</div>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 18 }}>{form.live} <span style={{ fontSize: 12, fontWeight: 500, color: C.muted }}>tiệm sẵn sàng / {form.total} đang hoạt động</span></div>
            <button type="button" style={ghost} onClick={() => copy('n', String(form.live))}>{copied === 'n' ? '✓ đã chép' : 'Chép'}</button>

            <div style={{ color: C.sub }}>Links to 5 merchants’ Google Business Profiles</div>
            <div style={{ minWidth: 0 }}>
              {form.five.length === 0 && <div style={{ color: C.warn, fontSize: 12.5 }}>Chưa tiệm nào có link Maps — tiệm phải “Sẵn sàng” và đã nối Google (bấm “đọc lại” để tải hồ sơ Google của tiệm).</div>}
              {form.five.map((r) => (
                <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <span style={{ color: C.ink2, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.name}</span>
                  <a href={r.mapsUrl as string} target="_blank" rel="noreferrer" style={{ color: C.link, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.mapsUrl}</a>
                </div>
              ))}
              {form.five.length > 0 && form.five.length < 5 && <div style={{ color: C.warn, fontSize: 12 }}>Google hỏi 5 link — mới có {form.withMaps} tiệm sẵn sàng có link Maps.</div>}
            </div>
            <button type="button" style={ghost} disabled={!form.links} onClick={() => copy('l', form.links)}>{copied === 'l' ? '✓ đã chép' : 'Chép 5 link (phẩy)'}</button>

            <div style={{ color: C.sub }}>Primary service offered</div>
            <div style={{ color: C.ink, fontWeight: 700 }}>Beauty &amp; Wellness (salons, cosmetics store, etc) <span style={{ fontWeight: 500, color: C.muted }}>— nếu danh sách là loại hình thì chọn Appointments</span></div>
            <span />

            <div style={{ color: C.sub }}>Additional type of services</div>
            <div style={{ color: C.ink, fontWeight: 700 }}>☑ None / Not applicable nếu có, nếu không thì chỉ ☑ Beauty &amp; Wellness <span style={{ fontWeight: 500, color: C.muted }}>— không tích ngành Lumio không phục vụ</span></div>
            <span />
          </div>
        </section>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {(['all', 'fix', 'ready', 'off'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)} style={{ ...chip, ...(filter === k ? chipOn : {}) }}>
              {k === 'all' ? 'Tất cả' : LOOK[k].label} <span style={{ opacity: 0.7 }}>{counts[k]}</span>
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tiệm…" style={{ marginLeft: 'auto', height: 34, padding: '0 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.ink2, fontSize: 13, minWidth: 220 }} />
        </div>
        {error && <div style={{ color: C.bad, fontSize: 13, marginBottom: 10 }}>{error}</div>}

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: 'hidden' }}>
          {rows.length === 0 && <div style={{ padding: 18, color: C.muted, fontSize: 14 }}>Không có tiệm nào.</div>}
          {rows.map((r) => {
            const look = LOOK[r.status];
            const errors = r.issues.filter((i) => i.level === 'error');
            const warns = r.issues.filter((i) => i.level === 'warn');
            const isOpen = open === r.id;
            return (
              <div key={r.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                <div role="button" tabIndex={0} onClick={() => setOpen(isOpen ? null : r.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(isOpen ? null : r.id); }}
                  style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.4fr) 120px 150px minmax(0, 2fr) 170px', gap: 14, alignItems: 'center', padding: '11px 16px', cursor: 'pointer' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>/{r.slug}{r.profileTitle ? ` · Google: ${r.profileTitle}` : ''}{r.mapsUrl && <> · <a href={r.mapsUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.link }}>Maps ↗</a></>}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: look.bg, color: look.ink, whiteSpace: 'nowrap', justifySelf: 'start' }}>{look.label}</span>
                  {(() => { const lk = LINK_LOOK[r.bookingLink?.state ?? 'none']; return (
                    <span title={r.bookingLink?.reason ?? r.bookingLink?.uri ?? ''} style={{ display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: lk.bg, color: lk.ink, whiteSpace: 'nowrap', justifySelf: 'start' }}>{lk.label}</span>
                  ); })()}
                  <div style={{ fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.bookingLink?.state === 'error' && r.bookingLink.reason ? <span style={{ color: 'var(--ink-bad)' }}>Link: {r.bookingLink.reason} · </span> : null}
                    {r.status === 'ready' ? `${r.feedable} dịch vụ vào feed${warns.length ? ` · ${warns.length} lưu ý` : ''}` : errors[0]?.message ?? warns[0]?.message ?? ''}
                    {errors.length > 1 ? ` · +${errors.length - 1} lỗi` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void act(`bl-${r.id}`, `/support/google-book/tenants/${r.id}/booking-link`); }} style={ghost} title="Gắn / làm mới link Đặt lịch trên hồ sơ Google của tiệm">
                      {busy === `bl-${r.id}` ? '…' : '🔗 Gắn link'}
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void act(`en-${r.id}`, `/support/google-book/tenants/${r.id}/enabled`, { enabled: r.status === 'off' }); }} style={ghost}>
                      {busy === `en-${r.id}` ? '…' : r.status === 'off' ? 'Bật' : 'Tắt'}
                    </button>
                  </div>
                </div>
                {isOpen && (
                  <div style={{ padding: '0 16px 14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 13, padding: '7px 10px', borderRadius: 8, background: C.soft, border: `1px solid ${C.line}`, color: C.body }}>
                      <b style={{ color: C.ink2 }}>Link Đặt lịch trên Google:</b>{' '}
                      {r.bookingLink?.state === 'linked' && r.bookingLink.uri
                        ? <>đã gắn <a href={r.bookingLink.uri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.link }}>{r.bookingLink.uri}</a> làm link ưu tiên{r.bookingLink.others ? ` · hồ sơ còn ${r.bookingLink.others} link đặt lịch khác (của chủ tiệm/đối tác, Lumio không đụng)` : ''}</>
                        : r.bookingLink?.reason ?? 'chưa chạy — bấm “🔗 Gắn link”.'}
                      {r.bookingLink?.at ? <span style={{ color: C.muted }}> · {when(r.bookingLink.at)}</span> : null}
                    </div>
                    {r.issues.length === 0 && <div style={{ fontSize: 13, color: C.good }}>✓ Không có gì phải sửa.</div>}
                    {r.issues.map((i, n) => (
                      <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '7px 10px', borderRadius: 8, background: C.soft, border: `1px solid ${C.line}` }}>
                        <span style={{ color: i.level === 'error' ? C.bad : C.warn, fontWeight: 800, flexShrink: 0 }}>{i.level === 'error' ? '✕' : '!'}</span>
                        <span style={{ flex: 1, color: C.body }}>{i.message}</span>
                        {(i.code === 'name_caps') && <button type="button" onClick={() => act(`fix-${r.id}`, `/support/google-book/tenants/${r.id}/fix-name`)} style={ghost}>{busy === `fix-${r.id}` ? '…' : 'Sửa tên'}</button>}
                        {((i.code === 'svc_caps' || i.code === 'svc_caps_fixed') && i.serviceId) && <button type="button" onClick={() => act(`fix-${i.serviceId}`, `/support/google-book/tenants/${r.id}/services/${i.serviceId}/fix-name`)} style={ghost}>{busy === `fix-${i.serviceId}` ? '…' : 'Sửa tên'}</button>}
                        {(i.code === 'google_not_linked' || i.code === 'google_mismatch') && <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>Vào tiệm → Google Reviews</span>}
                      </div>
                    ))}
                    <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Hồ sơ Google đọc lúc {when(r.profileAt)} · <button type="button" onClick={() => { if (!token) return; setBusy(`rf-${r.id}`); apiFetch(`/support/google-book/tenants/${r.id}?refresh=1`, { token }).then(load).catch(() => undefined).finally(() => setBusy(null)); }} style={{ ...link }}>{busy === `rf-${r.id}` ? '…' : 'đọc lại'}</button></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 16, fontSize: 12.5, color: C.sub, lineHeight: 1.6 }}>
          <b style={{ color: C.ink2 }}>Thủ tục với Google (Lumio làm, không phải code):</b> nộp form đối tác Actions Center (Appointments Redirect) → nhận Partner Portal → Configuration: SSH key, Brand, liên hệ hỗ trợ → lấy host/user SFTP (env RWG_SFTP_*) và partner id (env NEXT_PUBLIC_RWG_PARTNER_ID) → upload feed sandbox, xem Feeds › History → Google review → Production. Chỉ tiệm “Sẵn sàng” vào feed.
        </div>
      </div>
    </main>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'ok' | 'warn' }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.muted }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: tone === 'ok' ? C.good : C.warn, marginTop: 3 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.sub, marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
    </div>
  );
}

const ghost: React.CSSProperties = { height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const primary: React.CSSProperties = { height: 34, padding: '0 14px', borderRadius: 10, border: 0, background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const chip: React.CSSProperties = { height: 32, padding: '0 12px', borderRadius: 999, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const chipOn: React.CSSProperties = { border: '1px solid #6366f1', background: '#6366f1', color: '#fff' };
const link: React.CSSProperties = { border: 0, background: 'transparent', color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 };
