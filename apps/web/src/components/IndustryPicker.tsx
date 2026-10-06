'use client';

/**
 * NGÀNH NGHỀ — the owner tells Lumio what kind of business this is.
 *
 * Nail, Mi, Tóc, Spa, Massage, Nha khoa, Nhà hàng, Quán ăn, Cà phê, Bất động
 * sản or Dịch vụ khác. It changes the words on every screen (thợ → bác sĩ,
 * tiệm → phòng khám, lịch hẹn → đặt bàn…) and drops screens that do not fit
 * (the turn board for a clinic). Nothing in the data changes.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { ui } from '../lib/ui';
import { INDUSTRY_GROUPS, INDUSTRY_OPTIONS, industryText, isIndustryKey, setUiIndustry, type IndustryKey } from '../lib/ui-industry';

export function IndustryPicker() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [cur, setCur] = useState<IndustryKey | null>(null);
  const [pick, setPick] = useState<IndustryKey>('NAIL');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ industry: string }>('/settings/industry', { token })
      .then((r) => { if (isIndustryKey(r?.industry)) { setCur(r.industry); setPick(r.industry); } })
      .catch(() => setCur(null));
  }, [token]);

  async function save() {
    if (!token || busy || pick === cur) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/settings/industry', { method: 'PATCH', token, body: { industry: pick } });
      setUiIndustry(pick);
      // The menu and every cached label follow on a fresh load.
      window.location.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); setBusy(false); }
  }

  if (cur === null) return null; // not the owner, or not loaded
  // The same three sentences, as they would read after the change.
  const sample = (k: IndustryKey) => [vi ? 'Thợ rảnh' : 'Free techs', vi ? 'Lịch hẹn' : 'Appointments', vi ? 'Khách hàng của tiệm' : 'Salon customers']
    .map((s) => industryText(s, k)).join(' · ');

  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>🏷️ {vi ? 'Ngành nghề' : 'Line of business'}</div>
      <p style={{ fontSize: 12.5, color: 'var(--c94a3b8)', margin: '4px 0 10px', lineHeight: 1.5 }}>
        {vi
          ? 'Đổi thuật ngữ trên toàn bộ màn hình và ẩn các mục không hợp ngành. Dữ liệu (lịch hẹn, khách, dịch vụ) giữ nguyên.'
          : 'Changes the words on every screen and hides screens that do not fit. Your data (bookings, clients, services) stays as it is.'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={pick} onChange={(e) => setPick(e.target.value as IndustryKey)} style={{ ...ui.input, width: 'auto', minWidth: 200 }}>
          {INDUSTRY_GROUPS.map((g) => (
            <optgroup key={g.id} label={vi ? g.vi : g.en}>
              {INDUSTRY_OPTIONS.filter((o) => o.group === g.id).map((o) => <option key={o.key} value={o.key}>{vi ? o.vi : o.en}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={save} disabled={busy || pick === cur} style={{ ...ui.primaryBtn, opacity: busy || pick === cur ? 0.5 : 1 }}>
          {busy ? '…' : (vi ? 'Lưu ngành nghề' : 'Save')}
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--c64748b)', marginTop: 8 }}>{vi ? 'Ví dụ: ' : 'e.g. '}{sample(pick)}</div>
      {err && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)', marginTop: 8 }}>{err}</div>}
    </div>
  );
}
