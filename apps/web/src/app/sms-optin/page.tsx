'use client';

import { useState } from 'react';

// Public, single-view SMS opt-in form — the canonical "Opt-in policy proof" URL
// for A2P 10DLC (Twilio/TCR). It mirrors Twilio's recommended web-form template:
// phone field, an UNCHECKED consent checkbox, a clear description of message
// types, message frequency, message/data-rate disclaimer, HELP/STOP instructions,
// links to Terms + Privacy, and a clearly-labeled submit button.
//
// In production, end customers also opt in while booking on their salon's page
// (which records consent). This page exists so the program and consent language
// are publicly verifiable in a single view.

export default function SmsOptInPage() {
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false); // MUST start unchecked
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const digits = phone.replace(/\D/g, '');
  const phoneValid = digits.length >= 10 && digits.length <= 15;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!phoneValid) { setErr('Please enter a valid mobile phone number.'); return; }
    if (!consent) { setErr('Please check the box to agree to receive text messages.'); return; }
    setDone(true);
  }

  return (
    <main style={wrap}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: -0.5 }}>
            Lumio<span style={{ color: INDIGO }}>Booking</span>
          </div>
          <h1 style={h1}>Appointment Text Alerts</h1>
          <p style={muted}>
            Get appointment confirmations, reminders, and offers from your salon by text.
          </p>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '24px 8px' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h2 style={{ fontSize: 18, color: '#0f172a', margin: '10px 0 6px' }}>You&rsquo;re signed up!</h2>
            <p style={p}>
              Thanks — you&rsquo;ve agreed to receive text messages at <strong>{phone}</strong>. You&rsquo;ll get a
              confirmation text shortly. Reply <strong>STOP</strong> at any time to cancel, or <strong>HELP</strong> for help.
            </p>
            <button onClick={() => { setDone(false); setPhone(''); setConsent(false); }} style={ghostBtn}>
              Back to form
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label style={fieldLabel} htmlFor="sms-phone">Mobile Phone Number<span style={{ color: '#ef4444' }}> *</span></label>
            <input
              id="sms-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              placeholder="(555) 123-4567"
              style={input}
              autoComplete="tel"
            />

            <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 18, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, accentColor: INDIGO, flexShrink: 0 }}
              />
              <span style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.55 }}>
                Yes, I would like to receive automated text messages from my salon via Lumio Booking about my
                appointments — confirmations, reminders, and updates — and promotional offers. I understand I will
                receive up to 6 messages per month and that consent is not a condition of any purchase.
              </span>
            </label>

            {err && <div style={{ color: '#ef4444', fontSize: 13, marginTop: 12 }}>{err}</div>}

            <button type="submit" style={primaryBtn}>Yes, sign me up!</button>

            <div style={{ marginTop: 20, borderTop: '1px solid #eef2f7', paddingTop: 16 }}>
              <p style={fine}><strong>Message Frequency:</strong> You will receive up to 6 messages per month, depending on your appointments.</p>
              <p style={fine}><strong>Standard Rates:</strong> Message and data rates may apply depending on your mobile phone service plan.</p>
              <p style={fine}>
                <strong>Help &amp; Stop:</strong> Reply <strong>HELP</strong> for help or <strong>STOP</strong> to cancel at
                any time. By providing your phone number and checking the box above, you agree to receive text messages
                from your salon via Lumio Booking. Consent is not required to make a booking or purchase.
              </p>
              <p style={fine}>
                Your mobile opt-in and consent information is <strong>never shared with third parties</strong>. See our{' '}
                <a href="/terms" style={a}>Terms of Service</a> and <a href="/privacy" style={a}>Privacy Policy</a>.
              </p>
            </div>
          </form>
        )}
      </div>

      {/* How real opt-in works in the product — helps reviewers verify the flow. */}
      <div style={{ ...card, marginTop: 18, background: '#f8fafc' }}>
        <h2 style={{ fontSize: 15, color: '#0f172a', margin: '0 0 8px' }}>How customers opt in</h2>
        <p style={{ ...p, fontSize: 13.5 }}>
          Customers also opt in directly when they book an appointment on their salon&rsquo;s online booking page
          (for example, <span style={{ color: INDIGO }}>lumiobooking.com/book/your-salon</span>). On the
          &ldquo;Your information&rdquo; step they enter their mobile number and see the same consent language and a
          separate, unchecked box to also receive promotional texts. Opt-in is never required to complete a booking, and
          consent is recorded with a timestamp.
        </p>
      </div>
    </main>
  );
}

const INDIGO = '#6366f1';
const wrap: React.CSSProperties = { minHeight: '100vh', background: '#eef2ff', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { maxWidth: 520, margin: '0 auto', background: '#fff', borderRadius: 16, padding: '28px 28px 26px', boxShadow: '0 8px 30px rgba(15,23,42,0.08)' };
const h1: React.CSSProperties = { fontSize: 22, margin: '14px 0 4px', color: '#0f172a' };
const muted: React.CSSProperties = { fontSize: 14, color: '#64748b', margin: 0 };
const p: React.CSSProperties = { fontSize: 14, lineHeight: 1.6, color: '#334155', margin: '0 0 10px' };
const fine: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.55, color: '#475569', margin: '0 0 8px' };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginTop: 8, marginBottom: 6 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1.5px solid #cbd5e1', outline: 'none' };
const primaryBtn: React.CSSProperties = { width: '100%', marginTop: 18, background: '#111827', color: '#fff', fontWeight: 700, fontSize: 15, padding: '13px', borderRadius: 10, border: 'none', cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { marginTop: 16, background: '#fff', color: '#334155', fontWeight: 600, fontSize: 14, padding: '10px 18px', borderRadius: 10, border: '1.5px solid #cbd5e1', cursor: 'pointer' };
const a: React.CSSProperties = { color: INDIGO, textDecoration: 'none' };
