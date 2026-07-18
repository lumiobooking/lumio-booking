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
        apiFetch<{ analytics?: { ga4Id?: string; gtmId?: string } }>('/settings', { token }).catch(() => null),
      ]);
      setKeys(keyList);
      setSlug(tenant?.slug ?? null);
      setGa4Id(settings?.analytics?.ga4Id ?? '');
      setGtmId(settings?.analytics?.gtmId ?? '');
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

  useEffect(() => {
    load();
  }, [load]);

  async function saveAnalytics() {
    setSavingAn(true); setAnMsg(null); setError(null);
    try {
      await apiFetch('/settings/analytics', { method: 'PATCH', token, body: { ga4Id: ga4Id.trim(), gtmId: gtmId.trim() } });
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
            ? 'Dán link đặt lịch bên trên vào Google Business Profile của tiệm để khách đặt ngay từ Google Maps/Search. Google duyệt ~24–48h.'
            : 'Paste your booking link (above) into the salon\'s Google Business Profile so customers book straight from Google Maps/Search. Google reviews it in ~24–48h.'}
        </p>
        <ol style={{ color: '#cbd5e1', fontSize: 13.5, lineHeight: 1.9, margin: '8px 0 12px', paddingLeft: 20 }}>
          <li>{lang === 'vi' ? 'Mở Google Business Profile của tiệm (nút dưới), đăng nhập tài khoản sở hữu hồ sơ.' : 'Open the salon\'s Google Business Profile (button below); sign in with the owning account.'}</li>
          <li>{lang === 'vi' ? 'Edit profile → Bookings / Appointment links.' : 'Edit profile → Bookings / Appointment links.'}</li>
          <li>{lang === 'vi' ? 'Add appointment link → dán link Lumio ở trên → Save.' : 'Add appointment link → paste the Lumio link above → Save.'}</li>
          <li>{lang === 'vi' ? 'Chờ 24–48h Google duyệt → nút “Book online” hiện ra.' : 'Wait 24–48h for Google to approve → the “Book online” button appears.'}</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => bookingLink && navigator.clipboard?.writeText(bookingLink)} style={ui.primaryBtn} disabled={!bookingLink}>
            {lang === 'vi' ? 'Copy link đặt lịch' : 'Copy booking link'}
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
          ? 'Dán ID để đo lường đặt lịch RIÊNG cho tiệm này — trang đặt lịch chỉ nạp GA4/GTM của bạn, không lẫn với tiệm khác. Khi khách đặt xong, hệ thống tự bắn sự kiện “booking_completed” (GA4: purchase) kèm mã đơn, giá trị và tiền tệ để làm chuyển đổi cho quảng cáo.'
          : 'Paste your IDs to measure bookings for THIS salon only — the booking page loads just your GA4/GTM, never mixed with other salons. On each completed booking we fire “booking_completed” (GA4: purchase) with order id, value and currency for your ad conversions.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, maxWidth: 640 }}>
        <label style={{ fontSize: 13, color: '#cbd5e1' }}>GA4 Measurement ID
          <input style={{ ...ui.input, marginTop: 4 }} value={ga4Id} onChange={(e) => setGa4Id(e.target.value)} placeholder="G-XXXXXXXXXX" />
        </label>
        <label style={{ fontSize: 13, color: '#cbd5e1' }}>GTM Container ID
          <input style={{ ...ui.input, marginTop: 4 }} value={gtmId} onChange={(e) => setGtmId(e.target.value)} placeholder="GTM-XXXXXXX" />
        </label>
      </div>
      {anMsg && <div style={{ color: '#34d399', fontSize: 13, marginTop: 8 }}>{anMsg}</div>}
      <button onClick={saveAnalytics} disabled={savingAn} style={{ ...ui.primaryBtn, marginTop: 12 }}>
        {savingAn ? '…' : (lang === 'vi' ? 'Lưu Analytics' : 'Save analytics')}
      </button>

    </section>
  );
}
