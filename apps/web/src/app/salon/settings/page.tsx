'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { TimezonePicker } from '../../../components/TimezonePicker';

interface DayHours { closed: boolean; openMinutes: number; closeMinutes: number; intervals?: { open: number; close: number }[] }
interface Booking {
  slotStepMinutes: number; minLeadHours: number; maxAdvanceDays: number;
  allowCustomerChooseStaff: boolean; assignmentMode: 'none' | 'auto'; groupPolicy?: 'strict' | 'flexible'; currency: string;
  currencySymbol: string; symbolPosition: 'before' | 'after'; priceDecimals: number; defaultPaymentMethod: 'online' | 'onsite';
  onlinePaymentEnabled: boolean; payLaterEnabled: boolean;
  businessHours: DayHours[]; daysOff: string[];
  /** Badge at the top of the public booking page: hours (default) / soonest / off. */
  soonestBar?: 'hours' | 'soonest' | 'off';
}
interface GatewayView { enabled: boolean; connected: boolean; apiKey: string }
interface SettingsData {
  company: { name: string; slug: string; contactEmail: string | null; contactPhone: string | null; timezone: string; address: string; website: string; country?: string };
  booking: Booking;
  branding: { accentColor: string; logoUrl: string; logoScale?: number; welcomeImageUrl?: string; seasonalTheme?: string; ratingMode?: string; ratingValue?: number; ratingCount?: number };
  rebooking?: { enabled: boolean; daysAfter: number; email: boolean; sms: boolean };
  gateways: Record<string, GatewayView>;
  notifications: {
    mailService: 'auto' | 'off' | 'smtp' | 'brevo' | 'gmail'; replyTo: string;
    senderName: string; senderEmail: string; adminEmail: string; adminPhone: string;
    emailCustomerOnBooking: boolean; emailAdminOnBooking: boolean;
    smsCustomerOnBooking: boolean; smsAdminOnBooking: boolean;
    emailSubjectCustomer: string; emailIntroCustomer: string;
    emailSubjectAdmin: string; emailIntroAdmin: string; emailFooter: string;
    smsCustomer: string; smsAdmin: string;
    smtp: { host: string; port: number; user: string; fromEmail: string; secure: 'ssl' | 'tls' | 'none'; connected: boolean };
    brevo: { senderEmail: string; senderName: string; connected: boolean };
    gmail: { clientId: string; senderEmail: string; connected: boolean };
    twilio: { accountSid: string; fromNumber: string; connected: boolean };
    esms?: { apiKey: string; brandname: string; oaid?: string; znsBookingTempId?: string; znsReminderTempId?: string; connected: boolean };
  };
  pos?: { taxRatePercent: number; cardSurchargePercent?: number; cardSurchargeEnabled?: boolean; receiptFooter: string; primaryCardGateway: string; transferInstructions: string; transferQrUrl: string; tipsEnabled?: boolean; resolvedPaymentMethods?: string[]; paymentDetails?: Record<string, { instructions?: string; qrUrl?: string }> };
  loyalty?: { enabled: boolean; earnPointsPerDollar: number; redeemCentsPerPoint: number; minRedeemPoints: number };
  reminders?: { enabled: boolean; hoursBefore1: number; hoursBefore2: number; channelEmail: boolean; channelSms: boolean };
  deposit?: { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number; scope: 'all' | 'new' | 'repeat_noshow'; noShowThreshold: number };
  gmailRedirectUri?: string;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'VND', 'JPY', 'SGD'];
// Most popular US/Canada card gateways. apiKey = public identifier; secret = private key.
const GATEWAYS = [
  { id: 'helcim', name: 'Helcim', desc: 'One account for online + Smart Terminal — recommended', apiLabel: 'Account ID (optional)', secretLabel: 'API token' },
  { id: 'stripe', name: 'Stripe', desc: 'Cards, Apple Pay & Google Pay, Tap to Pay — most popular', apiLabel: 'Publishable key', secretLabel: 'Secret key' },
  { id: 'square', name: 'Square', desc: 'Cards & in-store POS terminals', apiLabel: 'Application / Location ID', secretLabel: 'Access token' },
  { id: 'clover', name: 'Clover', desc: 'Popular all-in-one salon terminals', apiLabel: 'Merchant ID', secretLabel: 'API token' },
  { id: 'authorizenet', name: 'Authorize.Net', desc: 'Widely used US card gateway', apiLabel: 'API Login ID', secretLabel: 'Transaction key' },
  { id: 'paypal', name: 'PayPal', desc: 'PayPal balance & cards', apiLabel: 'Client ID', secretLabel: 'Secret' },
  { id: 'sumup', name: 'SumUp', desc: 'Low-cost card reader for small salons', apiLabel: 'Merchant code', secretLabel: 'API key' },
];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const minToHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

