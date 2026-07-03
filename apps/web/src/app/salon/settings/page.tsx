'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { TimezonePicker } from '../../../components/TimezonePicker';

interface DayHours { closed: boolean; openMinutes: number; closeMinutes: number }
interface Booking {
  slotStepMinutes: number; minLeadHours: number; maxAdvanceDays: number;
  allowCustomerChooseStaff: boolean; assignmentMode: 'none' | 'auto'; currency: string;
  currencySymbol: string; symbolPosition: 'before' | 'after'; priceDecimals: number; defaultPaymentMethod: 'online' | 'onsite';
  onlinePaymentEnabled: boolean; payLaterEnabled: boolean;
  businessHours: DayHours[]; daysOff: string[];
}
interface GatewayView { enabled: boolean; connected: boolean; apiKey: string }
interface SettingsData {
  company: { name: string; slug: string; contactEmail: string | null; contactPhone: string | null; timezone: string; address: string; website: string };
  booking: Booking;
  branding: { accentColor: string; logoUrl: string };
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
  };
  pos?: { taxRatePercent: number; receiptFooter: string; primaryCardGateway: string; transferInstructions: string; transferQrUrl: string };
  loyalty?: { enabled: boolean; earnPointsPerDollar: number; redeemCentsPerPoint: number; minRedeemPoints: number };
  reminders?: { enabled: boolean; hoursBefore1: number; hoursBefore2: number; channelEmail: boolean; channelSms: boolean };
  deposit?: { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number; scope: 'all' | 'new' | 'repeat_noshow'; noShowThreshold: number };
  gmailRedirectUri?: string;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'VND', 'JPY', 'SGD'];
