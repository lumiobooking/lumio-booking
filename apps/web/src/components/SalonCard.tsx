'use client';

/**
 * The salon card on the booking page — option B ("light, minimal").
 *
 * WHY IT CHANGED
 *
 * The old card was the salon name, the address and a raw phone number in small
 * white text on the brand gradient. On a pale brand colour the text barely
 * read, the address and phone did nothing when tapped, and a visitor on a
 * phone never saw them at all (the side cart is desktop-only).
 *
 * Now: a white card with a thin bar in the salon's colour, whether the shop is
 * open right now (from the hours the owner typed, on the SALON's clock), the
 * Google rating, the address, and three real buttons — Call, Directions,
 * Share — each 44px tall so a thumb hits it. Anything the salon has not filled
 * in is simply left out; nothing is invented.
 *
 * `compact` is the phone version shown above the services: the top bar there
 * already carries the logo and name, so the card keeps only what the bar lacks.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { bt, btf, bookLocale } from '../lib/i18n-book';
import { initialsOf, isInAppBrowser, mapsHref, mapsTarget, minutesInZone, nextOpening, openStatus, prettyPhone, smsShareHref, telHref, type OpenStatus } from '../lib/salon-card';
import { todayInZone } from '../lib/salon-clock';
import type { DayLike } from '../lib/opening-bar';

const INK = '#0f2a52';
const MUTED = '#52637a';

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  const n = m ? parseInt(m[1], 16) : 0x6366f1;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shade = (hex: string, amt: number) => '#' + rgb(hex).map((v) => Math.max(0, Math.round(v * (1 - amt))).toString(16).padStart(2, '0')).join('');
const tint = (hex: string, a: number) => `rgba(${rgb(hex).join(',')},${a})`;

function clock(min: number): string {
  return new Date(2000, 0, 1, Math.floor(min / 60), min % 60).toLocaleTimeString(bookLocale(), { hour: '2-digit', minute: '2-digit' });
}

function okLogo(u: string): boolean {
  // Same rule as the booking page's own logo (okImageUrl).
  return u.startsWith('https://') || u.startsWith('data:image/') || u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1');
}

const ICONS = {
  pin: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  nav: <path d="M3 11l18-8-8 18-2-8z" />,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
};
function Icon({ name, color, size = 16 }: { name: keyof typeof ICONS; color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {ICONS[name]}
    </svg>
  );
}

type Next = { inDays: number; at: number; date: Date } | null;

/**
 * The status line. Outside opening hours it never says just "Closed": on a
 * booking page that reads as "you can't book", which is false — the visitor
 * can book right now for a later time. So it says when the shop opens next and
 * adds a small "Book online 24/7" next to it.
 */
function StatusLine({ status, next }: { status: OpenStatus | null; next: Next }) {
  if (!status) return null;
  const closed = status.kind === 'closedNow' || status.kind === 'closedToday';
  const tone = status.kind === 'open' ? { c: '#15803d', dot: '#22c55e' } : status.kind === 'later' ? { c: '#b45309', dot: '#f59e0b' } : { c: '#475569', dot: '#94a3b8' };
  const text = status.kind === 'open' ? btf('Open · until {time}', { time: clock(status.until) })
    : status.kind === 'later' ? btf('Opens today {from} – {to}', { from: clock(status.at), to: clock(status.until) })
    : next ? (next.inDays === 1
        ? btf('Opens tomorrow at {time}', { time: clock(next.at) })
        : btf('Opens {day} at {time}', { day: next.date.toLocaleDateString(bookLocale(), { weekday: 'long' }), time: clock(next.at) }))
    : status.kind === 'closedNow' ? bt('Closed now') : bt('Closed today');
  return (
    <>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: tone.c, fontWeight: 700, whiteSpace: 'nowrap' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: tone.dot }} />{text}
      </span>
      {(closed || status.kind === 'later') && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#15803d', fontWeight: 600, whiteSpace: 'nowrap' }}>
          <Icon name="check" color="#15803d" size={13} />{bt('Book online 24/7')}
        </span>
      )}
    </>
  );
}