const SECTIONS = [
  { id: 'company', label: 'Company', icon: '🏢', desc: 'Salon identity & contact' },
  { id: 'hours', label: 'Business hours', icon: '🕒', desc: 'Open / close per day' },
  { id: 'daysoff', label: 'Days off', icon: '📅', desc: 'Holidays & closures' },
  { id: 'rules', label: 'Booking rules', icon: '⚙️', desc: 'Slots & limits' },
  { id: 'payments', label: 'Payments', icon: '💳', desc: 'Currency & methods' },
  { id: 'notifications', label: 'Notifications', icon: '🔔', desc: 'Email & SMS alerts' },
  { id: 'reminders', label: 'Reminders', icon: '⏰', desc: 'Auto no-show reminders' },
  { id: 'deposit', label: 'Deposits', icon: '💰', desc: 'Hold slots / no-show' },
  { id: 'branding', label: 'Branding', icon: '🎨', desc: 'Colors & logo' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<SectionId>('company');
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setData(await apiFetch<SettingsData>('/settings', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load settings'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function save(path: string, body: unknown, label: string) {
    setError(null); setSavedMsg(null);
    try {
      const updated = await apiFetch<SettingsData>(`/settings/${path}`, { method: 'PATCH', token, body });
      setData(updated);
      void label;
      setSavedMsg(t('se.savedToast'));
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
  }

  if (loading) return <section><h1 style={{ fontSize: 24 }}>{t('se.title')}</h1><p style={{ color: 'var(--c94a3b8)' }}>{t('se.loading')}</p></section>;
  if (!data) {
    return (
      <section>
        <h1 style={{ fontSize: 24 }}>{t('se.title')}</h1>
        {error && <div style={ui.banner}>{error}</div>}
        <p style={{ color: 'var(--c94a3b8)' }}>{t('se.loadFail')}</p>
      </section>
    );
  }

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>{t('se.title')}</h1>
      {error && <div style={ui.banner}>{error}</div>}
      {savedMsg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{savedMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr', gap: isMobile ? 14 : 20, alignItems: 'start' }}>
        {/* Settings sub-nav: scrollable row on mobile, sidebar on desktop */}
        <nav style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 8 : 4, position: isMobile ? 'static' : 'sticky', top: 0, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
          {SECTIONS.map((s) => {
            const active = tab === s.id;
            return (
              <button key={s.id} onClick={() => setTab(s.id)}
                style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                  border: '1px solid ' + (active ? '#6366f1' : 'var(--c334155)'), background: active ? 'var(--c312e81)' : 'var(--c1e293b)', color: 'var(--ce2e8f0)' }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t(`se.sec.${s.id}`)}</div>
                  <div style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{t(`se.secD.${s.id}`)}</div>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Active section */}
        <div style={{ maxWidth: 620 }}>
          {tab === 'company' && <CompanySection data={data} onSave={save} />}
          {tab === 'hours' && <HoursSection data={data} onSave={save} />}
          {tab === 'daysoff' && <DaysOffSection data={data} onSave={save} />}
          {tab === 'rules' && <RulesSection data={data} onSave={save} />}
          {tab === 'payments' && <PaymentsSection data={data} onSave={save} />}
          {tab === 'notifications' && <NotificationsSection data={data} onSave={save} />}
          {tab === 'reminders' && <><RemindersSection data={data} onSave={save} /><RebookingCard data={data} onSave={save} /></>}
          {tab === 'deposit' && <DepositSection data={data} onSave={save} />}
          {tab === 'branding' && <BrandingSection data={data} onSave={save} />}
        </div>
      </div>
    </section>
  );
}

type SaveFn = (path: string, body: unknown, label: string) => void;

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={ui.card}>
      <h2 style={{ fontSize: 17, margin: '0 0 2px' }}>{title}</h2>
      {desc && <p style={{ color: 'var(--c94a3b8)', margin: '0 0 14px', fontSize: 13 }}>{desc}</p>}
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // minHeight keeps 1-line and 2-line labels the same height so the inputs in a
  // row stay aligned (e.g. the long "Timezone…" label no longer pushes its box down).
  return <label style={{ display: 'block' }}><span style={{ ...ui.label, minHeight: 30, display: 'block' }}>{label}</span>{children}</label>;
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} type="button"
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--ce2e8f0)', fontSize: 14, padding: '7px 0', textAlign: 'left' }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : 'var(--c475569)', position: 'relative', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: 'white' }} />
      </span>
      {label}
    </button>
  );
}

/** Collapsible sub-section so a long settings card stays short by default. */
function Panel({ title, badge, hint, defaultOpen = false, children }: {
  title: string; badge?: { text: string; color: string } | null; hint?: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 10, border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ color: 'var(--c64748b)', fontSize: 11, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▶</span>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{title}</span>
        {badge && <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 999, padding: '1px 8px' }}>{badge.text}</span>}
        {hint && !open && <span style={{ marginLeft: 'auto', color: 'var(--c64748b)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}>{hint}</span>}
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

/**
 * What a country implies. Picking one should carry the settings that always
 * travel with it rather than leaving the salon to hunt for three more fields —
 * and getting any of them wrong is expensive: the wrong timezone books people
 * at the wrong hour, the wrong currency quotes the wrong price.
 */
const COUNTRY_PRESETS: Record<string, { timezone: string; currency: string; decimals: number; symbol: string; position: 'before' | 'after'; lang: 'en' | 'vi'; tips: boolean }> = {
  US: { timezone: 'America/Los_Angeles', currency: 'USD', decimals: 2, symbol: '$', position: 'before', lang: 'en', tips: true },
  CA: { timezone: 'America/Toronto', currency: 'CAD', decimals: 2, symbol: '$', position: 'before', lang: 'en', tips: true },
  VN: { timezone: 'Asia/Ho_Chi_Minh', currency: 'VND', decimals: 0, symbol: '₫', position: 'after', lang: 'vi', tips: false },
};

function CompanySection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang, setLang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState(data.company);
  const [applied, setApplied] = useState(false);

  // Choosing a country fills in what comes with it, in the form, where the
  // salon can see it and change it before saving. Nothing is written behind
  // their back — a silent timezone change would move every existing booking.
  function pickCountry(code: string) {
    setF((prev) => ({ ...prev, country: code }));
    const preset = COUNTRY_PRESETS[code];
    if (!preset) { setApplied(false); return; }
    setF((prev) => ({ ...prev, country: code, timezone: preset.timezone }));
    setLang(preset.lang);
    onSave(
      'booking',
      { currency: preset.currency, currencySymbol: preset.symbol, symbolPosition: preset.position, priceDecimals: preset.decimals },
      'Currency',
    );
    // Tipping a nail tech is normal in North America and unusual in Vietnam.
    // This is a starting point, not a rule: the salon can switch it back on
    // under Payments, which is where every other till setting lives.
    onSave('pos', { tipsEnabled: preset.tips }, 'Tips');
    setApplied(true);
  }

  return (
    <Card title={t('se.co.title')} desc={t('se.co.desc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'start' }}>
        <Field label={t('se.co.name')}><input style={ui.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('se.co.tz')}><TimezonePicker value={f.timezone} onChange={(tz) => setF({ ...f, timezone: tz })} selectStyle={ui.input} /></Field>
        <Field label={t('se.co.email')}><input style={ui.input} value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label={t('se.co.phone')}><input style={ui.input} value={f.contactPhone ?? ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label={t('se.co.address')}><input style={ui.input} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t('se.co.website')}><input style={ui.input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
        {/* Country is what tells 0912 345 678 apart from a ten-digit US number,
            and it decides the money and date format. Left blank the salon keeps
            behaving exactly as it did, guessing from the timezone. */}
        <Field label={t('se.co.country')}>
          <select style={ui.input} value={f.country ?? ''} onChange={(e) => pickCountry(e.target.value)}>
            <option value="">{t('se.co.countryAuto')}</option>
            <option value="US">United States (+1)</option>
            <option value="CA">Canada (+1)</option>
            <option value="VN">Việt Nam (+84)</option>
          </select>
        </Field>
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 11.5, marginTop: 8 }}>{t('se.co.countryHint')}</p>
      {applied && (
        <p style={{ color: '#34d399', fontSize: 12, marginTop: 6 }}>✓ {t('se.co.countryApplied')}</p>
      )}
      <button
        style={{ ...ui.primaryBtn, marginTop: 16 }}
        onClick={() => onSave('company', { name: f.name, contactEmail: f.contactEmail, contactPhone: f.contactPhone, timezone: f.timezone, address: f.address, website: f.website, country: f.country ?? '' }, 'Company')}
      >
        {t('se.co.save')}
      </button>
    </Card>
  );
}

function HoursSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  // Normalize each day to an editable intervals list (derive from open/close when absent).
  const [hours, setHours] = useState<DayHours[]>(() =>
    data.booking.businessHours.map((h) => ({ ...h, intervals: h.intervals && h.intervals.length ? h.intervals : [{ open: h.openMinutes, close: h.closeMinutes }] })),
  );
  const setDay = (day: number, fn: (h: DayHours) => DayHours) => setHours((p) => p.map((h, i) => (i === day ? fn(h) : h)));
  const setIv = (day: number, idx: number, patch: Partial<{ open: number; close: number }>) =>
    setDay(day, (h) => ({ ...h, intervals: (h.intervals ?? []).map((iv, j) => (j === idx ? { ...iv, ...patch } : iv)) }));
  const addIv = (day: number) => setDay(day, (h) => {
    const list = h.intervals ?? [];
    const last = list[list.length - 1];
    const base = last ? { open: Math.min(1380, last.close + 60), close: Math.min(1440, last.close + 240) } : { open: 540, close: 1080 };
    return { ...h, intervals: [...list, base] };
  });
  const delIv = (day: number, idx: number) => setDay(day, (h) => ({ ...h, intervals: (h.intervals ?? []).filter((_, j) => j !== idx) }));
  const save = () => {
    const payload = hours.map((h) => {
      const ivs = (h.intervals ?? []).filter((iv) => iv.close > iv.open).sort((a, b) => a.open - b.open);
      if (!ivs.length) return { closed: h.closed, openMinutes: h.openMinutes, closeMinutes: h.closeMinutes };
      return { closed: h.closed, openMinutes: Math.min(...ivs.map((x) => x.open)), closeMinutes: Math.max(...ivs.map((x) => x.close)), intervals: ivs };
    });
    onSave('booking', { businessHours: payload }, 'Business hours');
  };
  return (
    <Card title={t('se.hr.title')} desc={t('se.hr.desc')}>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>{lang === 'vi' ? 'Nhà hàng tách ca? Bấm “+ Thêm ca” để mở nhiều khung giờ trong ngày (vd: trưa 10:30–14:30 và tối 16:30–20:30).' : 'Split shifts? Use “+ Add hours” to open more than one window a day (e.g. lunch 10:30–14:30 and dinner 16:30–20:30).'}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DAY_ORDER.map((day) => {
          const h = hours[day];
          const ivs = h.intervals ?? [];
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, borderTop: '1px solid var(--c1e293b)', paddingTop: 10 }}>
              <span style={{ width: 42, fontSize: 13, color: 'var(--ccbd5e1)', paddingTop: 8 }}>{DAY_LABEL[lang][day]}</span>
              <div style={{ paddingTop: 6 }}><Toggle on={!h.closed} onChange={(open) => setDay(day, (x) => ({ ...x, closed: !open }))} label="" /></div>
              {h.closed ? <span style={{ color: 'var(--c64748b)', fontSize: 13, paddingTop: 8 }}>{t('se.hr.closed')}</span> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  {ivs.map((iv, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input style={{ ...ui.input, width: 116 }} type="time" value={minToHm(iv.open)} onChange={(e) => setIv(day, idx, { open: hmToMin(e.target.value) })} />
                      <span style={{ color: 'var(--c64748b)' }}>–</span>
                      <input style={{ ...ui.input, width: 116 }} type="time" value={minToHm(iv.close)} onChange={(e) => setIv(day, idx, { close: hmToMin(e.target.value) })} />
                      {ivs.length > 1 && <button onClick={() => delIv(day, idx)} title={lang === 'vi' ? 'Xoá ca' : 'Remove'} style={{ background: 'none', border: '1px solid var(--c475569)', color: 'var(--c94a3b8)', borderRadius: 6, width: 26, height: 26, cursor: 'pointer', lineHeight: 1 }}>×</button>}
                    </div>
                  ))}
                  <button onClick={() => addIv(day)} style={{ alignSelf: 'flex-start', background: 'none', border: '1px dashed var(--c475569)', color: 'var(--c818cf8)', borderRadius: 8, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>+ {lang === 'vi' ? 'Thêm ca' : 'Add hours'}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={save}>{t('se.hr.save')}</button>
    </Card>
  );
}

function DaysOffSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [days, setDays] = useState<string[]>(data.booking.daysOff);
  const [newDay, setNewDay] = useState('');
  function add() { if (newDay && !days.includes(newDay)) { setDays([...days, newDay].sort()); setNewDay(''); } }
  return (
    <Card title={t('se.do.title')} desc={t('se.do.desc')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {days.length === 0 && <span style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('se.do.none')}</span>}
        {days.map((d) => (
          <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '4px 10px', fontSize: 13 }}>
            {d}
            <button onClick={() => setDays(days.filter((x) => x !== d))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input lang="en-US" style={{ ...ui.input, width: 200 }} type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
        <button style={{ ...ui.primaryBtn, padding: '9px 14px' }} onClick={add}>{t('se.do.add')}</button>
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', { daysOff: days }, 'Days off')}>{t('se.do.save')}</button>
    </Card>
  );
}

function RulesSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState(data.booking);
  return (
    <Card title={t('se.ru.title')} desc={t('se.ru.desc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Field label={t('se.ru.slotStep')}>
          <select style={ui.input} value={f.slotStepMinutes} onChange={(e) => setF({ ...f, slotStepMinutes: Number(e.target.value) })}>
            {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} {t('se.ru.min')}</option>)}
          </select>
        </Field>
        <Field label={t('se.ru.window')}>
          <input style={ui.input} type="number" min={1} max={365} value={f.maxAdvanceDays} onChange={(e) => setF({ ...f, maxAdvanceDays: Number(e.target.value) })} />
        </Field>
        <Field label={t('se.ru.minLead')}>
          <input style={ui.input} type="number" min={0} max={168} value={f.minLeadHours} onChange={(e) => setF({ ...f, minLeadHours: Number(e.target.value) })} />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Toggle on={f.allowCustomerChooseStaff} onChange={(v) => setF({ ...f, allowCustomerChooseStaff: v })} label={t('se.ru.chooseStaff')} />
      </div>

      {/* The badge at the top of the public booking page. Three states rather
          than on/off, because the old wording claimed a free slot the page has
          no appointment data to back — see apps/web/src/lib/opening-bar.ts. */}
      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>
        {lang === 'vi' ? 'Nhãn trên trang đặt lịch' : 'Badge on the booking page'}
      </div>
      <div style={{ marginTop: 8, padding: '12px 14px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)' }}>
        <select
          style={{ ...ui.input, maxWidth: 380 }}
          value={f.soonestBar ?? 'hours'}
          onChange={(e) => setF({ ...f, soonestBar: e.target.value as 'hours' | 'soonest' | 'off' })}
        >
          <option value="hours">{lang === 'vi' ? 'Hiện giờ mở cửa hôm nay' : 'Show today’s opening hours'}</option>
          <option value="soonest">{lang === 'vi' ? 'Hiện giờ trống gần nhất' : 'Show the next opening time'}</option>
          <option value="off">{lang === 'vi' ? 'Không hiện gì' : 'Show nothing'}</option>
        </select>
        <p style={{ color: 'var(--c64748b)', fontSize: 12.5, margin: '10px 0 0', lineHeight: 1.55 }}>
          {(f.soonestBar ?? 'hours') === 'hours'
            ? (lang === 'vi'
                ? 'Hiện đúng khung giờ bạn đã nhập ở mục Giờ mở cửa — ví dụ "Hôm nay mở cửa 9:00 AM – 5:00 PM". Không thể sai, và không tiết lộ tiệm đang vắng hay đông.'
                : 'Shows the hours you typed into Business hours — e.g. "Open today 9:00 AM – 5:00 PM". It cannot be wrong, and it says nothing about how busy you are.')
            : (f.soonestBar === 'soonest'
              ? (lang === 'vi'
                  ? 'CẢNH BÁO — nhãn này tính theo giờ mở cửa, KHÔNG theo lịch hẹn thật. Tiệm kín lịch cả ngày vẫn hiện "còn chỗ lúc 2:00 PM", và nó lấy dịch vụ ngắn nhất nên giờ đó có thể không vừa với dịch vụ khách chọn. Nó cũng cho khách biết tiệm đang trống.'
                  : 'WARNING — this is computed from opening hours, NOT from real appointments. A fully booked salon still advertises "next opening at 2:00 PM", and it quotes your shortest service so that time may not fit what the customer picks. It also tells every visitor you are quiet.')
              : (lang === 'vi'
                  ? 'Trang đặt lịch không hiện nhãn nào ở đầu trang.'
                  : 'No badge is shown at the top of the booking page.'))}
        </p>
      </div>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{t('se.ru.assignment')}</div>
      <div style={{ marginTop: 8, padding: '12px 14px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)' }}>
        <Toggle on={f.assignmentMode === 'auto'} onChange={(v) => setF({ ...f, assignmentMode: v ? 'auto' : 'none' })} label={t('se.ru.autoTitle')} />
        <p style={{ color: 'var(--c64748b)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
          {f.assignmentMode === 'auto'
            ? (lang === 'vi'
                ? 'ĐANG BẬT — hệ thống tự chọn thợ đang rảnh (xoay vòng công bằng theo kỹ năng, lịch làm và khối lượng việc) cho MỌI lịch đặt: website, Messenger và AI Hotline.'
                : 'ON — the system auto-picks an available technician (fair round-robin by skill, schedule and workload) for EVERY booking: website, Messenger and AI Hotline.')
            : (lang === 'vi'
                ? 'ĐANG TẮT — lịch mới để trống thợ (“Chưa xếp thợ”) cho tiệm tự xếp bằng tay.'
                : 'OFF — new bookings stay unassigned (“Unassigned”) for you to assign manually.')}
        </p>
      </div>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{t('se.ru.group')}</div>
      <div style={{ marginTop: 8, padding: '12px 14px', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c0f172a)' }}>
        <Toggle on={f.groupPolicy === 'flexible'} onChange={(v) => setF({ ...f, groupPolicy: v ? 'flexible' : 'strict' })} label={t('se.ru.groupFlex')} />
        <p style={{ color: 'var(--c64748b)', fontSize: 12.5, margin: '8px 0 0', lineHeight: 1.55 }}>
          {f.groupPolicy === 'flexible'
            ? (lang === 'vi'
                ? 'LINH ĐỘNG — nhóm đông hơn số thợ vẫn đặt được: khách được báo trước là tiệm phục vụ theo lượt, tiệm tự xếp thợ. Giữ doanh thu nhóm đông.'
                : 'FLEXIBLE — a party larger than your team can still book: customers are told upfront the salon serves them in turns, and you arrange the rotation. Keeps big-group revenue.')
            : (lang === 'vi'
                ? 'CHUẨN — chỉ mở giờ khi đủ mỗi khách một thợ rảnh đúng kỹ năng. Nhóm đông hơn số thợ sẽ được mời gọi tiệm hoặc vào danh sách chờ.'
                : 'STRICT — times open only when every guest can have their own qualified technician free. Bigger parties are asked to call or join the waitlist.')}
        </p>
      </div>

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', f, 'Booking rules')}>{t('se.ru.save')}</button>
    </Card>
  );
}

interface GatewayEdit { enabled: boolean; apiKey: string; secret: string }

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$', VND: '₫', JPY: '¥', SGD: '$' };
function previewPrice(amount: number, currency: string, symbol: string, position: string, decimals: number) {
  const s = symbol || SYMBOLS[currency] || currency + ' ';
  const n = amount.toFixed(decimals);
  return position === 'after' ? `${n}${s}` : `${s}${n}`;
}

function PaymentsSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  // The salon's own country, not the browser's language: an owner reading the
  // English labels in Hanoi still runs a Vietnamese salon.
  const isVN = (data.company?.country ?? '').toUpperCase() === 'VN';
  const t = (k: string) => tr(k, lang);
  const b = data.booking;
  const [currency, setCurrency] = useState(b.currency);
  const [symbol, setSymbol] = useState(b.currencySymbol);
  const [position, setPosition] = useState<'before' | 'after'>(b.symbolPosition ?? 'before');
  const [decimals, setDecimals] = useState(b.priceDecimals ?? 2);
  const [defaultMethod, setDefaultMethod] = useState<'online' | 'onsite'>(b.defaultPaymentMethod ?? 'onsite');
  const [onSite, setOnSite] = useState(b.payLaterEnabled);
  // Local editable gateways. secret starts blank (server never returns it).
  const [gw, setGw] = useState<Record<string, GatewayEdit>>(() => {
    const init: Record<string, GatewayEdit> = {};
    for (const g of GATEWAYS) {
      const v = data.gateways?.[g.id];
      init[g.id] = { enabled: v?.enabled ?? false, apiKey: v?.apiKey ?? '', secret: '' };
    }
    return init;
  });

  function upd(id: string, patch: Partial<GatewayEdit>) {
    setGw((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const enabledGw = GATEWAYS.filter((g) => gw[g.id]?.enabled);
  const connectedGw = GATEWAYS.filter((g) => data.gateways?.[g.id]?.connected);
  const cardChannelName = GATEWAYS.find((g) => g.id === data.pos?.primaryCardGateway)?.name;

  return (
    <Card title={t('se.pay.title')} desc={t('se.pay.desc')}>
      {/* --- Core: currency + price display (always visible, compact) --- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Field label={t('se.pay.currency')}>
          <select style={ui.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label={t('se.pay.customSymbol')}>
          <input style={ui.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={SYMBOLS[currency] ?? currency} />
        </Field>
        <Field label={t('se.pay.symbolPos')}>
          <select style={ui.input} value={position} onChange={(e) => setPosition(e.target.value as 'before' | 'after')}>
            <option value="before">{t('se.pay.before')} — {previewPrice(10, currency, symbol, 'before', decimals)}</option>
            <option value="after">{t('se.pay.after')} — {previewPrice(10, currency, symbol, 'after', decimals)}</option>
          </select>
        </Field>
        <Field label={t('se.pay.decimals')}>
          <select style={ui.input} value={decimals} onChange={(e) => setDecimals(Number(e.target.value))}>
            {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>
          {t('se.pay.preview')} <strong style={{ color: 'var(--ce2e8f0)' }}>{previewPrice(35, currency, symbol, position, decimals)}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Toggle on={onSite} onChange={setOnSite} label={t('se.pay.acceptOnsite')} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--c94a3b8)' }}>
            {t('se.pay.default')}
            <select
              style={{ ...ui.input, padding: '6px 8px', width: 'auto' }}
              value={connectedGw.length ? defaultMethod : 'onsite'}
              onChange={(e) => setDefaultMethod(e.target.value as 'online' | 'onsite')}
            >
              <option value="onsite">{t('se.pay.payAtSalon')}</option>
              {/* Only offer "Pay online" once a gateway is actually connected. */}
              {connectedGw.length > 0 && <option value="online">{t('se.pay.payOnline')}</option>}
            </select>
          </label>
        </div>
      </div>

      {/* --- Collapsible sub-sections keep the card short --- */}
      {/* Stripe, Square and PayPal do not serve Vietnamese salons, and this
          row sat directly above the section that IS their payment setup —
          reading, reasonably, as "the real payment settings are not for you".
          Hidden rather than disabled: an unavailable gateway is not a choice
          being withheld, it is a thing that does not exist here. */}
      {!isVN && (
      <Panel
        title={t('se.pay.gwTitle')}
        badge={connectedGw.length ? { text: t('se.pay.connectedN').replace('{n}', String(connectedGw.length)), color: '#22c55e' } : { text: t('se.pay.none'), color: 'var(--c64748b)' }}
        hint={connectedGw.length ? connectedGw.map((g) => g.name).join(', ') : t('se.pay.gwHintNone')}
      >
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 10px' }}>
          {t('se.pay.gwIntro')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GATEWAYS.map((g) => {
            const e = gw[g.id];
            const connected = data.gateways?.[g.id]?.connected;
            return (
              <div key={g.id} style={{ border: `1px solid ${e.enabled ? '#6366f1' : 'var(--c334155)'}`, borderRadius: 10, padding: 14, background: 'var(--c111827)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {g.name}{' '}
                      {connected && <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{t('se.pay.connected')}</span>}
                    </div>
                    <div style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{t(`se.gw.${g.id}`)}</div>
                  </div>
                  <Toggle on={e.enabled} onChange={(v) => upd(g.id, { enabled: v })} label="" />
                </div>
                {e.enabled && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 12 }}>
                    <Field label={g.apiLabel}>
                      <input style={ui.input} value={e.apiKey} onChange={(ev) => upd(g.id, { apiKey: ev.target.value })} placeholder={g.apiLabel} />
                    </Field>
                    <Field label={g.secretLabel}>
                      <input style={ui.input} type="password" value={e.secret} onChange={(ev) => upd(g.id, { secret: ev.target.value })} placeholder={connected ? t('se.pay.secretSaved') : g.secretLabel} />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--c334155)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ccbd5e1)' }}>{t('se.pay.primaryCard')}</div>
          <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px' }}>
            {t('se.pay.primaryCardDesc')}
          </p>
          <PrimaryCardChannel data={data} onSave={onSave} />
        </div>
      </Panel>
      )}

      <Panel
        title={lang === 'vi' ? 'Phụ phí thẻ (giá Cash / Card)' : 'Card surcharge (Cash / Card)'}
        badge={data.pos?.cardSurchargeEnabled && (data.pos?.cardSurchargePercent ?? 0) > 0
          ? { text: (lang === 'vi' ? 'Bật ' : 'On ') + (data.pos?.cardSurchargePercent ?? 0) + '%', color: '#22c55e' }
          : { text: lang === 'vi' ? 'Tắt' : 'Off', color: 'var(--c64748b)' }}
        hint={lang === 'vi' ? 'Tự cộng % khi khách trả bằng thẻ' : 'Auto-adds % when the customer pays by card'}
      >
        <CardSurcharge data={data} onSave={onSave} />
      </Panel>

      <Panel
        title={lang === 'vi' ? 'Tiền tip' : 'Tipping'}
        badge={data.pos?.tipsEnabled === false
          ? { text: lang === 'vi' ? 'Tắt' : 'Off', color: 'var(--c64748b)' }
          : { text: lang === 'vi' ? 'Bật' : 'On', color: '#22c55e' }}
        hint={lang === 'vi' ? 'Có hỏi khách tiền tip hay không' : 'Whether the customer is asked for a tip'}
      >
        <TipsConfig data={data} onSave={onSave} />
      </Panel>

      <Panel
        title={t('se.pay.loyaltyTitle')}
        badge={data.loyalty?.enabled ? { text: t('se.pay.on'), color: 'var(--ceab308)' } : { text: t('se.pay.off'), color: 'var(--c64748b)' }}
        hint={t('se.pay.loyaltyHint')}
      >
        <LoyaltyConfig data={data} onSave={onSave} />
      </Panel>

      {/* In Vietnam this IS the payment setup, not a fallback beneath the real
          one — so it says so. The owner asked where to configure payments and
          did not recognise "Bank transfer (manual)" as the answer. */}
      <Panel
        title={isVN ? 'Nhận tiền chuyển khoản · VietQR · MoMo · ZaloPay' : t('se.pay.bankTitle')}
        badge={data.pos?.transferInstructions ? { text: t('se.pay.setBadge'), color: '#22c55e' } : { text: t('se.pay.notSet'), color: '#f59e0b' }}
        hint={isVN ? 'Mã QR và số tài khoản khách quét để trả tiền' : t('se.pay.bankHint')}
      >
        <BankTransferConfig data={data} onSave={onSave} />
      </Panel>

      <button
        style={{ ...ui.primaryBtn, marginTop: 16 }}
        onClick={() => onSave('payments', { currency, currencySymbol: symbol, symbolPosition: position, priceDecimals: decimals, defaultPaymentMethod: defaultMethod, onSiteEnabled: onSite, gateways: gw }, 'Payments')}
      >
        {t('se.pay.save')}
      </button>
      <span style={{ color: 'var(--c64748b)', fontSize: 12, marginLeft: 12 }}>{t('se.pay.saveHint')}{enabledGw.length ? ` (${enabledGw.length} ${t('se.pay.onWord')})` : ''}.</span>
    </Card>
  );
}

/**
 * Whether the till asks for a tip at all.
 *
 * Not a percentage and not a default amount — the question is whether the
 * question gets asked. A 0% tip prompt in a country that does not tip is still
 * a foreign shop asking an awkward question, so this removes the prompt from
 * the customer screen, the thank-you QR and the counter panel together.
 */
function TipsConfig({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const [on, setOn] = useState(data.pos?.tipsEnabled !== false);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <label style={{ position: 'relative', display: 'inline-block', width: 42, height: 24, flexShrink: 0 }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{ position: 'absolute', cursor: 'pointer', inset: 0, background: on ? '#6366f1' : 'var(--c334155)', borderRadius: 24, transition: '.2s' }} />
          <span style={{ position: 'absolute', height: 18, width: 18, left: on ? 21 : 3, top: 3, background: '#fff', borderRadius: '50%', transition: '.2s' }} />
        </label>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{lang === 'vi' ? 'Hỏi khách tiền tip' : 'Ask the customer for a tip'}</div>
      </div>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 12.5, margin: '0 0 8px', lineHeight: 1.5, maxWidth: 640 }}>
        {lang === 'vi'
          ? 'Tắt thì màn hình khách, màn hình cảm ơn (mã QR tip) và ô ghi tip ở quầy đều ẩn đi — không phải để 0%, mà là không hỏi. Chọn quốc gia Việt Nam sẽ tự tắt; tiệm phục vụ khách nước ngoài có thể bật lại. Không ảnh hưởng tip đã ghi trước đó.'
          : 'When off, the customer screen, the thank-you QR and the counter tip box all disappear — not set to 0%, simply not asked. Picking Vietnam turns this off automatically; a salon serving tourists can turn it back on. Tips already recorded are untouched.'}
      </p>
      <button style={ui.primaryBtn} onClick={() => onSave('pos', { tipsEnabled: on }, lang === 'vi' ? 'Tiền tip' : 'Tipping')}>{lang === 'vi' ? 'Lưu' : 'Save'}</button>
    </div>
  );
}

function CardSurcharge({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const [on, setOn] = useState(!!data.pos?.cardSurchargeEnabled);
  const [pct, setPct] = useState(String(data.pos?.cardSurchargePercent ?? 3));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <label style={{ position: 'relative', display: 'inline-block', width: 42, height: 24, flexShrink: 0 }}>
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
          <span style={{ position: 'absolute', cursor: 'pointer', inset: 0, background: on ? '#6366f1' : 'var(--c334155)', borderRadius: 24, transition: '.2s' }} />
          <span style={{ position: 'absolute', height: 18, width: 18, left: on ? 21 : 3, top: 3, background: '#fff', borderRadius: '50%', transition: '.2s' }} />
        </label>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{lang === 'vi' ? 'Phụ phí khi khách trả bằng thẻ (giá Cash/Card)' : 'Card surcharge (Cash/Card pricing)'}</div>
      </div>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 12.5, margin: '0 0 8px', lineHeight: 1.5, maxWidth: 640 }}>
        {lang === 'vi'
          ? 'Mặc định TẮT. Bật thì menu chỉ nhập MỘT giá (giá tiền mặt); khi khách chọn trả thẻ (tại quầy hoặc đặt cọc online) hệ thống tự cộng % này và HIỆN RÕ cho khách trên hoá đơn + màn hình khách. Không cộng vào tiền tip. Ví dụ 3% → dịch vụ $55 → $56.65 khi trả thẻ.'
          : 'OFF by default. When on, enter ONE menu price (the cash price); if the customer pays by card (at the counter or an online deposit) the system adds this % and SHOWS it clearly on the bill + customer screen. Never added to the tip. E.g. 3% → a $55 service → $56.65 on card.'}
      </p>
      {on && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{lang === 'vi' ? 'Mức phí' : 'Fee'}</span>
          <input type="number" min={0} max={20} step="0.1" value={pct} onChange={(e) => setPct(e.target.value)} style={{ ...ui.input, width: 110 }} />
          <span style={{ color: 'var(--c94a3b8)' }}>%</span>
        </div>
      )}
      <button style={ui.primaryBtn} onClick={() => onSave('pos', { cardSurchargeEnabled: on, cardSurchargePercent: Math.min(20, Math.max(0, parseFloat(pct) || 0)) }, 'Card surcharge')}>{lang === 'vi' ? 'Lưu' : 'Save'}</button>
    </div>
  );
}

function PrimaryCardChannel({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [sel, setSel] = useState(data.pos?.primaryCardGateway ?? '');
  const enabled = GATEWAYS.filter((g) => data.gateways?.[g.id]?.enabled);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <select style={{ ...ui.input, maxWidth: 300 }} value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">{t('se.pcc.none')}</option>
        {enabled.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button style={ui.primaryBtn} onClick={() => onSave('pos', { primaryCardGateway: sel }, 'Card channel')}>{t('se.pcc.save')}</button>
      {enabled.length === 0 && <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{t('se.pcc.enableFirst')}</span>}
    </div>
  );
}

function BankTransferConfig({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();

  // One block per button the till actually shows, minus the two that need no
  // details. A Vietnamese salon offers VietQR, MoMo and ZaloPay, and those are
  // three different QR images from three different apps — one shared field
  // meant a cashier who tapped MoMo was shown the bank QR, or nothing.
  const methods = (data.pos?.resolvedPaymentMethods ?? ['TRANSFER']).filter(
    (m) => m !== 'CASH' && m !== 'CARD',
  );
  const LABELS: Record<string, { vi: string; en: string }> = {
    TRANSFER: { vi: 'Chuyển khoản ngân hàng', en: 'Bank transfer' },
    VIETQR: { vi: 'VietQR', en: 'VietQR' },
    MOMO: { vi: 'Ví MoMo', en: 'MoMo' },
    ZALOPAY: { vi: 'Ví ZaloPay', en: 'ZaloPay' },
    OTHER: { vi: 'Khác', en: 'Other' },
  };

  if (!methods.length) {
    return (
      <p style={{ color: 'var(--c64748b)', fontSize: 13, margin: 0 }}>
        {lang === 'vi'
          ? 'Máy tính tiền của tiệm chỉ nhận tiền mặt và thẻ, nên không cần khai gì ở đây.'
          : 'This till only takes cash and card, so there is nothing to fill in here.'}
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {methods.map((m) => (
        <MethodDetails
          key={m}
          method={m}
          label={LABELS[m]?.[lang === 'vi' ? 'vi' : 'en'] ?? m}
          data={data}
          onSave={onSave}
        />
      ))}
    </div>
  );
}

function MethodDetails({
  method, label, data, onSave,
}: { method: string; label: string; data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  // Falls back to the single old pair for TRANSFER, so a US salon that filled
  // in its Zelle details long ago still sees them here, unchanged.
  const existing = data.pos?.paymentDetails?.[method];
  const [text, setText] = useState(
    existing?.instructions ?? (method === 'TRANSFER' ? data.pos?.transferInstructions ?? '' : ''),
  );
  const [qr, setQr] = useState(
    existing?.qrUrl ?? (method === 'TRANSFER' ? data.pos?.transferQrUrl ?? '' : ''),
  );
  const filled = !!(text.trim() || qr.trim());
  const wallet = method === 'MOMO' || method === 'ZALOPAY';

  return (
    <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong style={{ color: 'var(--ce2e8f0)', fontSize: 14 }}>{label}</strong>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: filled ? '#22c55e' : '#f59e0b', border: `1px solid ${filled ? 'var(--c166534)' : 'var(--c78350f)'}` }}>
          {filled ? (lang === 'vi' ? 'Đã đặt' : 'Set') : (lang === 'vi' ? 'Chưa đặt' : 'Not set')}
        </span>
      </div>
      <Field label={lang === 'vi' ? 'Thông tin hiện cho khách' : 'Details shown to the customer'}>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            lang === 'vi'
              ? (wallet
                  ? 'Số điện thoại ví · tên chủ ví'
                  : 'Vietcombank — NGUYEN VAN A\nSố TK: 0123456789\nNội dung: [tên khách] [giờ hẹn]')
              : 'Bank of America — Lumio Nails\nAccount: 1234567890'
          }
          style={{ ...ui.input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <Field label={lang === 'vi' ? 'URL ảnh mã QR — khách quét để trả' : 'QR image URL — the customer scans it'}>
        <input style={ui.input} value={qr} onChange={(e) => setQr(e.target.value)} placeholder="https://…" />
      </Field>
      <div style={{ marginTop: 8 }}>
        <button
          style={ui.primaryBtn}
          onClick={() =>
            onSave(
              'pos',
              {
                paymentDetails: { [method]: { instructions: text, qrUrl: qr } },
                // Keep the legacy single pair in step for TRANSFER so anything
                // still reading the old fields sees the same thing.
                ...(method === 'TRANSFER' ? { transferInstructions: text, transferQrUrl: qr } : {}),
              },
              label,
            )
          }
        >
          {lang === 'vi' ? `Lưu ${label}` : `Save ${label}`}
        </button>
      </div>
    </div>
  );
}

function LoyaltyConfig({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const l = data.loyalty ?? { enabled: false, earnPointsPerDollar: 1, redeemCentsPerPoint: 5, minRedeemPoints: 100 };
  const [enabled, setEnabled] = useState(l.enabled);
  const [earn, setEarn] = useState(String(l.earnPointsPerDollar));
  const [cpp, setCpp] = useState(String(l.redeemCentsPerPoint));
  const [minR, setMinR] = useState(String(l.minRedeemPoints));
  const earnN = parseFloat(earn) || 0;
  const cppN = parseFloat(cpp) || 0;
  return (
    <div>
      <Toggle on={enabled} onChange={setEnabled} label={t('se.lo.enable')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 10, opacity: enabled ? 1 : 0.5 }}>
        <Field label={t('se.lo.earn')}><input style={ui.input} type="number" min={0} step="0.1" value={earn} onChange={(e) => setEarn(e.target.value)} /></Field>
        <Field label={t('se.lo.value')}><input style={ui.input} type="number" min={0} step="1" value={cpp} onChange={(e) => setCpp(e.target.value)} /></Field>
        <Field label={t('se.lo.minRedeem')}><input style={ui.input} type="number" min={0} value={minR} onChange={(e) => setMinR(e.target.value)} /></Field>
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 8 }}>
        {lang === 'vi'
          ? <>Ví dụ: nhận {earnN || 1} điểm/$ · {Math.round(100 / (cppN || 1))} điểm = ${((100 * (cppN || 1)) / 100).toFixed(2)} … tức <strong>100 điểm = ${((100 * (cppN || 0)) / 100).toFixed(2)}</strong> được giảm.</>
          : <>Example: earn {earnN || 1} pt/$ · {Math.round(100 / (cppN || 1))} points = ${((100 * (cppN || 1)) / 100).toFixed(2)} … i.e. <strong>100 points = ${((100 * (cppN || 0)) / 100).toFixed(2)}</strong> off.</>}
      </p>
      <button
        style={{ ...ui.primaryBtn, marginTop: 6 }}
        onClick={() => onSave('loyalty', { enabled, earnPointsPerDollar: earnN, redeemCentsPerPoint: cppN, minRedeemPoints: parseInt(minR, 10) || 0 }, 'Loyalty')}
      >
        {t('se.lo.save')}
      </button>
    </div>
  );
}

function DepositSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const d = data.deposit ?? { enabled: false, type: 'percent' as const, percent: 30, fixedCents: 1000, scope: 'all' as const, noShowThreshold: 2 };
  const [f, setF] = useState({ ...d, fixed: ((d.fixedCents ?? 0) / 100).toFixed(2), percentStr: String(d.percent ?? 30), thr: String(d.noShowThreshold ?? 2) });
  function save() {
    onSave('deposit', {
      enabled: f.enabled, type: f.type,
      percent: Math.min(100, Math.max(1, parseInt(f.percentStr, 10) || 30)),
      fixedCents: Math.max(0, Math.round((parseFloat(f.fixed) || 0) * 100)),
      scope: f.scope, noShowThreshold: Math.max(1, parseInt(f.thr, 10) || 2),
    }, 'Deposits');
  }
  return (
    <Card title={t('se.dep.title')} desc={t('se.dep.desc')}>
      <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t('se.dep.require')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12, opacity: f.enabled ? 1 : 0.5 }}>
        <Field label={t('se.dep.type')}>
          <select style={ui.input} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as 'percent' | 'fixed' })}>
            <option value="percent">{t('se.dep.percentOpt')}</option>
            <option value="fixed">{t('se.dep.fixedOpt')}</option>
          </select>
        </Field>
        {f.type === 'percent'
          ? <Field label={t('se.dep.percent')}><input style={ui.input} type="number" min={1} max={100} value={f.percentStr} onChange={(e) => setF({ ...f, percentStr: e.target.value })} /></Field>
          : <Field label={t('se.dep.fixed')}><input style={ui.input} type="number" min={0} step="0.01" value={f.fixed} onChange={(e) => setF({ ...f, fixed: e.target.value })} /></Field>}
        <Field label={t('se.dep.who')}>
          <select style={ui.input} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as 'all' | 'new' | 'repeat_noshow' })}>
            <option value="all">{t('se.dep.everyone')}</option>
            <option value="new">{t('se.dep.newOnly')}</option>
            <option value="repeat_noshow">{t('se.dep.repeatNoShow')}</option>
          </select>
        </Field>
        {f.scope === 'repeat_noshow' && (
          <Field label={t('se.dep.threshold')}><input style={ui.input} type="number" min={1} value={f.thr} onChange={(e) => setF({ ...f, thr: e.target.value })} /></Field>
        )}
      </div>
      <div style={{ background: '#3f2d0e', color: 'var(--cfde68a)', padding: '10px 12px', borderRadius: 8, fontSize: 12.5, marginTop: 12 }}>
        {t('se.dep.warn')}
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 14 }} onClick={save}>{t('se.dep.save')}</button>
    </Card>
  );
}

function RemindersSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const r = data.reminders ?? { enabled: false, hoursBefore1: 24, hoursBefore2: 3, channelEmail: true, channelSms: true };
  const [f, setF] = useState(r);
  return (
    <Card title={t('se.rem.title')} desc={t('se.rem.desc')}>
      <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={t('se.rem.send')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12, opacity: f.enabled ? 1 : 0.5 }}>
        <Field label={t('se.rem.first')}><input style={ui.input} type="number" min={1} max={168} value={f.hoursBefore1} onChange={(e) => setF({ ...f, hoursBefore1: parseInt(e.target.value, 10) || 0 })} /></Field>
        <Field label={t('se.rem.second')}><input style={ui.input} type="number" min={0} max={48} value={f.hoursBefore2} onChange={(e) => setF({ ...f, hoursBefore2: parseInt(e.target.value, 10) || 0 })} /></Field>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
        <Toggle on={f.channelEmail} onChange={(v) => setF({ ...f, channelEmail: v })} label={t('se.rem.byEmail')} />
        <Toggle on={f.channelSms} onChange={(v) => setF({ ...f, channelSms: v })} label={t('se.rem.bySms')} />
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 12 }}>
        {t('se.rem.tip')}
      </p>
      <button style={{ ...ui.primaryBtn, marginTop: 14 }} onClick={() => onSave('reminders', f, 'Reminders')}>{t('se.rem.save')}</button>
    </Card>
  );
}

