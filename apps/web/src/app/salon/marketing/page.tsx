'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Msg { enabled: boolean; email: boolean; sms: boolean; subject: string; body: string; smsBody: string }
interface Lapsed extends Msg { daysSince: number }
interface CampaignSettings { sendHour: number; winBack: Lapsed; reactivation: Lapsed; birthday: Msg }
type Stats = { winBack: number; reactivation: number; birthday: number };
type CampKey = 'winBack' | 'reactivation' | 'birthday';

export default function MarketingPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState<CampaignSettings | null>(null);
  const [stats, setStats] = useState<Stats>({ winBack: 0, reactivation: 0, birthday: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [s, st] = await Promise.all([
        apiFetch<CampaignSettings>('/campaigns/settings', { token }),
        apiFetch<Stats>('/campaigns/stats', { token }).catch(() => ({ winBack: 0, reactivation: 0, birthday: 0 })),
      ]);
      setF(s); setStats(st);
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('mk.loadFail', lang));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!f) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      await apiFetch('/campaigns/settings', { method: 'PATCH', token, body: f });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function runNow() {
    setRunning(true); setError(null);
    try {
      const r = await apiFetch<Stats>('/campaigns/run-now', { method: 'POST', token });
      const n = (r.winBack || 0) + (r.reactivation || 0) + (r.birthday || 0);
      alert(t('mk.runResult').replace('{n}', String(n)));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setRunning(false); }
  }

  if (loading || !f) {
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('mk.title')}</h1><p style={{ color: '#94a3b8' }}>{t('mk.loading')}</p></section>;
  }

  const patchCamp = (key: CampKey, patch: Partial<Lapsed>) => setF({ ...f, [key]: { ...f[key], ...patch } });

  return (
    <section style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('mk.title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 14 }}>{t('mk.subtitle')}</p>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#94a3b8', marginBottom: 16 }}>
        🔒 {t('mk.consentNote')}
      </div>

      <div style={{ ...ui.card, display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
        <label>
          <span style={ui.label}>{t('mk.sendHour')}</span>
          <select style={{ ...ui.input, width: 140 }} value={f.sendHour} onChange={(e) => setF({ ...f, sendHour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </label>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('mk.saved')}</span>}
          <button onClick={runNow} disabled={running} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>{running ? t('mk.running') : t('mk.runNow')}</button>
          <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? t('mk.saving') : t('mk.save')}</button>
        </div>
      </div>

      <CampaignCard t={t} title={t('mk.winBack')} desc={t('mk.winBackDesc')} sent={stats.winBack} hasDays camp={f.winBack} onChange={(p) => patchCamp('winBack', p)} />
      <CampaignCard t={t} title={t('mk.reactivation')} desc={t('mk.reactivationDesc')} sent={stats.reactivation} hasDays camp={f.reactivation} onChange={(p) => patchCamp('reactivation', p)} />
      <CampaignCard t={t} title={t('mk.birthday')} desc={t('mk.birthdayDesc')} sent={stats.birthday} camp={f.birthday} onChange={(p) => patchCamp('birthday', p)} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
        {saved && <span style={{ color: '#22c55e', fontSize: 13, alignSelf: 'center' }}>{t('mk.saved')}</span>}
        <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? t('mk.saving') : t('mk.save')}</button>
      </div>
    </section>
  );
}

function CampaignCard({ t, title, desc, sent, camp, hasDays, onChange }: {
  t: (k: string) => string; title: string; desc: string; sent: number; camp: Lapsed | Msg; hasDays?: boolean; onChange: (p: Partial<Lapsed>) => void;
}) {
  const c = camp as Lapsed;
  return (
    <div style={{ ...ui.card, marginBottom: 16, opacity: camp.enabled ? 1 : 0.85 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: '0 0 2px' }}>{title}</h2>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>{desc}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{sent} {t('mk.sentBadge')}</span>
          <Toggle on={camp.enabled} onChange={(v) => onChange({ enabled: v })} label={t('mk.enable')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', margin: '14px 0' }}>
        <Check label={t('mk.email')} checked={camp.email} onChange={(v) => onChange({ email: v })} />
        <Check label={t('mk.sms')} checked={camp.sms} onChange={(v) => onChange({ sms: v })} />
        {hasDays && (
          <label>
            <span style={ui.label}>{t('mk.daysSince')}</span>
            <input style={{ ...ui.input, width: 110 }} type="number" min={1} max={3650} value={c.daysSince} onChange={(e) => onChange({ daysSince: Math.max(1, Number(e.target.value)) })} />
          </label>
        )}
      </div>

      {camp.email && (
        <>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={ui.label}>{t('mk.subject')}</span>
            <input style={ui.input} value={camp.subject} onChange={(e) => onChange({ subject: e.target.value })} />
          </label>
          <label style={{ display: 'block', marginBottom: 10 }}>
            <span style={ui.label}>{t('mk.body')}</span>
            <textarea style={{ ...ui.input, minHeight: 110, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} value={camp.body} onChange={(e) => onChange({ body: e.target.value })} />
          </label>
        </>
      )}
      {camp.sms && (
        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={ui.label}>{t('mk.smsBody')}</span>
          <textarea style={{ ...ui.input, minHeight: 60, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} value={camp.smsBody} onChange={(e) => onChange({ smsBody: e.target.value })} />
        </label>
      )}
      <p style={{ color: '#64748b', fontSize: 11.5, margin: '2px 0 0' }}>{t('mk.placeholders')}</p>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: '#e2e8f0', fontSize: 13, padding: 0 }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : '#475569', position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white' }} />
      </span>
      {label}
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${checked ? '#6366f1' : '#334155'}`, background: checked ? '#312e81' : '#1e293b', color: '#e2e8f0', fontSize: 13 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? '#a5b4fc' : '#64748b'}`, background: checked ? '#6366f1' : 'transparent', display: 'grid', placeItems: 'center', fontSize: 11, color: '#fff' }}>{checked ? '✓' : ''}</span>
      {label}
    </button>
  );
}
