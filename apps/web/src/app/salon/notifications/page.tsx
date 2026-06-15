'use client';

// ===========================================================================
// Notifications — Amelia-style template manager.
//  • Templates tab: per-event email/SMS templates the salon can edit, grouped
//    by audience (customer / staff) with a live preview and placeholder chips.
//  • History tab: the log of messages actually sent.
// The delivery connection (sender, admin contacts, SMTP, Twilio) lives in
// Settings → Notifications; this page is purely about the message content.
// ===========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useIsMobile } from '../../../lib/responsive';

interface Tpl {
  enabled: boolean; email: boolean; sms: boolean;
  subject: string; body: string; smsBody: string; offsetHours: number;
}
type Templates = Record<string, Tpl>;
type Audience = 'customer' | 'staff';
type Scheduled = 'before' | 'after' | 'day';

interface CatalogItem {
  id: string; audience: Audience; group: string; label: string; desc: string; scheduled?: Scheduled;
}

// Stable ids must match the backend default catalog.
const CATALOG: CatalogItem[] = [
  { id: 'customer_booking_confirmed', audience: 'customer', group: 'Booking', label: 'Booking confirmed', desc: 'Sent right after a booking is confirmed. Drives the live confirmation email/SMS.' },
  { id: 'customer_booking_pending', audience: 'customer', group: 'Booking', label: 'Booking received (pending)', desc: 'Sent when a booking is received and awaiting confirmation.' },
  { id: 'customer_booking_cancelled', audience: 'customer', group: 'Booking', label: 'Booking cancelled', desc: 'Sent when a booking is cancelled.' },
  { id: 'customer_booking_rescheduled', audience: 'customer', group: 'Booking', label: 'Rescheduled', desc: 'Sent when the date or time changes.' },
  { id: 'customer_reminder', audience: 'customer', group: 'Reminders & care', label: 'Appointment reminder', desc: 'A reminder sent before the appointment.', scheduled: 'before' },
  { id: 'customer_followup', audience: 'customer', group: 'Reminders & care', label: 'Thank-you / follow-up', desc: 'A thank-you message sent after the visit.', scheduled: 'after' },
  { id: 'customer_birthday', audience: 'customer', group: 'Reminders & care', label: 'Birthday greeting', desc: 'A greeting sent on the customer’s birthday.', scheduled: 'day' },
  { id: 'customer_payment_receipt', audience: 'customer', group: 'Payment', label: 'Payment receipt', desc: 'A receipt sent after a payment is taken.' },
  { id: 'staff_new_booking', audience: 'staff', group: 'Staff alerts', label: 'New booking assigned', desc: 'Sent to the technician when a booking is assigned to them.' },
  { id: 'staff_booking_cancelled', audience: 'staff', group: 'Staff alerts', label: 'Booking cancelled', desc: 'Sent to the technician when their booking is cancelled.' },
  { id: 'staff_daily_agenda', audience: 'staff', group: 'Staff alerts', label: 'Daily schedule', desc: 'A next-day schedule summary for the technician.', scheduled: 'before' },
];

const PLACEHOLDERS = [
  '%customer_name%', '%salon_name%', '%service_name%', '%staff_name%',
  '%appointment_date%', '%appointment_time%', '%duration%', '%total_price%',
  '%add_ons%', '%salon_contact%', '%booking_id%',
];

const SAMPLE: Record<string, string> = {
  customer_name: 'Jane Smith', salon_name: 'Salon A — Demo Nails', service_name: 'Gel Manicure',
  staff_name: 'Tina', appointment_date: 'Mon, Jun 22, 2026', appointment_time: '5:30 PM',
  duration: '45 min', total_price: '$45.00', add_ons: 'Nail Art', salon_contact: '(587) 435-0838', booking_id: 'BK-1042',
};
function fillPct(s: string) { return s.replace(/%(\w+)%/g, (_m, k) => SAMPLE[k] ?? `%${k}%`); }

export default function NotificationsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const [tab, setTab] = useState<'templates' | 'history'>('templates');
  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Notifications</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        Customize the email &amp; SMS messages your salon sends — and review what’s been delivered.
      </p>

      <div style={{ display: 'flex', gap: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 4, width: 'fit-content', margin: '16px 0 18px' }}>
        <TabBtn active={tab === 'templates'} onClick={() => setTab('templates')}>Templates</TabBtn>
        <TabBtn active={tab === 'history'} onClick={() => setTab('history')}>History</TabBtn>
      </div>

      {tab === 'templates' ? <TemplatesView token={token} /> : <HistoryView token={token} />}
    </section>
  );
}