export interface SalonCardProps {
  name: string;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  logoScale?: number;
  rating?: { value: number; count: number } | null;
  accent: string;
  timezone?: string | null;
  /** Today's row of business hours, whether today is a day off, and the opening-line mode.
   *  `week` + `daysOff` let a closed shop say when it opens next. */
  today?: { day: DayLike | null | undefined; isDayOff: boolean; mode?: unknown; week?: (DayLike | null | undefined)[]; daysOff?: string[] };
  compact?: boolean;
}

export function SalonCard({ name, address, phone, logoUrl, logoScale, rating, accent, timezone, today, compact = false }: SalonCardProps) {
  // The status needs the clock, so it is worked out after mount (no server /
  // client mismatch) and refreshed every minute while the page stays open.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(minutesInZone(timezone));
    tick();
    const iv = window.setInterval(tick, 60_000);
    return () => window.clearInterval(iv);
  }, [timezone]);
  const [copied, setCopied] = useState(false);
  /** The share sheet of last resort: the link to copy by hand, by text, by email. */
  const [sheet, setSheet] = useState(false);
  // Where the page is open decides how the buttons behave (lib/salon-card.ts):
  // inside a salon's website (a frame), in an in-app browser, on a computer.
  const [env, setEnv] = useState({ framed: false, inApp: false, touch: true });
  useEffect(() => {
    let framed = false;
    try { framed = window.self !== window.top; } catch { framed = true; }
    const touch = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : true;
    setEnv({ framed, inApp: isInAppBrowser(navigator.userAgent), touch });
  }, []);

  const status = now === null || !today ? null : openStatus({ day: today.day, isDayOff: today.isDayOff, nowMinutes: now, mode: today.mode });
  const next: Next = status && (status.kind === 'closedNow' || status.kind === 'closedToday') && today?.week
    ? nextOpening({ week: today.week, daysOff: today.daysOff, today: todayInZone(timezone) })
    : null;
  const dark = shade(accent, 0.45);
  const ring = tint(accent, 0.45);
  const tel = telHref(phone);
  const maps = mapsHref(name, address);
  const addr = String(address ?? '').trim();

  const pageUrl = () => (typeof window !== 'undefined' ? window.location.href.split('#')[0] : '');

  /** Copy with the modern API, then the old one (it still works in frames and in-app browsers). */
  async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* not allowed here */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  /**
   * Share: the phone's own share sheet when there is one; otherwise copy the
   * link; and when even that is refused, a small sheet with the link and
   * "Text it" / "Email it". Only a visitor CLOSING the share sheet ends it —
   * before, ANY error (an embed or an in-app browser refusing the sheet) ended
   * it too, silently, and the button "did nothing".
   */
  async function share() {
    const url = pageUrl();
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && !env.framed) {
      try { await navigator.share({ title: name, url }); return; }
      catch (e) { if ((e as { name?: string })?.name === 'AbortError') return; }
    }
    if (await copyText(url)) { setCopied(true); window.setTimeout(() => setCopied(false), 2500); return; }
    setSheet(true);
  }

  const btn: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, minWidth: 0, padding: '0 6px',
    borderRadius: 12, border: `1.5px solid ${ring}`, background: '#ffffff', color: dark,
    fontSize: 13, fontWeight: 700, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };
  // A computer has no phone app behind tel:, so the button shows the number itself.
  const shown = prettyPhone(phone);
  const target = mapsTarget(env);
  const buttons = [
    tel && <a key="call" href={tel} target={env.framed ? '_top' : undefined} style={btn} title={shown}><Icon name="phone" color={dark} />{env.touch ? bt('Call') : shown}</a>,
    maps && (
      <a key="map" href={maps} target={target} rel="noopener noreferrer" style={btn}
        onClick={(e) => {
          // An in-app browser may swallow a new tab: open Maps right here instead.
          if (target === '_self') { e.preventDefault(); window.location.href = maps; }
        }}>
        <Icon name="nav" color={dark} />{bt('Directions')}
      </a>
    ),
    <button key="share" type="button" onClick={share} style={btn}><Icon name={copied ? 'check' : 'share'} color={dark} />{copied ? bt('Link copied') : bt('Share')}</button>,
  ].filter(Boolean);

  const meta = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: MUTED, fontWeight: 500 }}>
      <StatusLine status={status} next={next} />
      {rating && rating.count > 0 && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }} title={`${rating.value} / 5 · ${rating.count}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="#f59e0b" /></svg>
          <span style={{ color: INK, fontWeight: 700 }}>{rating.value}</span> ({rating.count})
        </span>
      )}
    </div>
  );
  const where = addr || shown ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {addr && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
          <span style={{ marginTop: 1 }}><Icon name="pin" color={MUTED} /></span>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere', userSelect: 'text' }}>{addr}</span>
        </div>
      )}
      {/* The number in plain sight: where a tap on Call is blocked (some in-app
          browsers), it can still be read, held to copy, and dialled. */}
      {shown && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: MUTED, lineHeight: 1.5 }}>
          <Icon name="phone" color={MUTED} />
          <a href={tel || undefined} target={env.framed ? '_top' : undefined} style={{ color: MUTED, textDecoration: 'none', userSelect: 'text' }}>{shown}</a>
        </div>
      )}
    </div>
  ) : null;
  const shareSheet = sheet ? (
    <div style={{ border: `1.5px solid ${ring}`, borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 8, background: '#ffffff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: INK }}>{bt('Share this booking page')}</span>
        <button type="button" onClick={() => setSheet(false)} aria-label={bt('Close')} style={{ border: 'none', background: 'transparent', color: MUTED, fontSize: 16, cursor: 'pointer', padding: 4 }}>✕</button>
      </div>
      <input readOnly value={pageUrl()} onFocus={(e) => e.currentTarget.select()} aria-label={bt('Link')}
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '9px 10px', borderRadius: 10, border: '1px solid #dbe2ee', color: INK, background: '#f8fafc' }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <a href={smsShareHref(name, pageUrl())} target={env.framed ? '_top' : undefined} style={btn}>💬 {bt('Text it')}</a>
        <a href={`mailto:?subject=${encodeURIComponent(name)}&body=${encodeURIComponent(pageUrl())}`} target={env.framed ? '_top' : undefined} style={btn}>✉️ {bt('Email it')}</a>
      </div>
    </div>
  ) : null;
  const row = buttons.length ? (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${buttons.length}, minmax(0, 1fr))`, gap: 8 }}>{buttons}</div>
      {shareSheet}
    </>
  ) : null;

  if (compact) {
    return (
      <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #e9edf4', background: '#ffffff', boxShadow: '0 2px 6px -3px rgba(15,42,82,.10)', marginBottom: 4 }}>
        <div style={{ height: 4, background: dark }} />
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {meta}{where}{row}
        </div>
      </div>
    );
  }

  const logo = String(logoUrl ?? '').trim();
  const zoom = Math.min(200, Math.max(50, logoScale ?? 100)) / 100;
  return (
    <div style={{ flexShrink: 0, background: '#ffffff' }}>
      <div style={{ height: 5, background: dark }} />
      <div style={{ padding: '16px 18px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {okLogo(logo) ? (
            <span style={{ width: 54, height: 54, borderRadius: '50%', background: '#ffffff', overflow: 'hidden', flexShrink: 0, display: 'grid', placeItems: 'center', boxShadow: `inset 0 0 0 1.5px ${ring}, 0 2px 8px rgba(15,42,82,.12)` }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={logo} alt="" width={54} height={54} style={{ width: '82%', height: '82%', objectFit: 'contain', transform: `scale(${zoom})` }} />
            </span>
          ) : (
            <span style={{ width: 54, height: 54, borderRadius: '50%', background: tint(accent, 0.14), flexShrink: 0, display: 'grid', placeItems: 'center', fontFamily: 'Georgia, serif', fontSize: 19, color: dark, letterSpacing: 1, boxShadow: `inset 0 0 0 1.5px ${ring}` }}>
              {initialsOf(name)}
            </span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17.5, letterSpacing: -0.3, lineHeight: 1.2, color: INK, overflowWrap: 'anywhere' }}>{name}</div>
            {meta}
          </div>
        </div>
        {where}{row}
      </div>
    </div>
  );
}