function RebookingCard({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const rb = data.rebooking ?? { enabled: false, daysAfter: 21, email: true, sms: true };
  const [f, setF] = useState(rb);
  return (
    <Card
      title={lang === 'vi' ? 'Nhắc quay lại (rebooking)' : 'Rebooking reminder'}
      desc={lang === 'vi' ? 'Tự nhắn khách quay lại sau vài tuần — automation ra tiền nhiều nhất cho tiệm nail.' : 'Auto-nudge clients to rebook after a few weeks — the highest-ROI automation for a nail salon.'}
    >
      <Toggle on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} label={lang === 'vi' ? 'Bật nhắc quay lại' : 'Send rebooking reminders'} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12, opacity: f.enabled ? 1 : 0.5 }}>
        <Field label={lang === 'vi' ? 'Gửi sau lần ghé (ngày)' : 'Send after visit (days)'}>
          <input style={ui.input} type="number" min={1} max={120} value={f.daysAfter} onChange={(e) => setF({ ...f, daysAfter: parseInt(e.target.value, 10) || 0 })} />
        </Field>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 12, opacity: f.enabled ? 1 : 0.5 }}>
        <Toggle on={f.email} onChange={(v) => setF({ ...f, email: v })} label="Email" />
        <Toggle on={f.sms} onChange={(v) => setF({ ...f, sms: v })} label="SMS" />
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 12, lineHeight: 1.55 }}>
        {lang === 'vi'
          ? 'Chỉ gửi nếu khách CHƯA đặt lịch mới. Kèm link đặt lịch 1 chạm. Nail thường ~21 ngày. Có trần tần suất chống spam.'
          : 'Only sent if the client has NOT already rebooked. Includes a one-tap booking link. ~21 days suits nails. Frequency-capped to avoid spam.'}
      </p>
      <button style={{ ...ui.primaryBtn, marginTop: 14 }} onClick={() => onSave('rebooking', f, 'Rebooking')}>{lang === 'vi' ? 'Lưu' : 'Save'}</button>
    </Card>
  );
}

function NotificationsSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  // Same source the payments panel uses, so the two panels can never disagree
  // about whether this is a Vietnamese salon.
  const isVN = (data.company?.country ?? '').toUpperCase() === 'VN';
  const n = data.notifications;
  const [f, setF] = useState({
    mailService: n.mailService, replyTo: n.replyTo,
    senderName: n.senderName, senderEmail: n.senderEmail, adminEmail: n.adminEmail, adminPhone: n.adminPhone,
    emailCustomerOnBooking: n.emailCustomerOnBooking, emailAdminOnBooking: n.emailAdminOnBooking,
    smsCustomerOnBooking: n.smsCustomerOnBooking, smsAdminOnBooking: n.smsAdminOnBooking,
    emailSubjectCustomer: n.emailSubjectCustomer, emailIntroCustomer: n.emailIntroCustomer,
    emailSubjectAdmin: n.emailSubjectAdmin, emailIntroAdmin: n.emailIntroAdmin, emailFooter: n.emailFooter,
    smsCustomer: n.smsCustomer, smsAdmin: n.smsAdmin,
  });
  const [showTpl, setShowTpl] = useState(false);
  const [tw, setTw] = useState({ accountSid: n.twilio.accountSid, fromNumber: n.twilio.fromNumber, authToken: '' });
  const [es, setEs] = useState({ apiKey: n.esms?.apiKey ?? '', brandname: n.esms?.brandname ?? '', secretKey: '', oaid: n.esms?.oaid ?? '', znsBookingTempId: n.esms?.znsBookingTempId ?? '', znsReminderTempId: n.esms?.znsReminderTempId ?? '' });
  const [smtp, setSmtp] = useState({ host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, fromEmail: n.smtp.fromEmail, secure: n.smtp.secure, pass: '' });
  const [brevo, setBrevo] = useState({ senderEmail: n.brevo.senderEmail, senderName: n.brevo.senderName, apiKey: '' });
  const [gmail, setGmail] = useState({ clientId: n.gmail?.clientId ?? '', clientSecret: '' });
  const [gmailMsg, setGmailMsg] = useState<string | null>(null);
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [test, setTest] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });

  const sendTest = async () => {
    setTest({ kind: 'sending' });
    try {
      const r = await apiFetch<{ ok: boolean; to?: string; error?: string }>('/settings/notifications/test', { method: 'POST', token });
      if (r.ok) setTest({ kind: 'ok', msg: t('se.no.testOk').replace('{to}', String(r.to)) });
      else setTest({ kind: 'err', msg: r.error || t('se.no.testFail') });
    } catch (e) {
      setTest({ kind: 'err', msg: e instanceof Error ? e.message : t('se.no.reqFail') });
    }
  };

  const [smsTo, setSmsTo] = useState('');
  const [smsTest, setSmsTest] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });
  const sendTestSms = async () => {
    setSmsTest({ kind: 'sending' });
    try {
      const r = await apiFetch<{ ok: boolean; error?: string }>('/settings/notifications/test-sms', { method: 'POST', token, body: { to: smsTo } });
      setSmsTest(r.ok ? { kind: 'ok', msg: t('se.no.smsTestOk') } : { kind: 'err', msg: r.error || t('se.no.testFail') });
    } catch (e) {
      setSmsTest({ kind: 'err', msg: e instanceof Error ? e.message : t('se.no.reqFail') });
    }
  };

  // Show the result of returning from Google's consent screen.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('gmail') === 'connected') setGmailMsg(t('se.no.gmailConnected'));
    else if (p.get('gmail') === 'error') {
      const why = p.get('msg') || 'unknown';
      const friendly = why === 'invalid_client'
        ? t('se.no.gmailErrInvalidClient')
        : why === 'redirect_uri_mismatch'
          ? t('se.no.gmailErrRedirect')
          : why === 'missing_client'
            ? t('se.no.gmailErrMissing')
            : t('se.no.gmailErrGeneric');
      setGmailMsg(t('se.no.gmailFailPrefix').replace('{why}', why) + friendly);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectGmail = async () => {
    setGmailMsg(null);
    try {
      // Save Client ID/secret first so the server can build the consent URL.
      await apiFetch('/settings/notifications', { method: 'PATCH', token, body: { mailService: 'gmail', gmail: { clientId: gmail.clientId.trim(), clientSecret: gmail.clientSecret.trim() || undefined } } });
      const r = await apiFetch<{ url: string }>('/settings/gmail/auth-url', { token });
      window.location.href = r.url;
    } catch (e) {
      setGmailMsg(e instanceof Error ? e.message : t('se.no.gmailStartFail'));
    }
  };

  return (
    <Card title={t('se.no.title')} desc={t('se.no.desc')}>
      <div style={{ marginTop: 0, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{t('se.no.whenBooked')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 4, marginTop: 6 }}>
        <Toggle on={f.emailCustomerOnBooking} onChange={(v) => setF({ ...f, emailCustomerOnBooking: v })} label={t('se.no.emailCustomer')} />
        <Toggle on={f.emailAdminOnBooking} onChange={(v) => setF({ ...f, emailAdminOnBooking: v })} label={t('se.no.emailAdmin')} />
        <Toggle on={f.smsCustomerOnBooking} onChange={(v) => setF({ ...f, smsCustomerOnBooking: v })} label={t('se.no.smsCustomer')} />
        <Toggle on={f.smsAdminOnBooking} onChange={(v) => setF({ ...f, smsAdminOnBooking: v })} label={t('se.no.smsAdmin')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginTop: 12 }}>
        <Field label={t('se.no.adminEmail')}><input style={ui.input} value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} placeholder="owner@salon.com" /></Field>
        <Field label={t('se.no.adminPhone')}><input style={ui.input} value={f.adminPhone} onChange={(e) => setF({ ...f, adminPhone: e.target.value })} placeholder="+1…" /></Field>
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{t('se.no.templates')}</div>
        <button onClick={() => setShowTpl((s) => !s)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: showTpl ? 'var(--c475569)' : '#6366f1' }}>
          {showTpl ? t('se.no.hide') : t('se.no.customize')}
        </button>
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 0' }}>
        {t('se.no.placeholders')} <code>{'{salon} {customer} {service} {date} {time} {technician} {total} {duration} {addons}'}</code>
      </p>

      {showTpl && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12, padding: 14, background: 'var(--c0f172a)', borderRadius: 10, border: '1px solid var(--c334155)' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ccbd5e1)' }}>{t('se.no.customerEmail')}</div>
          <Field label={t('se.no.subject')}><input style={ui.input} value={f.emailSubjectCustomer} onChange={(e) => setF({ ...f, emailSubjectCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.intro')}><textarea style={{ ...ui.input, minHeight: 60, resize: 'vertical' }} value={f.emailIntroCustomer} onChange={(e) => setF({ ...f, emailIntroCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.footer')}><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailFooter} onChange={(e) => setF({ ...f, emailFooter: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 6 }}>{t('se.no.adminEmailTpl')}</div>
          <Field label={t('se.no.subject')}><input style={ui.input} value={f.emailSubjectAdmin} onChange={(e) => setF({ ...f, emailSubjectAdmin: e.target.value })} /></Field>
          <Field label={t('se.no.intro')}><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailIntroAdmin} onChange={(e) => setF({ ...f, emailIntroAdmin: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ccbd5e1)', marginTop: 6 }}>{t('se.no.smsText')}</div>
          <Field label={t('se.no.toCustomer')}><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsCustomer} onChange={(e) => setF({ ...f, smsCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.toAdmin')}><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsAdmin} onChange={(e) => setF({ ...f, smsAdmin: e.target.value })} /></Field>
          <div style={{ fontSize: 12, color: 'var(--c64748b)' }}>
            {t('se.no.tplNote')}
          </div>
        </div>
      )}

      {/* Email sending — Amelia-style: pick a Mail service, then shared sender fields,
          then only the chosen provider's fields show below. */}
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>{t('se.no.emailSending')}</div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.emailSendingHelp')}
      </p>
      <Field label={t('se.no.mailService')}>
        <select style={ui.input} value={f.mailService} onChange={(e) => setF({ ...f, mailService: e.target.value as 'auto' | 'off' | 'smtp' | 'brevo' | 'gmail' })}>
          <option value="auto">{t('se.no.msAuto')}</option>
          <option value="gmail">{t('se.no.msGmail')}</option>
          <option value="brevo">{t('se.no.msBrevo')}</option>
          <option value="smtp">{t('se.no.msSmtp')}</option>
          <option value="off">{t('se.no.msOff')}</option>
        </select>
      </Field>
      {f.mailService === 'auto' && (
        <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, padding: 12, marginTop: 8, fontSize: 12, color: 'var(--c94a3b8)' }}>
          {t('se.no.autoInfo')}
          <div style={{ marginTop: 8, color: 'var(--ccbd5e1)' }}>
            {t('se.no.previewInbox')}<br />
            <span style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{f.senderName || t('se.no.yourSalonName')}</span>{' '}
            <span style={{ color: 'var(--c64748b)' }}>&lt;notifications@lumio-booking&gt;</span><br />
            <span style={{ color: 'var(--c64748b)' }}>{t('se.no.replyTo')}: {f.replyTo || f.senderEmail || 'your@email'}</span>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
        <Field label={t('se.no.senderName')}><input style={ui.input} value={f.senderName} onChange={(e) => setF({ ...f, senderName: e.target.value })} placeholder={t('se.no.senderNamePh')} /></Field>
        <Field label={t('se.no.senderEmail')}><input style={ui.input} value={f.senderEmail} onChange={(e) => setF({ ...f, senderEmail: e.target.value })} placeholder="bookings@yoursalon.com" /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label={t('se.no.replyToField')}><input style={ui.input} value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} placeholder={t('se.no.replyToPh')} /></Field>
      </div>

      {f.mailService === 'brevo' && (
      <div style={{ marginTop: 12, padding: 14, background: 'var(--c0f172a)', borderRadius: 10, border: '1px solid var(--c334155)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--ccbd5e1)' }}>
          {t('se.no.brevoSetup')}{' '}
          {n.brevo.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.no.keySaved')}</span>}
        </div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '4px 0 10px' }}>
          {t('se.no.brevoHelp')}
        </p>
        <Field label={t('se.no.brevoKey')}><input style={ui.input} type="password" value={brevo.apiKey} onChange={(e) => setBrevo({ ...brevo, apiKey: e.target.value })} placeholder={n.brevo.connected ? t('se.no.saved') : 'xkeysib-…'} /></Field>
      </div>
      )}

      {f.mailService === 'gmail' && (
      <>
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>
        {t('se.no.connectGmail')}{' '}
        {n.gmail?.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.no.connectedAs').replace('{email}', n.gmail.senderEmail)}</span>}
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.gmailHelp')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <Field label={t('se.no.clientId')}><input style={ui.input} value={gmail.clientId} onChange={(e) => setGmail({ ...gmail, clientId: e.target.value })} placeholder="…apps.googleusercontent.com" /></Field>
        <Field label={t('se.no.clientSecret')}><input style={ui.input} type="password" value={gmail.clientSecret} onChange={(e) => setGmail({ ...gmail, clientSecret: e.target.value })} placeholder={n.gmail?.connected ? t('se.no.saved') : 'GOCSPX-…'} /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label={t('se.no.redirectUri')}>
          <input style={ui.input} readOnly value={data.gmailRedirectUri ?? ''} onFocus={(e) => e.currentTarget.select()} />
        </Field>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        <button onClick={connectGmail} style={{ ...ui.primaryBtn, background: '#ea4335' }}>
          {n.gmail?.connected ? t('se.no.reconnectGoogle') : t('se.no.connectGoogle')}
        </button>
        {n.gmail?.connected && <span style={{ color: '#22c55e', fontSize: 13 }}>{t('se.no.connectedAs').replace('{email}', n.gmail.senderEmail)}</span>}
        {gmailMsg && <span style={{ color: gmailMsg.startsWith('✓') ? '#22c55e' : '#ef4444', fontSize: 13 }}>{gmailMsg}</span>}
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 8 }}>
        {t('se.no.gmailPublishTip')}
      </p>
      </>
      )}

      {f.mailService === 'smtp' && (
      <>
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>
        {t('se.no.smtpServer')}{' '}
        {n.smtp.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.pay.connected')}</span>}
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.smtpHelp')}
      </p>
      <div style={{ background: '#3f2d0e', color: 'var(--cfde68a)', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
        {t('se.no.smtpWarn')}
      </div>
      <button
        type="button"
        onClick={() => setSmtp({ ...smtp, host: 'smtp.gmail.com', secure: 'ssl', port: 465 })}
        style={{ ...ui.input, width: 'auto', cursor: 'pointer', marginBottom: 10, background: 'var(--c1e293b)' }}
      >
        {t('se.no.smtpPreset')}
      </button>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Field label={t('se.no.smtpHost')}><input style={ui.input} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
        <Field label={t('se.no.smtpPort')}><input style={ui.input} type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} placeholder="465" /></Field>
        <Field label={t('se.no.smtpUser')}><input style={ui.input} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder="you@yoursalon.com" /></Field>
        <Field label={t('se.no.smtpPass')}><input style={ui.input} type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} placeholder={n.smtp.connected ? t('se.no.saved') : t('se.no.smtpPassPh')} /></Field>
        <Field label={t('se.no.encryption')}>
          <select style={ui.input} value={smtp.secure}
            onChange={(e) => { const v = e.target.value as 'ssl' | 'tls' | 'none'; setSmtp({ ...smtp, secure: v, port: v === 'ssl' ? 465 : v === 'tls' ? 587 : 25 }); }}>
            <option value="ssl">{t('se.no.encSsl')}</option>
            <option value="tls">{t('se.no.encTls')}</option>
            <option value="none">{t('se.no.encNone')}</option>
          </select>
        </Field>
      </div>
      </>
      )}

      {/* Diagnostics: verify the chosen email provider actually works. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" onClick={sendTest} disabled={test.kind === 'sending'}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: 'var(--ca5b4fc)', fontSize: 13, cursor: 'pointer' }}>
          {test.kind === 'sending' ? t('se.no.sending') : t('se.no.sendTest')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>{t('se.no.testHint')}</span>
      </div>
      {test.kind === 'ok' && <div style={{ marginTop: 8, color: '#22c55e', fontSize: 13 }}>✓ {test.msg}</div>}
      {test.kind === 'err' && <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13, wordBreak: 'break-word' }}>✕ {test.msg}</div>}

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>
        {t('se.no.smsGateway')}{' '}
        {n.twilio.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.pay.connected')}</span>}
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.twilioHelp')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Field label={t('se.no.accountSid')}><input style={ui.input} value={tw.accountSid} onChange={(e) => setTw({ ...tw, accountSid: e.target.value })} placeholder="AC…" /></Field>
        <Field label={t('se.no.authToken')}><input style={ui.input} type="password" value={tw.authToken} onChange={(e) => setTw({ ...tw, authToken: e.target.value })} placeholder={n.twilio.connected ? t('se.no.saved') : t('se.no.authToken')} /></Field>
        <Field label={t('se.no.fromNumber')}><input style={ui.input} value={tw.fromNumber} onChange={(e) => setTw({ ...tw, fromNumber: e.target.value })} placeholder="+1…" /></Field>
      </div>

      {/* Vietnam sends through a domestic aggregator, never Twilio. Twilio to a
          Vietnamese number is a silent failure — accepted with an id, dropped by
          the carrier — so this panel only appears for a VN salon, and Twilio
          above is the only path for everyone else. */}
      {isVN && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--c1e293b)' }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)' }}>
            SMS Việt Nam · eSMS.vn{' '}
            {es.brandname && n.esms?.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>đã kết nối</span>}
          </div>
          <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px', lineHeight: 1.5 }}>
            Twilio KHÔNG gửi được vào Việt Nam — nhà mạng chặn tin từ đầu số chưa đăng ký, mà Twilio vẫn báo &quot;đã gửi&quot;.
            Brandname phải được nhà mạng duyệt trước khi gửi được; chưa duyệt thì eSMS trả lỗi 104 ở mọi lần gửi.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Field label="API Key"><input style={ui.input} value={es.apiKey} onChange={(e) => setEs({ ...es, apiKey: e.target.value })} /></Field>
            <Field label="Secret Key"><input style={ui.input} type="password" value={es.secretKey} onChange={(e) => setEs({ ...es, secretKey: e.target.value })} placeholder={n.esms?.connected ? 'Đã lưu' : 'Secret Key'} /></Field>
            <Field label="Brandname"><input style={ui.input} value={es.brandname} onChange={(e) => setEs({ ...es, brandname: e.target.value })} placeholder="LUMIO" /></Field>
          </div>

          {/* Zalo ZNS — same eSMS keys and wallet. Optional: empty = SMS only. */}
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 14 }}>
            Zalo ZNS (tùy chọn){' '}
            {es.oaid && (es.znsBookingTempId || es.znsReminderTempId) && <span style={{ color: '#22c55e', fontSize: 12 }}>đang bật</span>}
          </div>
          <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 10px', lineHeight: 1.5 }}>
            Có OAID + Template ID thì tin xác nhận/nhắc lịch đi qua Zalo trước (rẻ hơn ~50%, hiện ngay trong app) —
            lỗi hoặc máy không có Zalo thì tự động chuyển về SMS, khách không bao giờ bị mất tin.
            Mẫu ZNS đăng ký qua eSMS phải dùng đúng 5 tham số: <code>customer_name, salon_name, service_name, appointment_date, appointment_time</code>.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <Field label="Zalo OA ID"><input style={ui.input} value={es.oaid} onChange={(e) => setEs({ ...es, oaid: e.target.value })} placeholder="OAID đã liên kết với eSMS" /></Field>
            <Field label="Template xác nhận lịch"><input style={ui.input} value={es.znsBookingTempId} onChange={(e) => setEs({ ...es, znsBookingTempId: e.target.value })} placeholder="TempID" /></Field>
            <Field label="Template nhắc lịch"><input style={ui.input} value={es.znsReminderTempId} onChange={(e) => setEs({ ...es, znsReminderTempId: e.target.value })} placeholder="TempID" /></Field>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
        <Field label={t('se.no.smsTestTo')}><input style={ui.input} value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+1…" /></Field>
        <button
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}
          disabled={smsTest.kind === 'sending'}
          onClick={sendTestSms}
        >{smsTest.kind === 'sending' ? t('se.no.sending') : t('se.no.smsTestBtn')}</button>
      </div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '6px 0 0' }}>{t('se.no.smsTestHint')}</p>
      {smsTest.kind === 'ok' && <p style={{ color: '#22c55e', fontSize: 13, margin: '4px 0 0' }}>{smsTest.msg}</p>}
      {smsTest.kind === 'err' && <p style={{ color: '#ef4444', fontSize: 13, margin: '4px 0 0' }}>{smsTest.msg}</p>}

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('notifications', { ...f, smtp, brevo, gmail, twilio: tw, esms: es }, 'Notifications')}>{t('se.no.save')}</button>
    </Card>
  );
}