/* ----------------------------- Templates ----------------------------- */

function TemplatesView({ token }: { token: string | null }) {
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [accent, setAccent] = useState('#6366f1');
  const [audience, setAudience] = useState<Audience>('customer');
  const [selectedId, setSelectedId] = useState<string>('customer_booking_confirmed');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const focusedRef = useRef<'subject' | 'body' | 'smsBody'>('body');
  const isMobile = useIsMobile();

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const s = await apiFetch<{ notificationTemplates: Templates; branding?: { accentColor: string } }>('/settings', { token });
      setTemplates(s.notificationTemplates ?? {});
      if (s.branding?.accentColor) setAccent(s.branding.accentColor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const items = CATALOG.filter((c) => c.audience === audience);
  const groups = [...new Set(items.map((i) => i.group))];
  const meta = CATALOG.find((c) => c.id === selectedId)!;
  const tpl = templates?.[selectedId];

  const patch = (field: keyof Tpl, value: Tpl[keyof Tpl]) => {
    setTemplates((prev) => (prev ? { ...prev, [selectedId]: { ...prev[selectedId], [field]: value } } : prev));
    setSaved(false);
  };

  const insert = (ph: string) => {
    if (!tpl) return;
    const which = focusedRef.current;
    // Rich-text body: insert at the caret inside the contentEditable.
    if (which === 'body') {
      const el = bodyRef.current;
      if (!el) return;
      el.focus();
      document.execCommand('insertText', false, ph);
      patch('body', el.innerHTML);
      return;
    }
    // Plain inputs (subject / SMS): splice at the caret.
    const el = which === 'subject' ? subjectRef.current : smsRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const cur = (tpl[which] as string) ?? '';
    const next = cur.slice(0, start) + ph + cur.slice(end);
    patch(which, next);
    requestAnimationFrame(() => { el.focus(); const pos = start + ph.length; el.setSelectionRange(pos, pos); });
  };

  const save = async () => {
    if (!token || !templates) return;
    setSaving(true); setError(null);
    try {
      await apiFetch('/settings/notification-templates', { method: 'PATCH', token, body: { templates } });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  if (loading || !templates) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  return (
    <div>
      {error && <div style={ui.banner}>{error}</div>}

      {/* audience tabs + save */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 3 }}>
          <SubTab active={audience === 'customer'} onClick={() => { setAudience('customer'); setSelectedId('customer_booking_confirmed'); }}>To customer</SubTab>
          <SubTab active={audience === 'staff'} onClick={() => { setAudience('staff'); setSelectedId('staff_new_booking'); }}>To staff</SubTab>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {saved && <span style={{ color: '#22c55e', fontSize: 13 }}>✓ Saved</span>}
          <button onClick={save} disabled={saving} style={ui.primaryBtn}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(240px, 300px) 1fr', gap: 16, alignItems: 'start' }}>
        {/* event list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map((g) => (
            <div key={g}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', margin: '0 0 6px 2px', fontWeight: 700 }}>{g}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.filter((i) => i.group === g).map((i) => {
                  const it = templates[i.id];
                  const active = selectedId === i.id;
                  return (
                    <button key={i.id} onClick={() => setSelectedId(i.id)}
                      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        border: `1px solid ${active ? '#6366f1' : '#334155'}`, background: active ? '#312e81' : '#1e293b' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{i.label}</span>
                        <Dot on={!!it?.enabled} />
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        {it?.email && <Badge>✉ Email</Badge>}
                        {it?.sms && <Badge>💬 SMS</Badge>}
                        {i.scheduled && <Badge>⏱ Scheduled</Badge>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* editor + preview */}
        {tpl && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
            <div style={{ ...ui.card, padding: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>{meta.label}</h2>
                  <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>{meta.desc}</p>
                </div>
                <Switch on={tpl.enabled} onChange={(v) => patch('enabled', v)} />
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '16px 0' }}>
                <Check label="Send Email" checked={tpl.email} onChange={(v) => patch('email', v)} />
                <Check label="Send SMS" checked={tpl.sms} onChange={(v) => patch('sms', v)} />
                {meta.scheduled && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
                    <span style={{ fontSize: 13, color: '#cbd5e1' }}>Send</span>
                    <input type="number" min={0} value={tpl.offsetHours}
                      onChange={(e) => patch('offsetHours', Math.max(0, Number(e.target.value)))}
                      style={{ ...ui.input, width: 70, padding: '6px 8px' }} />
                    <span style={{ fontSize: 13, color: '#cbd5e1' }}>
                      hours {meta.scheduled === 'after' ? 'after' : meta.scheduled === 'day' ? '(on the day)' : 'before'}
                    </span>
                  </div>
                )}
              </div>

              {/* Placeholder chips */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Click a placeholder to insert it into the focused field:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {PLACEHOLDERS.map((p) => (
                    <button key={p} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p)}
                      style={{ fontSize: 12, padding: '4px 9px', borderRadius: 999, border: '1px solid #475569', background: '#0f172a', color: '#a5b4fc', cursor: 'pointer' }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {tpl.email && (
                <>
                  <label style={ui.label}>Email subject</label>
                  <input ref={subjectRef} onFocus={() => (focusedRef.current = 'subject')}
                    value={tpl.subject} onChange={(e) => patch('subject', e.target.value)}
                    style={{ ...ui.input, marginBottom: 14 }} />

                  <label style={ui.label}>Email body</label>
                  <RichTextEditor editorRef={bodyRef} value={tpl.body}
                    onFocus={() => (focusedRef.current = 'body')}
                    onChange={(html) => patch('body', html)} />
                </>
              )}

              {tpl.sms && (
                <>
                  <label style={ui.label}>SMS text</label>
                  <textarea ref={smsRef} onFocus={() => (focusedRef.current = 'smsBody')}
                    value={tpl.smsBody} onChange={(e) => patch('smsBody', e.target.value)} rows={3}
                    style={{ ...ui.input, fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }} />
                  <div style={{ fontSize: 11, color: fillPct(tpl.smsBody).length > 160 ? '#f97316' : '#64748b', marginTop: 4 }}>
                    {fillPct(tpl.smsBody).length} characters {fillPct(tpl.smsBody).length > 160 ? '(over 1 SMS segment)' : ''}
                  </div>
                </>
              )}
              {!tpl.email && !tpl.sms && (
                <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>Enable Email or SMS above to edit this message.</p>
              )}
            </div>

            {/* Live preview */}
            <div>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.06em', color: '#64748b', margin: '0 0 8px 2px', fontWeight: 700 }}>Preview (sample data)</div>
              {tpl.email && <EmailPreview accent={accent} subject={fillPct(tpl.subject)} body={fillPct(tpl.body)} salon={SAMPLE.salon_name} contact={SAMPLE.salon_contact} />}
              {tpl.sms && <SmsPreview text={fillPct(tpl.smsBody)} salon={SAMPLE.salon_name} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmailPreview({ accent, subject, body, salon, contact }: { accent: string; subject: string; body: string; salon: string; contact: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', border: '1px solid #334155', maxWidth: 520 }}>
      <div style={{ background: '#0f172a', padding: '8px 12px', borderBottom: '1px solid #334155' }}>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>Subject</div>
        <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>{subject || '(empty subject)'}</div>
      </div>
      <div style={{ background: accent, padding: '18px 22px' }}>
        <div style={{ color: '#fff', fontSize: 17, fontWeight: 800 }}>{salon}</div>
      </div>
      <div style={{ padding: 22, color: '#374151', fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: body || '<em>(empty body)</em>' }} />
      <div style={{ background: '#f9fafb', padding: '12px 22px', color: '#9aa4b2', fontSize: 12, borderTop: '1px solid #eef0f4' }}>
        {salon} · {contact}
      </div>
    </div>
  );
}

function SmsPreview({ text, salon }: { text: string; salon: string }) {
  return (
    <div style={{ marginTop: 12, maxWidth: 520 }}>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>SMS from {salon}</div>
      <div style={{ display: 'inline-block', background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', padding: '10px 14px', borderRadius: '14px 14px 14px 4px', fontSize: 13, lineHeight: 1.5, maxWidth: '90%', whiteSpace: 'pre-wrap' }}>
        {text || '(empty message)'}
      </div>
    </div>
  );
}

/* ------------------------- Rich text editor ------------------------- */

function RichTextEditor({ editorRef, value, onChange, onFocus }: {
  editorRef: React.RefObject<HTMLDivElement>; value: string; onChange: (html: string) => void; onFocus: () => void;
}) {
  // Sync external value → editor only when it differs (e.g. switching templates),
  // so typing isn't interrupted. Plain-text (legacy) values are shown with breaks.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const incoming = value || '';
    const html = /<[a-z][\s\S]*>/i.test(incoming)
      ? incoming
      : incoming.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [value, editorRef]);

  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const Btn = ({ cmd, arg, title, children }: { cmd: string; arg?: string; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, arg)} style={tbBtn}>{children}</button>
  );
  const Sep = () => <span style={{ width: 1, background: '#334155', margin: '2px 4px' }} />;

  return (
    <div style={{ border: '1px solid #475569', borderRadius: 8, overflow: 'hidden', background: '#0f172a' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, padding: 6, borderBottom: '1px solid #334155', background: '#1e293b' }}>
        <Btn cmd="bold" title="Bold"><b>B</b></Btn>
        <Btn cmd="italic" title="Italic"><i>I</i></Btn>
        <Btn cmd="underline" title="Underline"><u>U</u></Btn>
        <Btn cmd="strikeThrough" title="Strikethrough"><s>S</s></Btn>
        <Sep />
        <Btn cmd="formatBlock" arg="h3" title="Heading">H</Btn>
        <Btn cmd="formatBlock" arg="p" title="Normal text">¶</Btn>
        <Sep />
        <Btn cmd="insertUnorderedList" title="Bullet list">• List</Btn>
        <Btn cmd="insertOrderedList" title="Numbered list">1. List</Btn>
        <Sep />
        <button type="button" title="Insert link" onMouseDown={(e) => e.preventDefault()}
          onClick={() => { const url = prompt('Link URL (https://…)'); if (url) exec('createLink', url); }} style={tbBtn}>🔗</button>
        <Btn cmd="removeFormat" title="Clear formatting">⨯</Btn>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={() => { if (editorRef.current) onChange(editorRef.current.innerHTML); }}
        onFocus={onFocus}
        style={{ minHeight: 190, padding: 14, color: '#e2e8f0', fontSize: 14, lineHeight: 1.6, outline: 'none' }}
      />
    </div>
  );
}
const tbBtn: React.CSSProperties = {
  minWidth: 30, height: 28, padding: '0 8px', borderRadius: 6, border: '1px solid #334155',
  background: '#0f172a', color: '#cbd5e1', fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

/* ----------------------------- History ----------------------------- */

interface NotificationRow {
  id: string; channel: string; recipient: string; subject: string | null; body: string;
  status: string; provider: string; sentAt: string | null; createdAt: string;
}
const COLORS: Record<string, string> = { SENT: '#22c55e', PENDING: '#eab308', FAILED: '#ef4444' };

function HistoryView({ token }: { token: string | null }) {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true); setError(null);
    apiFetch<NotificationRow[]>('/notifications', { token })
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [token]);

  if (error) return <div style={ui.banner}>{error}</div>;
  if (loading) return <p style={{ color: '#94a3b8' }}>Loading…</p>;

  return (
    <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>Sent</th><th style={ui.th}>Channel</th><th style={ui.th}>Recipient</th><th style={ui.th}>Message</th><th style={ui.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 && <tr><td style={ui.td} colSpan={5}>No messages sent yet.</td></tr>}
          {items.map((n) => (
            <tr key={n.id} style={{ borderTop: '1px solid #334155' }}>
              <td style={{ ...ui.td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(n.createdAt).toLocaleString()}</td>
              <td style={ui.td}>{n.channel}</td>
              <td style={{ ...ui.td, color: '#94a3b8' }}>{n.recipient}</td>
              <td style={ui.td}>
                {n.subject && <div style={{ fontWeight: 600 }}>{n.subject}</div>}
                <div style={{ color: '#94a3b8', fontSize: 13 }}>{n.body}</div>
              </td>
              <td style={ui.td}><span style={{ color: COLORS[n.status] ?? '#94a3b8', fontWeight: 600 }}>{n.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- small UI ----------------------------- */

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' }}>{children}</button>
  );
}
function SubTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: active ? '#334155' : 'transparent', color: active ? '#fff' : '#94a3b8' }}>{children}</button>
  );
}
function Badge({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, background: '#0f172a', border: '1px solid #334155', color: '#94a3b8' }}>{children}</span>;
}
function Dot({ on }: { on: boolean }) {
  return <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? '#22c55e' : '#475569', flexShrink: 0 }} />;
}
function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 42, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', background: on ? '#6366f1' : '#475569', position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${checked ? '#6366f1' : '#334155'}`, background: checked ? '#312e81' : '#1e293b', color: '#e2e8f0', fontSize: 13 }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${checked ? '#a5b4fc' : '#64748b'}`, background: checked ? '#6366f1' : 'transparent', display: 'grid', placeItems: 'center', fontSize: 11, color: '#fff' }}>{checked ? '✓' : ''}</span>
      {label}
    </button>
  );
}