// Most popular US/Canada card gateways. apiKey = public identifier; secret = private key.
const GATEWAYS = [
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

  if (loading) return <section><h1 style={{ fontSize: 24 }}>{t('se.title')}</h1><p style={{ color: '#94a3b8' }}>{t('se.loading')}</p></section>;
  if (!data) {
    return (
      <section>
        <h1 style={{ fontSize: 24 }}>{t('se.title')}</h1>
        {error && <div style={ui.banner}>{error}</div>}
        <p style={{ color: '#94a3b8' }}>{t('se.loadFail')}</p>
      </section>
    );
  }

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>{t('se.title')}</h1>
      {error && <div style={ui.banner}>{error}</div>}
      {savedMsg && <div style={{ background: '#14532d', color: '#bbf7d0', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{savedMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '220px 1fr', gap: isMobile ? 14 : 20, alignItems: 'start' }}>
        {/* Settings sub-nav: scrollable row on mobile, sidebar on desktop */}
        <nav style={{ display: 'flex', flexDirection: isMobile ? 'row' : 'column', gap: isMobile ? 8 : 4, position: isMobile ? 'static' : 'sticky', top: 0, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
          {SECTIONS.map((s) => {
            const active = tab === s.id;
            return (
              <button key={s.id} onClick={() => setTab(s.id)}
                style={{ textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                  border: '1px solid ' + (active ? '#6366f1' : '#334155'), background: active ? '#312e81' : '#1e293b', color: '#e2e8f0' }}>
                <span style={{ fontSize: 16 }}>{s.icon}</span>
                <span>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t(`se.sec.${s.id}`)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{t(`se.secD.${s.id}`)}</div>
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
          {tab === 'reminders' && <RemindersSection data={data} onSave={save} />}
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
      {desc && <p style={{ color: '#94a3b8', margin: '0 0 14px', fontSize: 13 }}>{desc}</p>}
      {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // minHeight keeps 1-line and 2-line labels the same height so the inputs in a
  // row stay aligned (e.g. the long "Timezone…" label no longer pushes its box down).
  return <label style={{ display: 'block' }}><span style={{ ...ui.label, minHeight: 30, display: 'block' }}>{label}</span>{children}</label>;
}
function RadioRow({ checked, onClick, title, desc }: { checked: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button type="button" onClick={onClick}
      style={{ textAlign: 'left', display: 'flex', gap: 10, padding: 12, borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${checked ? '#6366f1' : '#334155'}`, background: checked ? '#312e81' : '#0f172a' }}>
      <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${checked ? '#818cf8' : '#64748b'}`, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 2 }}>
        {checked && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#818cf8' }} />}
      </span>
      <span>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{title}</div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>{desc}</div>
      </span>
    </button>
  );
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button onClick={() => onChange(!on)} type="button"
      style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'transparent', border: 'none', cursor: 'pointer', color: '#e2e8f0', fontSize: 14, padding: '7px 0', textAlign: 'left' }}>
      <span style={{ width: 38, height: 22, borderRadius: 999, background: on ? '#6366f1' : '#475569', position: 'relative', flexShrink: 0 }}>
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
    <div style={{ marginTop: 10, border: '1px solid #334155', borderRadius: 10, background: '#0f172a', overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ color: '#64748b', fontSize: 11, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }}>▶</span>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>{title}</span>
        {badge && <span style={{ fontSize: 11, fontWeight: 600, color: badge.color, border: `1px solid ${badge.color}`, borderRadius: 999, padding: '1px 8px' }}>{badge.text}</span>}
        {hint && !open && <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '45%' }}>{hint}</span>}
      </button>
      {open && <div style={{ padding: '0 14px 14px' }}>{children}</div>}
    </div>
  );
}

function CompanySection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState(data.company);
  return (
    <Card title={t('se.co.title')} desc={t('se.co.desc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'start' }}>
        <Field label={t('se.co.name')}><input style={ui.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label={t('se.co.tz')}><TimezonePicker value={f.timezone} onChange={(tz) => setF({ ...f, timezone: tz })} selectStyle={ui.input} /></Field>
        <Field label={t('se.co.email')}><input style={ui.input} value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label={t('se.co.phone')}><input style={ui.input} value={f.contactPhone ?? ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label={t('se.co.address')}><input style={ui.input} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label={t('se.co.website')}><input style={ui.input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <button
        style={{ ...ui.primaryBtn, marginTop: 16 }}
        onClick={() => onSave('company', { name: f.name, contactEmail: f.contactEmail, contactPhone: f.contactPhone, timezone: f.timezone, address: f.address, website: f.website }, 'Company')}
      >
        {t('se.co.save')}
      </button>
    </Card>
  );
}

function HoursSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [hours, setHours] = useState<DayHours[]>(data.booking.businessHours);
  function upd(day: number, patch: Partial<DayHours>) { setHours((p) => p.map((h, i) => (i === day ? { ...h, ...patch } : h))); }
  return (
    <Card title={t('se.hr.title')} desc={t('se.hr.desc')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DAY_ORDER.map((day) => {
          const h = hours[day];
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 42, fontSize: 13, color: '#cbd5e1' }}>{DAY_LABEL[lang][day]}</span>
              <Toggle on={!h.closed} onChange={(open) => upd(day, { closed: !open })} label="" />
              {h.closed ? <span style={{ color: '#64748b', fontSize: 13 }}>{t('se.hr.closed')}</span> : (
                <>
                  <input style={{ ...ui.input, width: 120 }} type="time" value={minToHm(h.openMinutes)} onChange={(e) => upd(day, { openMinutes: hmToMin(e.target.value) })} />
                  <span style={{ color: '#64748b' }}>–</span>
                  <input style={{ ...ui.input, width: 120 }} type="time" value={minToHm(h.closeMinutes)} onChange={(e) => upd(day, { closeMinutes: hmToMin(e.target.value) })} />
                </>
              )}
            </div>
          );
        })}
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', { businessHours: hours }, 'Business hours')}>{t('se.hr.save')}</button>
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
        {days.length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>{t('se.do.none')}</span>}
        {days.map((d) => (
          <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 999, padding: '4px 10px', fontSize: 13 }}>
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

      <div style={{ marginTop: 14, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>{t('se.ru.assignment')}</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 8px' }}>{t('se.ru.assignWhen')}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RadioRow checked={f.assignmentMode === 'none'} onClick={() => setF({ ...f, assignmentMode: 'none' })}
          title={t('se.ru.noneTitle')} desc={t('se.ru.noneDesc')} />
        <RadioRow checked={f.assignmentMode === 'auto'} onClick={() => setF({ ...f, assignmentMode: 'auto' })}
          title={t('se.ru.autoTitle')} desc={t('se.ru.autoDesc')} />
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
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {t('se.pay.preview')} <strong style={{ color: '#e2e8f0' }}>{previewPrice(35, currency, symbol, position, decimals)}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Toggle on={onSite} onChange={setOnSite} label={t('se.pay.acceptOnsite')} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8' }}>
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
      <Panel
        title={t('se.pay.gwTitle')}
        badge={connectedGw.length ? { text: t('se.pay.connectedN').replace('{n}', String(connectedGw.length)), color: '#22c55e' } : { text: t('se.pay.none'), color: '#64748b' }}
        hint={connectedGw.length ? connectedGw.map((g) => g.name).join(', ') : t('se.pay.gwHintNone')}
      >
        <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 10px' }}>
          {t('se.pay.gwIntro')}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {GATEWAYS.map((g) => {
            const e = gw[g.id];
            const connected = data.gateways?.[g.id]?.connected;
            return (
              <div key={g.id} style={{ border: `1px solid ${e.enabled ? '#6366f1' : '#334155'}`, borderRadius: 10, padding: 14, background: '#111827' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>
                      {g.name}{' '}
                      {connected && <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>{t('se.pay.connected')}</span>}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{t(`se.gw.${g.id}`)}</div>
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

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #334155' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1' }}>{t('se.pay.primaryCard')}</div>
          <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
            {t('se.pay.primaryCardDesc')}
          </p>
          <PrimaryCardChannel data={data} onSave={onSave} />
        </div>
      </Panel>

      <Panel
        title={t('se.pay.loyaltyTitle')}
        badge={data.loyalty?.enabled ? { text: t('se.pay.on'), color: '#eab308' } : { text: t('se.pay.off'), color: '#64748b' }}
        hint={t('se.pay.loyaltyHint')}
      >
        <LoyaltyConfig data={data} onSave={onSave} />
      </Panel>

      <Panel
        title={t('se.pay.bankTitle')}
        badge={data.pos?.transferInstructions ? { text: t('se.pay.setBadge'), color: '#22c55e' } : { text: t('se.pay.notSet'), color: '#64748b' }}
        hint={t('se.pay.bankHint')}
      >
        <BankTransferConfig data={data} onSave={onSave} />
      </Panel>

      <button
        style={{ ...ui.primaryBtn, marginTop: 16 }}
        onClick={() => onSave('payments', { currency, currencySymbol: symbol, symbolPosition: position, priceDecimals: decimals, defaultPaymentMethod: defaultMethod, onSiteEnabled: onSite, gateways: gw }, 'Payments')}
      >
        {t('se.pay.save')}
      </button>
      <span style={{ color: '#64748b', fontSize: 12, marginLeft: 12 }}>{t('se.pay.saveHint')}{enabledGw.length ? ` (${enabledGw.length} ${t('se.pay.onWord')})` : ''}.</span>
    </Card>
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
      {enabled.length === 0 && <span style={{ color: '#94a3b8', fontSize: 12 }}>{t('se.pcc.enableFirst')}</span>}
    </div>
  );
}

function BankTransferConfig({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [text, setText] = useState(data.pos?.transferInstructions ?? '');
  const [qr, setQr] = useState(data.pos?.transferQrUrl ?? '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field label={t('se.bt.details')}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={'e.g.\nBank of America — Lumio Nails\nAccount: 1234567890\nZelle: pay@lumionails.com'}
          style={{ ...ui.input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <Field label={t('se.bt.qr')}>
        <input style={ui.input} value={qr} onChange={(e) => setQr(e.target.value)} placeholder={t('se.bt.qrPh')} />
      </Field>
      <div>
        <button style={ui.primaryBtn} onClick={() => onSave('pos', { transferInstructions: text, transferQrUrl: qr }, 'Bank transfer')}>
          {t('se.bt.save')}
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
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>
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
      <div style={{ background: '#3f2d0e', color: '#fde68a', padding: '10px 12px', borderRadius: 8, fontSize: 12.5, marginTop: 12 }}>
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
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>
        {t('se.rem.tip')}
      </p>
      <button style={{ ...ui.primaryBtn, marginTop: 14 }} onClick={() => onSave('reminders', f, 'Reminders')}>{t('se.rem.save')}</button>
    </Card>
  );
}

function NotificationsSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
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
      <div style={{ marginTop: 0, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>{t('se.no.whenBooked')}</div>
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
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>{t('se.no.templates')}</div>
        <button onClick={() => setShowTpl((s) => !s)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: showTpl ? '#475569' : '#6366f1' }}>
          {showTpl ? t('se.no.hide') : t('se.no.customize')}
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>
        {t('se.no.placeholders')} <code>{'{salon} {customer} {service} {date} {time} {technician} {total} {duration} {addons}'}</code>
      </p>

      {showTpl && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12, padding: 14, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1' }}>{t('se.no.customerEmail')}</div>
          <Field label={t('se.no.subject')}><input style={ui.input} value={f.emailSubjectCustomer} onChange={(e) => setF({ ...f, emailSubjectCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.intro')}><textarea style={{ ...ui.input, minHeight: 60, resize: 'vertical' }} value={f.emailIntroCustomer} onChange={(e) => setF({ ...f, emailIntroCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.footer')}><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailFooter} onChange={(e) => setF({ ...f, emailFooter: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>{t('se.no.adminEmailTpl')}</div>
          <Field label={t('se.no.subject')}><input style={ui.input} value={f.emailSubjectAdmin} onChange={(e) => setF({ ...f, emailSubjectAdmin: e.target.value })} /></Field>
          <Field label={t('se.no.intro')}><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailIntroAdmin} onChange={(e) => setF({ ...f, emailIntroAdmin: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>{t('se.no.smsText')}</div>
          <Field label={t('se.no.toCustomer')}><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsCustomer} onChange={(e) => setF({ ...f, smsCustomer: e.target.value })} /></Field>
          <Field label={t('se.no.toAdmin')}><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsAdmin} onChange={(e) => setF({ ...f, smsAdmin: e.target.value })} /></Field>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {t('se.no.tplNote')}
          </div>
        </div>
      )}

      {/* Email sending — Amelia-style: pick a Mail service, then shared sender fields,
          then only the chosen provider's fields show below. */}
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>{t('se.no.emailSending')}</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
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
        <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 12, marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
          {t('se.no.autoInfo')}
          <div style={{ marginTop: 8, color: '#cbd5e1' }}>
            {t('se.no.previewInbox')}<br />
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{f.senderName || t('se.no.yourSalonName')}</span>{' '}
            <span style={{ color: '#64748b' }}>&lt;notifications@lumio-booking&gt;</span><br />
            <span style={{ color: '#64748b' }}>{t('se.no.replyTo')}: {f.replyTo || f.senderEmail || 'your@email'}</span>
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
      <div style={{ marginTop: 12, padding: 14, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1' }}>
          {t('se.no.brevoSetup')}{' '}
          {n.brevo.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.no.keySaved')}</span>}
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 10px' }}>
          {t('se.no.brevoHelp')}
        </p>
        <Field label={t('se.no.brevoKey')}><input style={ui.input} type="password" value={brevo.apiKey} onChange={(e) => setBrevo({ ...brevo, apiKey: e.target.value })} placeholder={n.brevo.connected ? t('se.no.saved') : 'xkeysib-…'} /></Field>
      </div>
      )}

      {f.mailService === 'gmail' && (
      <>
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>
        {t('se.no.connectGmail')}{' '}
        {n.gmail?.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.no.connectedAs').replace('{email}', n.gmail.senderEmail)}</span>}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
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
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>
        {t('se.no.gmailPublishTip')}
      </p>
      </>
      )}

      {f.mailService === 'smtp' && (
      <>
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>
        {t('se.no.smtpServer')}{' '}
        {n.smtp.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.pay.connected')}</span>}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.smtpHelp')}
      </p>
      <div style={{ background: '#3f2d0e', color: '#fde68a', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}>
        {t('se.no.smtpWarn')}
      </div>
      <button
        type="button"
        onClick={() => setSmtp({ ...smtp, host: 'smtp.gmail.com', secure: 'ssl', port: 465 })}
        style={{ ...ui.input, width: 'auto', cursor: 'pointer', marginBottom: 10, background: '#1e293b' }}
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
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontSize: 13, cursor: 'pointer' }}>
          {test.kind === 'sending' ? t('se.no.sending') : t('se.no.sendTest')}
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>{t('se.no.testHint')}</span>
      </div>
      {test.kind === 'ok' && <div style={{ marginTop: 8, color: '#22c55e', fontSize: 13 }}>✓ {test.msg}</div>}
      {test.kind === 'err' && <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13, wordBreak: 'break-word' }}>✕ {test.msg}</div>}

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>
        {t('se.no.smsGateway')}{' '}
        {n.twilio.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>{t('se.pay.connected')}</span>}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        {t('se.no.twilioHelp')}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
        <Field label={t('se.no.accountSid')}><input style={ui.input} value={tw.accountSid} onChange={(e) => setTw({ ...tw, accountSid: e.target.value })} placeholder="AC…" /></Field>
        <Field label={t('se.no.authToken')}><input style={ui.input} type="password" value={tw.authToken} onChange={(e) => setTw({ ...tw, authToken: e.target.value })} placeholder={n.twilio.connected ? t('se.no.saved') : t('se.no.authToken')} /></Field>
        <Field label={t('se.no.fromNumber')}><input style={ui.input} value={tw.fromNumber} onChange={(e) => setTw({ ...tw, fromNumber: e.target.value })} placeholder="+1…" /></Field>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 10 }}>
        <Field label={t('se.no.smsTestTo')}><input style={ui.input} value={smsTo} onChange={(e) => setSmsTo(e.target.value)} placeholder="+1…" /></Field>
        <button
          style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' }}
          disabled={smsTest.kind === 'sending'}
          onClick={sendTestSms}
        >{smsTest.kind === 'sending' ? t('se.no.sending') : t('se.no.smsTestBtn')}</button>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '6px 0 0' }}>{t('se.no.smsTestHint')}</p>
      {smsTest.kind === 'ok' && <p style={{ color: '#22c55e', fontSize: 13, margin: '4px 0 0' }}>{smsTest.msg}</p>}
      {smsTest.kind === 'err' && <p style={{ color: '#ef4444', fontSize: 13, margin: '4px 0 0' }}>{smsTest.msg}</p>}

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('notifications', { ...f, smtp, brevo, gmail, twilio: tw }, 'Notifications')}>{t('se.no.save')}</button>
    </Card>
  );
}

function BrandingSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [f, setF] = useState(data.branding);
  return (
    <Card title={t('se.br.title')} desc={t('se.br.desc')}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
        <Field label={t('se.br.accent')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} style={{ width: 44, height: 38, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            <input style={ui.input} value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} />
          </div>
        </Field>
        <Field label={t('se.br.logo')}><input style={ui.input} value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('branding', f, 'Branding')}>{t('se.br.save')}</button>
    </Card>
  );
}
