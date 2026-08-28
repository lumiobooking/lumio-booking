'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Offer { enabled: boolean; kind: 'percent' | 'amount' | 'gift'; value: number; gift: string; code: string; expiryDays: number }
interface Msg { enabled: boolean; email: boolean; sms: boolean; subject: string; body: string; smsBody: string; offer?: Offer }
interface Lapsed extends Msg { daysSince: number }
interface CampaignSettings { sendHour: number; winBack: Lapsed; reactivation: Lapsed; birthday: Msg }
type Stats = { winBack: number; reactivation: number; birthday: number };
type CampKey = 'winBack' | 'reactivation' | 'birthday';

export default function MarketingPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const adminEmail = user?.email;
  const [f, setF] = useState<CampaignSettings | null>(null);
  const [stats, setStats] = useState<Stats>({ winBack: 0, reactivation: 0, birthday: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [defaults, setDefaults] = useState<CampaignSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [s, dflt, st] = await Promise.all([
        apiFetch<CampaignSettings>('/campaigns/settings', { token }),
        apiFetch<CampaignSettings>('/campaigns/defaults', { token }).catch(() => null),
        apiFetch<Stats>('/campaigns/stats', { token }).catch(() => ({ winBack: 0, reactivation: 0, birthday: 0 })),
      ]);
      setF(s); setDefaults(dflt); setStats(st);
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
    return <section><h1 style={{ fontSize: 24, margin: 0 }}>{t('mk.title')}</h1><p style={{ color: 'var(--c94a3b8)' }}>{t('mk.loading')}</p></section>;
  }

  const patchCamp = (key: CampKey, patch: Partial<Lapsed>) => setF({ ...f, [key]: { ...f[key], ...patch } });

  return (
    <section style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('mk.title')}</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 14px', fontSize: 14 }}>{t('mk.subtitle')}</p>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: 'var(--c94a3b8)', marginBottom: 16 }}>
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
          <button onClick={runNow} disabled={running} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)' }}>{running ? t('mk.running') : t('mk.runNow')}</button>
          <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? t('mk.saving') : t('mk.save')}</button>
        </div>
      </div>

      <CampaignCard t={t} campKey="winBack" token={token} adminEmail={adminEmail} title={t('mk.winBack')} desc={t('mk.winBackDesc')} sent={stats.winBack} hasDays camp={f.winBack} suggested={defaults?.winBack} onChange={(p) => patchCamp('winBack', p)} />
      <CampaignCard t={t} campKey="reactivation" token={token} adminEmail={adminEmail} title={t('mk.reactivation')} desc={t('mk.reactivationDesc')} sent={stats.reactivation} hasDays camp={f.reactivation} suggested={defaults?.reactivation} onChange={(p) => patchCamp('reactivation', p)} />
      <CampaignCard t={t} campKey="birthday" token={token} adminEmail={adminEmail} title={t('mk.birthday')} desc={t('mk.birthdayDesc')} sent={stats.birthday} camp={f.birthday} suggested={defaults?.birthday} onChange={(p) => patchCamp('birthday', p)} />

      <ReferralSection token={token} t={t} />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
        {saved && <span style={{ color: '#22c55e', fontSize: 13, alignSelf: 'center' }}>{t('mk.saved')}</span>}
        <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? t('mk.saving') : t('mk.save')}</button>
      </div>
    </section>
  );
}

