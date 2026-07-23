'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface ApiKey {
  id: string;
  name: string | null;
  keyPrefix: string;
  lastFour: string;
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt: string | null;
  createdAt: string;
}

export default function IntegrationsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null); // shown once
  const [name, setName] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [ga4Id, setGa4Id] = useState('');
  const [gtmId, setGtmId] = useState('');
  const [anMode, setAnMode] = useState('');
  const [savingAn, setSavingAn] = useState(false);
  const [anMsg, setAnMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [keyList, tenant, settings] = await Promise.all([
        apiFetch<ApiKey[]>('/api-keys', { token }),
        apiFetch<{ slug: string }>('/me/tenant', { token }),
        apiFetch<{ analytics?: { ga4Id?: string; gtmId?: string; mode?: string } }>('/settings', { token }).catch(() => null),
      ]);
      setKeys(keyList);
      setSlug(tenant?.slug ?? null);
      setGa4Id(settings?.analytics?.ga4Id ?? '');
      setGtmId(settings?.analytics?.gtmId ?? '');
      setAnMode(settings?.analytics?.mode ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Always show the branded, clean booking link (lumiobooking.com/<slug>) — not
  // whatever host the admin happens to be on. The web app rewrites /<slug> → /book/<slug>.
  const WEB_BASE = (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://lumiobooking.com').replace(/\/+$/, '');
  const bookingLink = slug ? `${WEB_BASE}/${slug}` : null;
  // First-party attribution link for Google Business Profile: the UTM is what
  // lets the system prove a SPECIFIC booking came from Google Maps (the booking
  // page stores utm_* on every appointment). Same page, just stamped.
  // Short GBP link — the /gbp route stamps the full campaign itself.
  const gbpLink = bookingLink ? `${bookingLink}/gbp` : null;

  useEffect(() => {
    load();
  }, [load]);

  async function saveAnalytics() {
    setSavingAn(true); setAnMsg(null); setError(null);
    try {
      await apiFetch('/settings/analytics', { method: 'PATCH', token, body: { ga4Id: ga4Id.trim(), gtmId: gtmId.trim(), mode: anMode } });
      setAnMsg(lang === 'vi' ? '✓ Đã lưu. Trang đặt lịch của tiệm sẽ nạp GA4/GTM này.' : '✓ Saved. Your booking page now loads this GA4/GTM.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save analytics'); }
    finally { setSavingAn(false); }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await apiFetch<{ plaintextKey: string }>('/api-keys', {
        method: 'POST',
        token,
        body: { name: name || undefined, siteUrl: siteUrl || undefined },
      });
      setNewKey(res.plaintextKey);
      setName('');
      setSiteUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm(t('in.confirmRevoke'))) return;
    try {
      await apiFetch(`/api-keys/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  return (
    <section>
      {error && <div style={ui.banner}>{error}</div>}

      {/* Option 1: hosted online booking link (no WordPress needed) */}
      <div style={{ ...ui.card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('in.bookingLinkTitle')}</h2>
        <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
          {t('in.bookingLinkDesc')}
        </p>
        {bookingLink ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              style={{
                flex: 1,
                minWidth: 240,
                padding: '10px 12px',
                background: '#0f172a',
                borderRadius: 8,
                wordBreak: 'break-all',
                fontSize: 14,
              }}
            >
              {bookingLink}
            </code>
            <button onClick={() => navigator.clipboard?.writeText(bookingLink)} style={ui.primaryBtn}>
              {t('in.copy')}
            </button>
            <a href={bookingLink} target="_blank" rel="noreferrer" style={{ ...ui.primaryBtn, textDecoration: 'none', background: 'transparent', border: '1px solid #475569', color: '#e2e8f0' }}>
              {t('in.open')}
            </a>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: 13 }}>{t('in.loadingLink')}</p>
        )}
      </div>

      {/* Add the Book button to the salon's Google Business Profile */}
      <div style={{ ...ui.card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>📍 {lang === 'vi' ? 'Thêm nút “Book online” lên Google' : 'Add a “Book online” button to Google'}</h2>
        <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14, lineHeight: 1.6 }}>
          {lang === 'vi'
            ? 'Dán link NGẮN dưới đây vào Google Business Profile của tiệm. Route /gbp mở đúng form đặt lịch bình thường và tự gắn nguồn Google Maps — mỗi booking từ Google được ghi nhận đích danh, không cần link dài lằng nhằng UTM. Google duyệt ~24–48h.'
            : 'Paste the SHORT link below into the salon\'s Google Business Profile. The /gbp route opens the normal booking form and stamps the Google Maps source itself — every Google booking is attributed by name, no long UTM link needed. Google reviews it in ~24–48h.'}
        </p>
        {gbpLink && (
          <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '9px 12px', fontFamily: 'monospace', fontSize: 12, color: '#a5b4fc', wordBreak: 'break-all', marginBottom: 10 }}>{gbpLink}</div>
        )}
        <ol style={{ color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.9, margin: '8px 0 12px', paddingLeft: 20 }}>
          <li>{lang === 'vi' ? 'Mở Google Business Profile của tiệm (nút dưới), đăng nhập tài khoản sở hữu hồ sơ.' : 'Open the salon\'s Google Business Profile (button below); sign in with the owning account.'}</li>
          <li>{lang === 'vi' ? 'Edit profile → Bookings / Appointment links.' : 'Edit profile → Bookings / Appointment links.'}</li>
          <li>{lang === 'vi' ? 'Add appointment link → dán ĐÚNG link /gbp ở trên (đừng dán link thường — sẽ mất định danh nguồn Google) → Save.' : 'Add appointment link → paste the /gbp link above (not the plain link — you would lose Google attribution) → Save.'}</li>
          <li>{lang === 'vi' ? 'Chờ 24–48h Google duyệt → nút “Book online” hiện ra.' : 'Wait 24–48h for Google to approve → the “Book online” button appears.'}</li>
          <li style={{ color: '#f59e0b' }}>{lang === 'vi' ? 'KHÔNG dùng link này làm Final URL trong Google Ads — Ads dùng URL riêng + auto-tagging (gclid) để hệ thống phân biệt đơn từ quảng cáo và đơn từ Maps.' : 'Do NOT use this link as a Google Ads Final URL — Ads needs its own URL with auto-tagging (gclid) so paid and Maps bookings stay separate.'}</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => gbpLink && navigator.clipboard?.writeText(gbpLink)} style={ui.primaryBtn} disabled={!gbpLink}>
            {lang === 'vi' ? 'Copy link /gbp cho Google' : 'Copy /gbp Google link'}
          </button>
          <a href="https://business.google.com/" target="_blank" rel="noreferrer" style={{ ...ui.primaryBtn, textDecoration: 'none', background: 'transparent', border: '1px solid #475569', color: '#e2e8f0' }}>
            {lang === 'vi' ? 'Mở Google Business Profile ↗' : 'Open Google Business Profile ↗'}
          </a>
        </div>
        <p style={{ color: '#64748b', fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
          {lang === 'vi'
            ? '⚠️ Nếu tiệm đang dùng provider khác (Booksy/Vagaro…), Google có thể ưu tiên cái đó — gỡ liên kết provider cũ để link Lumio hiện. Hồ sơ Google phải đã được xác minh (verified).'
            : '⚠️ If the salon already uses another provider (Booksy/Vagaro…), Google may prefer it — remove the old provider link so the Lumio link shows. The Google profile must be verified.'}
        </p>
      </div>

      {/* Option 2: WordPress plugin via API key */}
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('in.wpTitle')}</h2>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        {t('in.wpDesc')}
      </p>

      {newKey && (
        <div
          style={{
            ...ui.card,
            border: '1px solid #22c55e',
            marginBottom: 16,
          }}
        >
          <strong style={{ color: '#22c55e' }}>{t('in.copyNow')}</strong>
          <p style={{ color: '#cbd5e1', fontSize: 13, margin: '6px 0' }}>
            {t('in.onlyOnce')}
          </p>
          <code
            style={{
              display: 'block',
              padding: '10px 12px',
              background: '#0f172a',
              borderRadius: 8,
              wordBreak: 'break-all',
              fontSize: 14,
            }}
          >
            {newKey}
          </code>
          <button
            onClick={() => navigator.clipboard?.writeText(newKey)}
            style={{ ...ui.primaryBtn, marginTop: 10 }}
          >
            {t('in.copyClipboard')}
          </button>
        </div>
      )}

      <form onSubmit={create} style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <label>
            <span style={ui.label}>{t('in.keyName')}</span>
            <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('in.keyNamePh')} />
          </label>
          <label>
            <span style={ui.label}>{t('in.siteUrl')}</span>
            <input style={ui.input} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://mysalon.com" />
          </label>
        </div>
        <button type="submit" disabled={creating} style={{ ...ui.primaryBtn, marginTop: 14 }}>
          {creating ? t('in.generating') : t('in.generate')}
        </button>
      </form>

      {loading ? (
        <p style={{ color: '#94a3b8' }}>{t('in.loading')}</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('in.colName')}</th>
                <th style={ui.th}>{t('in.colKey')}</th>
                <th style={ui.th}>{t('in.colStatus')}</th>
                <th style={ui.th}>{t('in.colLastUsed')}</th>
                <th style={ui.th}>{t('in.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={5}>
                    {t('in.empty')}
                  </td>
                </tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{k.name ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {k.keyPrefix}…{k.lastFour}
                  </td>
                  <td style={ui.td}>
                    <span style={{ color: k.status === 'ACTIVE' ? '#22c55e' : '#ef4444' }}>
                      {k.status}
                    </span>
                  </td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-US') : t('in.never')}
                  </td>
                  <td style={ui.td}>
                    {k.status === 'ACTIVE' && (
                      <button onClick={() => revoke(k.id)} style={ui.dangerBtn}>
                        {t('in.revoke')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ fontSize: 18, margin: '30px 0 4px' }}>📊 Google Analytics & Tag Manager</h2>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 12px', lineHeight: 1.6, maxWidth: 680 }}>
        {lang === 'vi'
          ? 'Dùng CÙNG một GA4/GTM với website của tiệm — mọi nguồn sẽ gom về một báo cáo. Cách hệ thống liên kết, không bao giờ đếm trùng: (1) Form NHÚNG trên website → sự kiện đặt lịch được đẩy lên GTM/GA4 CỦA WEBSITE, tính đúng phiên quảng cáo; (2) Khách mở TRỰC TIẾP trang đặt lịch (Google Maps, link bio, ads trỏ thẳng) → trang tự đo bằng ID dán ở đây, kèm nguồn (google/gbp, facebook/cpc…). Trong GA4 xem: Engagement → Events → booking_completed, thêm chiều “Session source/medium” là biết khách đặt từ đâu nhiều nhất.'
          : 'Use the SAME GA4/GTM as the salon website — every source lands in one report. How it links without double-counting: (1) the EMBEDDED form forwards booking events to the WEBSITE’s own GTM/GA4, credited to the ad session; (2) customers opening the booking page DIRECTLY (Google Maps, bio links, ads to the link) are measured here with their source (google/gbp, facebook/cpc…). In GA4: Engagement → Events → booking_completed, add “Session source/medium” to see where bookings come from.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 640 }}>
        <label style={{ fontSize: 13, color: '#cbd5e1' }}>GA4 Measurement ID
          <input style={{ ...ui.input, marginTop: 4 }} value={ga4Id} onChange={(e) => setGa4Id(e.target.value)} placeholder="G-XXXXXXXXXX" />
        </label>
        <label style={{ fontSize: 13, color: '#cbd5e1' }}>GTM Container ID
          <input style={{ ...ui.input, marginTop: 4 }} value={gtmId} onChange={(e) => setGtmId(e.target.value)} placeholder="GTM-XXXXXXX" />
        </label>
        <label style={{ fontSize: 13, color: '#cbd5e1' }}>{lang === 'vi' ? 'Phương thức đo (chỉ MỘT chạy)' : 'Tracking method (only ONE runs)'}
          <select style={{ ...ui.input, marginTop: 4 }} value={anMode} onChange={(e) => setAnMode(e.target.value)}>
            <option value="">{lang === 'vi' ? 'Tự động — ưu tiên GTM, không có thì GA4' : 'Auto — GTM if set, else GA4'}</option>
            <option value="gtm">{lang === 'vi' ? 'Chỉ GTM (container tự chứa Google Tag)' : 'GTM only (container holds the Google Tag)'}</option>
            <option value="ga4">{lang === 'vi' ? 'Chỉ GA4 trực tiếp' : 'GA4 direct only'}</option>
            <option value="none">{lang === 'vi' ? 'Tắt đo lường' : 'Tracking off'}</option>
          </select>
        </label>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0', maxWidth: 640, lineHeight: 1.5 }}>
        {lang === 'vi'
          ? 'Vì sao chỉ một? GTM thường đã chứa Google Tag (GA4) bên trong — nếu nạp thêm GA4 trực tiếp, mỗi lượt xem và mỗi đặt lịch sẽ bị đếm 2 lần. Hệ thống chỉ nạp đúng một phương thức và bắn đúng một sự kiện booking_completed cho mỗi đơn.'
          : 'Why only one? A GTM container usually already includes the Google Tag (GA4) — loading GA4 directly as well would double-count every pageview and booking. The system loads exactly one method and fires exactly one booking_completed per order.'}
      </p>
      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', marginTop: 12, maxWidth: 640 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 4 }}>{lang === 'vi' ? '⚡ Tiệm mới? Import mẫu GTM dựng sẵn (2 phút)' : '⚡ New salon? Import the ready-made GTM template (2 min)'}</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
          {lang === 'vi'
            ? 'Tải file mẫu → GTM Admin → Import Container → chọn file → Merge → sửa MỘT biến "CONST - GA4 Measurement ID" thành G-ID của tiệm → Publish. Có sẵn: Google Tag nền, purchase (booking) và click_call — khỏi tạo tay từng biến/trigger/tag.'
            : 'Download → GTM Admin → Import Container → choose file → Merge → edit ONE variable "CONST - GA4 Measurement ID" to the salon\'s G-ID → Publish. Includes the base Google Tag, purchase (booking) and click_call — no manual variables/triggers/tags.'}
        </div>
        <a href={`${WEB_BASE}/downloads/lumio-gtm-container.json`} download style={{ ...ui.primaryBtn, display: 'inline-block', textDecoration: 'none', marginTop: 8, fontSize: 13 }}>
          {lang === 'vi' ? '⬇ Tải mẫu GTM container' : '⬇ Download GTM container template'}
        </a>
      </div>
      {anMsg && <div style={{ color: '#34d399', fontSize: 13, marginTop: 8 }}>{anMsg}</div>}
      <button onClick={saveAnalytics} disabled={savingAn} style={{ ...ui.primaryBtn, marginTop: 12 }}>
        {savingAn ? '…' : (lang === 'vi' ? 'Lưu Analytics' : 'Save analytics')}
      </button>

    </section>
  );
}