const SEASON_HUES: Record<string, string> = { holiday: '#c81e3a', valentine: '#e8467f', spring: '#0ea371', fall: '#e07b1a', winter: '#2563eb' };
function effectiveAccent(theme: string | undefined, base: string): string {
  if (!theme || theme === 'off') return base;
  if (theme !== 'auto') return SEASON_HUES[theme] || base;
  const d = new Date(); const m = d.getMonth() + 1; const day = d.getDate();
  if (m === 12 || (m === 1 && day <= 6)) return SEASON_HUES.holiday;
  if (m === 2) return SEASON_HUES.valentine;
  if (m >= 3 && m <= 5) return SEASON_HUES.spring;
  if (m >= 9 && m <= 11) return SEASON_HUES.fall;
  return base;
}
let _logoStorageReady: Promise<boolean> | null = null;
function logoStorageConfigured(token: string): Promise<boolean> {
  if (!_logoStorageReady) {
    _logoStorageReady = apiFetch<{ configured: boolean }>('/uploads/storage/status', { token }).then((r) => !!r?.configured).catch(() => false);
  }
  return _logoStorageReady;
}
/** Resize a picked logo to <=240px and keep PNG so transparency survives — the
 *  image is stored EXACTLY as the salon uploaded it (no background editing). */
async function compressLogo(file: File, maxSide = 128): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = dataUrl; });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)); const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}
/** Compress a large photo (welcome hero) to <=maxSide px JPEG for the display. */
async function compressPhoto(file: File, maxSide = 1400, quality = 0.82): Promise<string> {
  const dataUrl: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(new Error('read')); fr.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('decode')); im.src = dataUrl; });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale)); const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d'); if (!ctx) return dataUrl;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}
function BrandingSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState(data.branding);
  const season = f.seasonalTheme ?? 'off';
  const prevAccent = effectiveAccent(season, f.accentColor);
  const { token } = useAuth();
  const logoRef = useRef<HTMLInputElement | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const logoShow = (f.logoUrl || '').trim();
  const logoOk = logoShow.startsWith('https://') || logoShow.startsWith('data:image/');
  async function onPickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setLogoErr(lang === 'vi' ? 'File không phải hình ảnh.' : 'That file is not an image.'); return; }
    const tk = token ?? '';
    setLogoErr(null); setLogoBusy(true);
    try {
      // Shrink to the smallest sensible size — the logo only ever shows at ~46px, so
      // 128px is already retina-sharp. Keep going smaller if the PNG is still heavy.
      let out = await compressLogo(file, 128);
      if (out.length > 90000) out = await compressLogo(file, 96);
      if (out.length > 90000) out = await compressLogo(file, 72);
      // Hostinger/FTP set up? push it there and keep only the URL. Otherwise store the
      // small PNG inline (works everywhere the logo is shown on the booking page).
      if (tk && (await logoStorageConfigured(tk))) {
        try { const r = await apiFetch<{ url?: string }>('/uploads/service-photo', { method: 'POST', token: tk, body: { dataUrl: out } }); if (r?.url) { setF((prev) => ({ ...prev, logoUrl: r.url as string })); return; } } catch { /* fall through to inline */ }
      }
      if (out.length > 250000) { setLogoErr(lang === 'vi' ? 'Ảnh quá lớn — thử ảnh nhỏ hơn.' : 'Image too large — try a smaller one.'); return; }
      setF((prev) => ({ ...prev, logoUrl: out }));
    } catch { setLogoErr(lang === 'vi' ? 'Tải ảnh thất bại.' : 'Upload failed.'); }
    finally { setLogoBusy(false); }
  }
  const welcomeRef = useRef<HTMLInputElement | null>(null);
  const [wBusy, setWBusy] = useState(false);
  const [wErr, setWErr] = useState<string | null>(null);
  const welcomeShow = (f.welcomeImageUrl || '').trim();
  const welcomeOk = welcomeShow.startsWith('https://') || welcomeShow.startsWith('data:image/');
  async function onPickWelcome(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setWErr(lang === 'vi' ? 'File không phải hình ảnh.' : 'That file is not an image.'); return; }
    const tk = token ?? '';
    setWErr(null); setWBusy(true);
    try {
      let out = await compressPhoto(file, 1400, 0.82);
      if (out.length > 1_600_000) out = await compressPhoto(file, 1100, 0.78);
      // Photos are big — store on the salon's FTP/storage when configured.
      if (tk && (await logoStorageConfigured(tk))) {
        try { const r = await apiFetch<{ url?: string }>('/uploads/service-photo', { method: 'POST', token: tk, body: { dataUrl: out } }); if (r?.url) { setF((prev) => ({ ...prev, welcomeImageUrl: r.url as string })); return; } } catch { /* fall through to inline */ }
      }
      if (out.length > 1_900_000) { setWErr(lang === 'vi' ? 'Ảnh quá lớn — bật lưu trữ (Storage) hoặc dùng ảnh nhỏ hơn.' : 'Too large — enable storage or use a smaller image.'); return; }
      setF((prev) => ({ ...prev, welcomeImageUrl: out }));
    } catch { setWErr(lang === 'vi' ? 'Tải ảnh thất bại.' : 'Upload failed.'); }
    finally { setWBusy(false); }
  }
  return (
    <Card title={t('se.br.title')} desc={t('se.br.desc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
        <Field label={t('se.br.accent')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} style={{ width: 44, height: 38, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            <input style={ui.input} value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} />
          </div>
        </Field>
        <Field label={lang === 'vi' ? 'Chủ đề theo mùa (trang khách)' : 'Seasonal theme (customer page)'}>
          <select style={ui.input} value={season} onChange={(e) => setF({ ...f, seasonalTheme: e.target.value })}>
            <option value="off">{lang === 'vi' ? 'Tắt — giữ màu thương hiệu' : 'Off — keep my brand color'}</option>
            <option value="auto">{lang === 'vi' ? 'Tự động theo mùa (US/CA)' : 'Auto by season (US/CA)'}</option>
            <option value="holiday">{lang === 'vi' ? 'Lễ cuối năm (đỏ)' : 'Holiday (red)'}</option>
            <option value="valentine">Valentine</option>
            <option value="spring">{lang === 'vi' ? 'Mùa xuân' : 'Spring'}</option>
            <option value="fall">{lang === 'vi' ? 'Mùa thu' : 'Fall'}</option>
            <option value="winter">{lang === 'vi' ? 'Mùa đông' : 'Winter'}</option>
          </select>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label={lang === 'vi' ? 'Logo' : 'Logo'}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: 'hidden', display: 'grid', placeItems: 'center', background: logoOk ? '#fff' : 'var(--c0f172a)', border: '1px solid var(--c334155)', fontSize: 20 }}>
              {logoOk
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoShow} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${(f.logoScale ?? 100) / 100})`, transformOrigin: 'center' }} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : <span>🏪</span>}
            </span>
            <button type="button" onClick={() => logoRef.current?.click()} disabled={logoBusy}
              style={{ ...ui.primaryBtn, padding: '9px 14px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, opacity: logoBusy ? 0.6 : 1 }}>
              {logoBusy ? (lang === 'vi' ? 'Đang tải…' : 'Uploading…') : (lang === 'vi' ? '⬆ Tải logo lên' : '⬆ Upload logo')}
            </button>
            <input ref={logoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickLogo} />
            {logoShow && (
              <button type="button" onClick={() => setF({ ...f, logoUrl: '' })}
                style={{ background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}>
                {lang === 'vi' ? 'Xoá' : 'Remove'}
              </button>
            )}
            <input style={{ ...ui.input, fontSize: 12.5, flex: '1 1 200px', minWidth: 160 }} value={logoShow.startsWith('data:') ? '' : (f.logoUrl || '')}
              onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder={lang === 'vi' ? 'hoặc dán URL https://…/logo.png' : 'or paste https://…/logo.png'} />
          </div>
          {logoErr && <div style={{ color: 'var(--cf87171)', fontSize: 12, marginTop: 4 }}>{logoErr}</div>}
          {logoOk && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, maxWidth: 380 }}>
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{lang === 'vi' ? 'Phóng to trong khung' : 'Zoom in frame'}</span>
              <input type="range" min={60} max={180} step={5} value={f.logoScale ?? 100}
                onChange={(e) => setF({ ...f, logoScale: parseInt(e.target.value, 10) })} style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--ce2e8f0)', width: 40, textAlign: 'right' }}>{f.logoScale ?? 100}%</span>
            </div>
          )}
          <div style={{ color: 'var(--c64748b)', fontSize: 11.5, marginTop: 6 }}>{lang === 'vi' ? 'Logo giữ nguyên như file tải lên. Khung nền trắng; kéo thanh trên để logo tràn kín khung (che viền).' : 'The logo is kept exactly as uploaded. White frame; drag the slider to make it fill the frame edge-to-edge.'}</div>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label={lang === 'vi' ? 'Ảnh màn hình chào khách (Customer display)' : 'Welcome screen image (customer display)'}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ width: 96, height: 54, borderRadius: 8, flexShrink: 0, overflow: 'hidden', display: 'grid', placeItems: 'center', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', fontSize: 18 }}>
              {welcomeOk
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={welcomeShow} alt="welcome" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : <span>🖼</span>}
            </span>
            <button type="button" onClick={() => welcomeRef.current?.click()} disabled={wBusy}
              style={{ ...ui.primaryBtn, padding: '9px 14px', fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, opacity: wBusy ? 0.6 : 1 }}>
              {wBusy ? (lang === 'vi' ? 'Đang tải…' : 'Uploading…') : (lang === 'vi' ? '⬆ Tải ảnh lên' : '⬆ Upload image')}
            </button>
            <input ref={welcomeRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickWelcome} />
            {welcomeShow && (
              <button type="button" onClick={() => setF({ ...f, welcomeImageUrl: '' })}
                style={{ background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer' }}>
                {lang === 'vi' ? 'Xoá' : 'Remove'}
              </button>
            )}
            <input style={{ ...ui.input, fontSize: 12.5, flex: '1 1 200px', minWidth: 160 }} value={welcomeShow.startsWith('data:') ? '' : (f.welcomeImageUrl || '')}
              onChange={(e) => setF({ ...f, welcomeImageUrl: e.target.value })} placeholder={lang === 'vi' ? 'hoặc dán URL https://…/anh.jpg' : 'or paste https://…/photo.jpg'} />
          </div>
          {wErr && <div style={{ color: 'var(--cf87171)', fontSize: 12, marginTop: 4 }}>{wErr}</div>}
          <div style={{ color: 'var(--c64748b)', fontSize: 11.5, marginTop: 6 }}>{lang === 'vi' ? 'Ảnh ngang, đẹp nhất ~16:9 (vd bàn tay/nail sang trọng). Hiện làm nền màn chào khách kèm logo + chữ "Welcome". Để trống thì dùng màn chào mặc định.' : 'Landscape image, best ~16:9 (e.g. an elegant nail/hand shot). Becomes the welcome-screen background with your logo + a "Welcome" title. Leave blank for the default welcome screen.'}</div>
        </Field>
      </div>

      <div style={{ marginTop: 12 }}>
        <Field label={lang === 'vi' ? 'Badge đánh giá (trang khách)' : 'Rating badge (customer page)'}>
          <select style={ui.input} value={f.ratingMode ?? 'auto'} onChange={(e) => setF({ ...f, ratingMode: e.target.value })}>
            <option value="auto">{lang === 'vi' ? 'Tự động — từ đánh giá trong Lumio' : 'Auto — from in-app reviews'}</option>
            <option value="manual">{lang === 'vi' ? 'Nhập tay — ví dụ rating Google của tiệm' : 'Manual — e.g. your Google rating'}</option>
            <option value="off">{lang === 'vi' ? 'Ẩn badge' : 'Hide badge'}</option>
          </select>
        </Field>
        {(f.ratingMode ?? 'auto') === 'manual' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
            <Field label={lang === 'vi' ? 'Số sao (0–5)' : 'Stars (0–5)'}>
              <input style={ui.input} type="number" min={0} max={5} step={0.1} value={f.ratingValue ?? 0}
                onChange={(e) => setF({ ...f, ratingValue: Math.max(0, Math.min(5, parseFloat(e.target.value) || 0)) })} />
            </Field>
            <Field label={lang === 'vi' ? 'Số lượt đánh giá' : 'Number of reviews'}>
              <input style={ui.input} type="number" min={0} step={1} value={f.ratingCount ?? 0}
                onChange={(e) => setF({ ...f, ratingCount: Math.max(0, Math.round(parseFloat(e.target.value) || 0)) })} />
            </Field>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 6, lineHeight: 1.55 }}>
          {lang === 'vi'
            ? 'Nhập tay: dùng để hiện đúng số sao Google của tiệm (Lumio không tự kéo review từ Google). Hãy nhập số thật của tiệm.'
            : 'Manual lets you show your real Google rating (Lumio does not pull Google reviews automatically). Enter your true numbers.'}
        </div>
      </div>

      {/* Live preview of the booking-page header — what a customer actually sees. */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 6 }}>{t('se.br.preview')}</div>
        <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--c334155)' }}>
          <div style={{ background: `linear-gradient(135deg, ${prevAccent}, ${prevAccent})`, padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: logoOk ? '#fff' : 'rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {logoOk
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logoShow} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
                : <span style={{ fontSize: 17 }}>🏪</span>}
            </span>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 16, fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>{data.company?.name || 'Your salon'}</span>
            {(f.ratingMode ?? 'auto') === 'manual' && (f.ratingCount ?? 0) > 0 && (
              <span style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.18)', color: '#fff', borderRadius: 999, padding: '5px 10px', fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap' }}>★ {f.ratingValue ?? 0} · {f.ratingCount ?? 0}</span>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 6, lineHeight: 1.55 }}>{t('se.br.logoHelp')}</div>
      </div>

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('branding', f, 'Branding')}>{t('se.br.save')}</button>
    </Card>
  );
}
