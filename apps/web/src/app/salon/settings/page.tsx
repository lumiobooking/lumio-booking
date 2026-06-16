'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useIsMobile } from '../../../lib/responsive';

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
    mailService: 'off' | 'smtp' | 'brevo'; replyTo: string;
    senderName: string; senderEmail: string; adminEmail: string; adminPhone: string;
    emailCustomerOnBooking: boolean; emailAdminOnBooking: boolean;
    smsCustomerOnBooking: boolean; smsAdminOnBooking: boolean;
    emailSubjectCustomer: string; emailIntroCustomer: string;
    emailSubjectAdmin: string; emailIntroAdmin: string; emailFooter: string;
    smsCustomer: string; smsAdmin: string;
    smtp: { host: string; port: number; user: string; fromEmail: string; secure: 'ssl' | 'tls' | 'none'; connected: boolean };
    brevo: { senderEmail: string; senderName: string; connected: boolean };
    twilio: { accountSid: string; fromNumber: string; connected: boolean };
  };
  pos?: { taxRatePercent: number; receiptFooter: string; primaryCardGateway: string; transferInstructions: string; transferQrUrl: string };
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
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
  { id: 'branding', label: 'Branding', icon: '🎨', desc: 'Colors & logo' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
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
      setSavedMsg(`${label} saved ✓`);
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
  }

  if (loading) return <section><h1 style={{ fontSize: 24 }}>Settings</h1><p style={{ color: '#94a3b8' }}>Loading…</p></section>;
  if (!data) {
    return (
      <section>
        <h1 style={{ fontSize: 24 }}>Settings</h1>
        {error && <div style={ui.banner}>{error}</div>}
        <p style={{ color: '#94a3b8' }}>Could not load settings. Make sure the backend was restarted.</p>
      </section>
    );
  }

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>Settings</h1>
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
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.desc}</div>
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
  return <label style={{ display: 'block' }}><span style={ui.label}>{label}</span>{children}</label>;
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