function CampaignCard({ t, campKey, token, adminEmail, title, desc, sent, camp, hasDays, suggested, onChange }: {
  t: (k: string) => string; campKey: CampKey; token: string | null; adminEmail?: string; title: string; desc: string; sent: number; camp: Lapsed | Msg; hasDays?: boolean; suggested?: Msg; onChange: (p: Partial<Lapsed>) => void;
}) {
  const c = camp as Lapsed;
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    if (!adminEmail) { alert(t('mk.testNoEmail')); return; }
    setTesting(true);
    try {
      const r = await apiFetch<{ email: string; sms: string }>('/campaigns/test', { method: 'POST', token, body: { campaign: campKey, email: adminEmail } });
      const ok = r.email === 'sent';
      alert(ok ? t('mk.testOk').replace('{email}', adminEmail) : t('mk.testErr').replace('{msg}', r.email.replace(/^error:\s*/, '')));
    } catch (e) { alert(e instanceof Error ? e.message : 'Failed'); }
    finally { setTesting(false); }
  }
  return (
    <div style={{ ...ui.card, marginBottom: 16, opacity: camp.enabled ? 1 : 0.85 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: '0 0 2px' }}>{title}</h2>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: 0 }}>{desc}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{sent} {t('mk.sentBadge')}</span>
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

      <OfferEditor
        offer={camp.offer}
        t={t}
        onChange={(patch) => onChange({ offer: { ...(camp.offer ?? { enabled: false, kind: 'percent', value: 15, gift: '', code: '', expiryDays: 21 }), ...patch } })}
      />

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
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '2px 0 0' }}>{t('mk.placeholders')}</p>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '2px 0 0' }}>{t('mk.offerVars')}</p>
      {camp.email && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--c1e293b)' }}>
          <button type="button" onClick={sendTest} disabled={testing} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer' }}>
            {testing ? t('mk.testSending') : `🧪 ${t('mk.testSend')}`}
          </button>
          {suggested && (
            <button
              type="button"
              onClick={() => { if (confirm(t('mk.useSuggestedConfirm'))) onChange({ subject: suggested.subject, body: suggested.body, smsBody: suggested.smsBody }); }}
              style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer' }}
            >
              ✍️ {t('mk.useSuggested')}
            </button>
          )}
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{adminEmail ? t('mk.testHint').replace('{email}', adminEmail) : t('mk.testNoEmail')}</span>
        </div>
      )}
    </div>
  );
}

interface RefSettings { enabled: boolean; referrerPoints: number; refereePoints: number; message: string }

function ReferralSection({ token, t }: { token: string | null; t: (k: string) => string }) {
  const [rf, setRf] = useState<RefSettings | null>(null);
  const [stat, setStat] = useState({ totalReferred: 0, rewarded: 0 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [s, st] = await Promise.all([
        apiFetch<RefSettings>('/referral/settings', { token }),
        apiFetch<{ totalReferred: number; rewarded: number }>('/referral/stats', { token }).catch(() => ({ totalReferred: 0, rewarded: 0 })),
      ]);
      setRf(s); setStat(st);
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!rf) return;
    setSaving(true); setSaved(false);
    try { await apiFetch('/referral/settings', { method: 'PATCH', token, body: rf }); setSaved(true); setTimeout(() => setSaved(false), 2500); }
    catch { /* ignore */ }
    finally { setSaving(false); }
  }

  if (!rf) return null;

  return (
    <div style={{ ...ui.card, marginBottom: 16, opacity: rf.enabled ? 1 : 0.85 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: '0 0 2px' }}>🎁 {t('rf.title')}</h2>
          <p style={{ color: 'var(--c94a3b8)', fontSize: 13, margin: 0 }}>{t('rf.desc')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{t('rf.stat').replace('{total}', String(stat.totalReferred)).replace('{rewarded}', String(stat.rewarded))}</span>
          <Toggle on={rf.enabled} onChange={(v) => setRf({ ...rf, enabled: v })} label={t('mk.enable')} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '14px 0' }}>
        <label>
          <span style={ui.label}>{t('rf.referrerPoints')}</span>
          <input style={{ ...ui.input, width: 130 }} type="number" min={0} value={rf.referrerPoints} onChange={(e) => setRf({ ...rf, referrerPoints: Math.max(0, Number(e.target.value)) })} />
        </label>
        <label>
          <span style={ui.label}>{t('rf.refereePoints')}</span>
          <input style={{ ...ui.input, width: 130 }} type="number" min={0} value={rf.refereePoints} onChange={(e) => setRf({ ...rf, refereePoints: Math.max(0, Number(e.target.value)) })} />
        </label>
      </div>
      <label style={{ display: 'block', marginBottom: 10 }}>
        <span style={ui.label}>{t('rf.message')}</span>
        <input style={ui.input} value={rf.message} onChange={(e) => setRf({ ...rf, message: e.target.value })} />
      </label>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '0 0 12px' }}>{t('rf.note')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? t('mk.saving') : t('mk.save')}</button>
        {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('mk.saved')}</span>}
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ce2e8f0)', fontSize: 13, padding: 0 }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : 'var(--c475569)', position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white' }} />
      </span>
      {label}
    </button>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${checked ? '#6366f1' : 'var(--c334155)'}`, background: checked ? 'var(--c312e81)' : 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 13 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? 'var(--ca5b4fc)' : 'var(--c64748b)'}`, background: checked ? '#6366f1' : 'transparent', display: 'grid', placeItems: 'center', fontSize: 11, color: '#fff' }}>{checked ? '✓' : ''}</span>
      {label}
    </button>
  );
}