function CompanySection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [f, setF] = useState(data.company);
  return (
    <Card title="Company" desc="Your salon identity and contact details.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Salon name"><input style={ui.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Timezone"><input style={ui.input} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="America/New_York" /></Field>
        <Field label="Contact email"><input style={ui.input} value={f.contactEmail ?? ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label="Contact phone"><input style={ui.input} value={f.contactPhone ?? ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label="Address"><input style={ui.input} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Website"><input style={ui.input} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('company', f, 'Company')}>Save company</button>
    </Card>
  );
}

function HoursSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [hours, setHours] = useState<DayHours[]>(data.booking.businessHours);
  function upd(day: number, patch: Partial<DayHours>) { setHours((p) => p.map((h, i) => (i === day ? { ...h, ...patch } : h))); }
  return (
    <Card title="Business hours" desc="When your salon is open. Customers can only book within these hours.">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DAY_ORDER.map((day) => {
          const h = hours[day];
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ width: 42, fontSize: 13, color: '#cbd5e1' }}>{DAY_NAMES[day]}</span>
              <Toggle on={!h.closed} onChange={(open) => upd(day, { closed: !open })} label="" />
              {h.closed ? <span style={{ color: '#64748b', fontSize: 13 }}>Closed</span> : (
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
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', { businessHours: hours }, 'Business hours')}>Save hours</button>
    </Card>
  );
}

function DaysOffSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [days, setDays] = useState<string[]>(data.booking.daysOff);
  const [newDay, setNewDay] = useState('');
  function add() { if (newDay && !days.includes(newDay)) { setDays([...days, newDay].sort()); setNewDay(''); } }
  return (
    <Card title="Days off" desc="Holidays or closures — no bookings can be made on these dates.">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        {days.length === 0 && <span style={{ color: '#64748b', fontSize: 13 }}>None.</span>}
        {days.map((d) => (
          <span key={d} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f172a', border: '1px solid #334155', borderRadius: 999, padding: '4px 10px', fontSize: 13 }}>
            {d}
            <button onClick={() => setDays(days.filter((x) => x !== d))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 14 }}>×</button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input style={{ ...ui.input, width: 200 }} type="date" value={newDay} onChange={(e) => setNewDay(e.target.value)} />
        <button style={{ ...ui.primaryBtn, padding: '9px 14px' }} onClick={add}>+ Add</button>
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', { daysOff: days }, 'Days off')}>Save days off</button>
    </Card>
  );
}

function RulesSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [f, setF] = useState(data.booking);
  return (
    <Card title="Booking rules" desc="How customers can book.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Time slot step">
          <select style={ui.input} value={f.slotStepMinutes} onChange={(e) => setF({ ...f, slotStepMinutes: Number(e.target.value) })}>
            {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
        </Field>
        <Field label="Booking window (days ahead)">
          <input style={ui.input} type="number" min={1} max={365} value={f.maxAdvanceDays} onChange={(e) => setF({ ...f, maxAdvanceDays: Number(e.target.value) })} />
        </Field>
        <Field label="Min hours before booking">
          <input style={ui.input} type="number" min={0} max={168} value={f.minLeadHours} onChange={(e) => setF({ ...f, minLeadHours: Number(e.target.value) })} />
        </Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Toggle on={f.allowCustomerChooseStaff} onChange={(v) => setF({ ...f, allowCustomerChooseStaff: v })} label="Let customers choose their technician" />
      </div>

      <div style={{ marginTop: 14, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Staff assignment</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 8px' }}>When a customer doesn’t pick a technician:</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <RadioRow checked={f.assignmentMode === 'none'} onClick={() => setF({ ...f, assignmentMode: 'none' })}
          title="No assignment" desc="Leave the booking unassigned — the salon assigns a technician manually." />
        <RadioRow checked={f.assignmentMode === 'auto'} onClick={() => setF({ ...f, assignmentMode: 'auto' })}
          title="Auto-assign (round-robin)" desc="The system rotates fairly among available technicians using skill, schedule, workload and rejection history." />
      </div>

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('booking', f, 'Booking rules')}>Save rules</button>
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

  return (
    <Card title="Payments" desc="Currency, price display, accepted methods, and online gateways.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Currency">
          <select style={ui.input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Custom symbol (optional)">
          <input style={ui.input} value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder={SYMBOLS[currency] ?? currency} />
        </Field>
        <Field label="Symbol position">
          <select style={ui.input} value={position} onChange={(e) => setPosition(e.target.value as 'before' | 'after')}>
            <option value="before">Before — {previewPrice(10, currency, symbol, 'before', decimals)}</option>
            <option value="after">After — {previewPrice(10, currency, symbol, 'after', decimals)}</option>
          </select>
        </Field>
        <Field label="Decimals">
          <select style={ui.input} value={decimals} onChange={(e) => setDecimals(Number(e.target.value))}>
            {[0, 1, 2, 3].map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6 }}>
        Price preview: <strong style={{ color: '#e2e8f0' }}>{previewPrice(35, currency, symbol, position, decimals)}</strong>
      </div>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Accept in-person</div>
      <Toggle on={onSite} onChange={setOnSite} label="Pay at the salon (cash / card on-site)" />

      <Field label="Default payment method (pre-selected at checkout)">
        <select style={{ ...ui.input, maxWidth: 260, marginTop: 6 }} value={defaultMethod} onChange={(e) => setDefaultMethod(e.target.value as 'online' | 'onsite')}>
          <option value="onsite">Pay at the salon</option>
          <option value="online">Pay online</option>
        </select>
      </Field>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Online payment gateways</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        Connect any gateway so customers can pay when booking. Secret keys are stored securely and never shown again.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {GATEWAYS.map((g) => {
          const e = gw[g.id];
          const connected = data.gateways?.[g.id]?.connected;
          return (
            <div key={g.id} style={{ border: `1px solid ${e.enabled ? '#6366f1' : '#334155'}`, borderRadius: 10, padding: 14, background: '#0f172a' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>
                    {g.name}{' '}
                    {connected && <span style={{ color: '#22c55e', fontSize: 12, fontWeight: 600 }}>● Connected</span>}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 12 }}>{g.desc}</div>
                </div>
                <Toggle on={e.enabled} onChange={(v) => upd(g.id, { enabled: v })} label="" />
              </div>
              {e.enabled && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                  <Field label={g.apiLabel}>
                    <input style={ui.input} value={e.apiKey} onChange={(ev) => upd(g.id, { apiKey: ev.target.value })} placeholder={g.apiLabel} />
                  </Field>
                  <Field label={g.secretLabel}>
                    <input style={ui.input} type="password" value={e.secret} onChange={(ev) => upd(g.id, { secret: ev.target.value })} placeholder={connected ? '•••••••• (saved — leave blank to keep)' : g.secretLabel} />
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        style={{ ...ui.primaryBtn, marginTop: 16 }}
        onClick={() => onSave('payments', { currency, currencySymbol: symbol, symbolPosition: position, priceDecimals: decimals, defaultPaymentMethod: defaultMethod, onSiteEnabled: onSite, gateways: gw }, 'Payments')}
      >
        Save payments
      </button>

      {/* Which connected gateway the POS "Card" button charges through. */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Primary card channel (POS)</div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
          When a cashier taps “Card” at the register, charge through this gateway. Enable & save the gateway above first.
        </p>
        <PrimaryCardChannel data={data} onSave={onSave} />
      </div>

      {/* Bank transfer details shown to the customer at checkout (manual confirm). */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Bank transfer (manual)</div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
          Shown to the customer when they choose “Transfer” at the register. The cashier confirms once the money arrives.
        </p>
        <BankTransferConfig data={data} onSave={onSave} />
      </div>
    </Card>
  );
}

function PrimaryCardChannel({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [sel, setSel] = useState(data.pos?.primaryCardGateway ?? '');
  const enabled = GATEWAYS.filter((g) => data.gateways?.[g.id]?.enabled);
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <select style={{ ...ui.input, maxWidth: 300 }} value={sel} onChange={(e) => setSel(e.target.value)}>
        <option value="">— None (cashier confirms manually) —</option>
        {enabled.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button style={ui.primaryBtn} onClick={() => onSave('pos', { primaryCardGateway: sel }, 'Card channel')}>Save channel</button>
      {enabled.length === 0 && <span style={{ color: '#94a3b8', fontSize: 12 }}>Enable & save a gateway above first.</span>}
    </div>
  );
}

function BankTransferConfig({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [text, setText] = useState(data.pos?.transferInstructions ?? '');
  const [qr, setQr] = useState(data.pos?.transferQrUrl ?? '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Field label="Transfer details (bank / account / Zelle / Interac email)">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder={'e.g.\nBank of America — Lumio Nails\nAccount: 1234567890\nZelle: pay@lumionails.com'}
          style={{ ...ui.input, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <Field label="QR image URL (optional — customer scans to pay)">
        <input style={ui.input} value={qr} onChange={(e) => setQr(e.target.value)} placeholder="https://… (paste a QR image link)" />
      </Field>
      <div>
        <button style={ui.primaryBtn} onClick={() => onSave('pos', { transferInstructions: text, transferQrUrl: qr }, 'Bank transfer')}>
          Save transfer details
        </button>
      </div>
    </div>
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
  const { token } = useAuth();
  const [test, setTest] = useState<{ kind: 'idle' | 'sending' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });

  const sendTest = async () => {
    setTest({ kind: 'sending' });
    try {
      const r = await apiFetch<{ ok: boolean; to?: string; error?: string }>('/settings/notifications/test', { method: 'POST', token });
      if (r.ok) setTest({ kind: 'ok', msg: `Test email sent to ${r.to}. Check the inbox (and Spam).` });
      else setTest({ kind: 'err', msg: r.error || 'Failed to send.' });
    } catch (e) {
      setTest({ kind: 'err', msg: e instanceof Error ? e.message : 'Request failed' });
    }
  };

  return (
    <Card title="Notifications" desc="Who gets notified when a booking is made, by email and SMS.">
      <div style={{ marginTop: 0, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>When a booking is made</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6 }}>
        <Toggle on={f.emailCustomerOnBooking} onChange={(v) => setF({ ...f, emailCustomerOnBooking: v })} label="Email the customer" />
        <Toggle on={f.emailAdminOnBooking} onChange={(v) => setF({ ...f, emailAdminOnBooking: v })} label="Email the salon (admin)" />
        <Toggle on={f.smsCustomerOnBooking} onChange={(v) => setF({ ...f, smsCustomerOnBooking: v })} label="SMS the customer" />
        <Toggle on={f.smsAdminOnBooking} onChange={(v) => setF({ ...f, smsAdminOnBooking: v })} label="SMS the salon (admin)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="Admin notification email"><input style={ui.input} value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} placeholder="owner@salon.com" /></Field>
        <Field label="Admin notification phone"><input style={ui.input} value={f.adminPhone} onChange={(e) => setF({ ...f, adminPhone: e.target.value })} placeholder="+1…" /></Field>
      </div>

      <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Message templates</div>
        <button onClick={() => setShowTpl((s) => !s)} style={{ ...ui.primaryBtn, padding: '6px 12px', fontSize: 12, background: showTpl ? '#475569' : '#6366f1' }}>
          {showTpl ? 'Hide' : 'Customize'}
        </button>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 0' }}>
        Placeholders: <code>{'{salon} {customer} {service} {date} {time} {technician} {total} {duration} {addons}'}</code>
      </p>

      {showTpl && (
        <div style={{ display: 'grid', gap: 12, marginTop: 12, padding: 14, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1' }}>Customer email</div>
          <Field label="Subject"><input style={ui.input} value={f.emailSubjectCustomer} onChange={(e) => setF({ ...f, emailSubjectCustomer: e.target.value })} /></Field>
          <Field label="Intro message"><textarea style={{ ...ui.input, minHeight: 60, resize: 'vertical' }} value={f.emailIntroCustomer} onChange={(e) => setF({ ...f, emailIntroCustomer: e.target.value })} /></Field>
          <Field label="Footer (closing note)"><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailFooter} onChange={(e) => setF({ ...f, emailFooter: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>Admin email</div>
          <Field label="Subject"><input style={ui.input} value={f.emailSubjectAdmin} onChange={(e) => setF({ ...f, emailSubjectAdmin: e.target.value })} /></Field>
          <Field label="Intro message"><textarea style={{ ...ui.input, minHeight: 50, resize: 'vertical' }} value={f.emailIntroAdmin} onChange={(e) => setF({ ...f, emailIntroAdmin: e.target.value })} /></Field>

          <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>SMS text</div>
          <Field label="To customer"><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsCustomer} onChange={(e) => setF({ ...f, smsCustomer: e.target.value })} /></Field>
          <Field label="To admin"><textarea style={{ ...ui.input, minHeight: 44, resize: 'vertical' }} value={f.smsAdmin} onChange={(e) => setF({ ...f, smsAdmin: e.target.value })} /></Field>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            The email body automatically includes a branded details card (service, date, time, technician, total). Your intro/footer wrap around it.
          </div>
        </div>
      )}

      {/* Email sending — Amelia-style: pick a Mail service, then shared sender fields,
          then only the chosen provider's fields show below. */}
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Email sending</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        Choose how this salon sends emails, fill the fields, then use “Send test email” to confirm it works.
      </p>
      <Field label="Mail service">
        <select style={ui.input} value={f.mailService} onChange={(e) => setF({ ...f, mailService: e.target.value as 'off' | 'smtp' | 'brevo' })}>
          <option value="off">Off — don’t send emails</option>
          <option value="brevo">Brevo (HTTPS API — recommended)</option>
          <option value="smtp">SMTP server (Gmail, Outlook, your own…)</option>
        </select>
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <Field label="Sender name *"><input style={ui.input} value={f.senderName} onChange={(e) => setF({ ...f, senderName: e.target.value })} placeholder="Your salon name" /></Field>
        <Field label="Sender email *"><input style={ui.input} value={f.senderEmail} onChange={(e) => setF({ ...f, senderEmail: e.target.value })} placeholder="bookings@yoursalon.com" /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Reply-to email (optional)"><input style={ui.input} value={f.replyTo} onChange={(e) => setF({ ...f, replyTo: e.target.value })} placeholder="where customer replies go (defaults to sender)" /></Field>
      </div>

      {f.mailService === 'brevo' && (
      <div style={{ marginTop: 12, padding: 14, background: '#0f172a', borderRadius: 10, border: '1px solid #334155' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#cbd5e1' }}>
          Brevo setup{' '}
          {n.brevo.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>● Key saved</span>}
        </div>
        <p style={{ color: '#64748b', fontSize: 12, margin: '4px 0 10px' }}>
          Free 300 emails/day, delivers reliably from the cloud. Sign up at <strong>brevo.com</strong>, verify the <strong>Sender email</strong> above, then create an API key and paste it here.
        </p>
        <Field label="Brevo API key"><input style={ui.input} type="password" value={brevo.apiKey} onChange={(e) => setBrevo({ ...brevo, apiKey: e.target.value })} placeholder={n.brevo.connected ? '•••••• (saved)' : 'xkeysib-…'} /></Field>
      </div>
      )}

      {f.mailService === 'smtp' && (
      <>
      <div style={{ marginTop: 18, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>
        Email sending (SMTP server){' '}
        {n.smtp.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>● Connected</span>}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        Alternative if you don’t use Brevo. For Gmail: enable 2-step verification, create an <strong>App Password</strong>, and paste it below.
        Host smtp.gmail.com · Port 465. The password is stored securely and never shown again.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="SMTP host"><input style={ui.input} value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.gmail.com" /></Field>
        <Field label="Port"><input style={ui.input} type="number" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} placeholder="465" /></Field>
        <Field label="Username (email)"><input style={ui.input} value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} placeholder="you@yoursalon.com" /></Field>
        <Field label="Password"><input style={ui.input} type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} placeholder={n.smtp.connected ? '•••••• (saved)' : 'mailbox or app password'} /></Field>
        <Field label="Encryption">
          <select style={ui.input} value={smtp.secure}
            onChange={(e) => { const v = e.target.value as 'ssl' | 'tls' | 'none'; setSmtp({ ...smtp, secure: v, port: v === 'ssl' ? 465 : v === 'tls' ? 587 : 25 }); }}>
            <option value="ssl">SSL (port 465)</option>
            <option value="tls">TLS / STARTTLS (port 587)</option>
            <option value="none">None (port 25)</option>
          </select>
        </Field>
      </div>
      </>
      )}

      {/* Diagnostics: verify the chosen email provider actually works. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" onClick={sendTest} disabled={test.kind === 'sending'}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #6366f1', background: 'transparent', color: '#a5b4fc', fontSize: 13, cursor: 'pointer' }}>
          {test.kind === 'sending' ? 'Sending…' : 'Send test email'}
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>Save your settings first, then test. The test goes to your admin email.</span>
      </div>
      {test.kind === 'ok' && <div style={{ marginTop: 8, color: '#22c55e', fontSize: 13 }}>✓ {test.msg}</div>}
      {test.kind === 'err' && <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13, wordBreak: 'break-word' }}>✕ {test.msg}</div>}

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>
        SMS gateway (Twilio){' '}
        {n.twilio.connected && <span style={{ color: '#22c55e', fontSize: 12 }}>● Connected</span>}
      </div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>
        Connect Twilio to send real SMS. The auth token is stored securely and never shown again.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Field label="Account SID"><input style={ui.input} value={tw.accountSid} onChange={(e) => setTw({ ...tw, accountSid: e.target.value })} placeholder="AC…" /></Field>
        <Field label="Auth token"><input style={ui.input} type="password" value={tw.authToken} onChange={(e) => setTw({ ...tw, authToken: e.target.value })} placeholder={n.twilio.connected ? '•••••• (saved)' : 'Auth token'} /></Field>
        <Field label="From number"><input style={ui.input} value={tw.fromNumber} onChange={(e) => setTw({ ...tw, fromNumber: e.target.value })} placeholder="+1…" /></Field>
      </div>

      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('notifications', { ...f, smtp, brevo, twilio: tw }, 'Notifications')}>Save notifications</button>
    </Card>
  );
}

function BrandingSection({ data, onSave }: { data: SettingsData; onSave: SaveFn }) {
  const [f, setF] = useState(data.branding);
  return (
    <Card title="Branding" desc="How your public booking page looks.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
        <Field label="Accent color">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="color" value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} style={{ width: 44, height: 38, border: 'none', background: 'transparent', cursor: 'pointer' }} />
            <input style={ui.input} value={f.accentColor} onChange={(e) => setF({ ...f, accentColor: e.target.value })} />
          </div>
        </Field>
        <Field label="Logo URL (optional)"><input style={ui.input} value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://…" /></Field>
      </div>
      <button style={{ ...ui.primaryBtn, marginTop: 16 }} onClick={() => onSave('branding', f, 'Branding')}>Save branding</button>
    </Card>
  );
}