/**
 * The incentive attached to one campaign. A campaign with no offer is only a
 * reminder; an offer promised in the copy with nothing configured here is worse
 * — the customer arrives asking for a gift the front desk knows nothing about.
 */
function OfferEditor({ offer, t, onChange }: { offer?: Offer; t: (k: string) => string; onChange: (p: Partial<Offer>) => void }) {
  const o: Offer = offer ?? { enabled: false, kind: 'percent', value: 15, gift: '', code: '', expiryDays: 21 };
  const kinds: { k: Offer['kind']; label: string }[] = [
    { k: 'percent', label: t('mk.offPercent') },
    { k: 'amount', label: t('mk.offAmount') },
    { k: 'gift', label: t('mk.offGift') },
  ];
  return (
    <div style={{ border: '1px solid var(--c1e293b)', borderRadius: 10, padding: '12px 14px', margin: '0 0 14px', background: 'var(--c0b1220)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ccbd5e1)' }}>🎁 {t('mk.offerTitle')}</span>
        <Toggle on={o.enabled} onChange={(v) => onChange({ enabled: v })} label={t('mk.enable')} />
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, margin: '4px 0 0', lineHeight: 1.5 }}>{t('mk.offerHelp')}</p>

      {o.enabled && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }}>
          <label>
            <span style={ui.label}>{t('mk.offerKind')}</span>
            <select style={{ ...ui.input, width: 170 }} value={o.kind} onChange={(e) => onChange({ kind: e.target.value as Offer['kind'] })}>
              {kinds.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
            </select>
          </label>

          {o.kind === 'percent' && (
            <label>
              <span style={ui.label}>{t('mk.offerPercent')}</span>
              <input style={{ ...ui.input, width: 90 }} type="number" min={1} max={90} value={o.value} onChange={(e) => onChange({ value: Math.max(0, Math.min(90, Number(e.target.value))) })} />
            </label>
          )}
          {o.kind === 'amount' && (
            <label>
              <span style={ui.label}>{t('mk.offerAmount')}</span>
              <input style={{ ...ui.input, width: 110 }} type="number" min={0} step="0.01" value={(o.value / 100).toString()} onChange={(e) => onChange({ value: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })} />
            </label>
          )}
          {o.kind === 'gift' && (
            <label style={{ flex: '1 1 260px' }}>
              <span style={ui.label}>{t('mk.offerGift')}</span>
              <input style={ui.input} value={o.gift} placeholder={t('mk.offerGiftPh')} onChange={(e) => onChange({ gift: e.target.value })} />
            </label>
          )}

          <label>
            <span style={ui.label}>{t('mk.offerCode')}</span>
            <input style={{ ...ui.input, width: 150, textTransform: 'uppercase' }} value={o.code} placeholder="WELCOME20" onChange={(e) => onChange({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 16) })} />
          </label>
          <label>
            <span style={ui.label}>{t('mk.offerExpiry')}</span>
            <input style={{ ...ui.input, width: 110 }} type="number" min={0} max={365} value={o.expiryDays} onChange={(e) => onChange({ expiryDays: Math.max(0, Math.min(365, Number(e.target.value))) })} />
          </label>
        </div>
      )}
    </div>
  );
}
