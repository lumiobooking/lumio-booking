/**
 * What the server-rendered booking page says, for a reader that runs no
 * JavaScript: Google's business-link crawler and the Actions Center reviewer.
 *
 * Google's merchant-page checks want the facts a customer needs before booking,
 * on the page itself: the salon's real hours (not "open 7 days a week"), every
 * price as the final price (never a bare "$0"), the cancellation rule, and who
 * runs the booking page. Kept pure so each sentence is tested.
 */

export interface SeoHours { day: number; closed: boolean; open: string; close: string; intervals?: { open: string; close: string }[] }
export interface SeoPolicy { selfCancel: boolean; cancelNoticeHours: number | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The đồng shop reads a 24-hour clock; everywhere else we serve reads 9:30 AM. */
export function uses12h(currency: string | null | undefined): boolean {
  return String(currency || 'USD').toUpperCase() !== 'VND';
}

/** "09:30" -> "9:30 AM" (or "09:30" on a 24-hour clock). Anything odd is shown as given. */
export function clock(hhmm: string, h12: boolean): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return String(hhmm || '');
  const h = Number(m[1]) % 24;
  if (!h12) return `${String(h).padStart(2, '0')}:${m[2]}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One line per day, Monday first, split shifts joined: "9:30 AM – 1:00 PM, 2:00 PM – 7:00 PM". */
export function hoursRows(hours: SeoHours[] | null | undefined, h12: boolean): { day: string; text: string }[] {
  const byDay = new Map((hours ?? []).filter((h) => h && h.day >= 0 && h.day <= 6).map((h) => [h.day, h]));
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d)).map((d) => {
    const h = byDay.get(d)!;
    if (h.closed) return { day: DAYS[d], text: 'Closed' };
    const ivs = h.intervals && h.intervals.length ? h.intervals : [{ open: h.open, close: h.close }];
    return { day: DAYS[d], text: ivs.map((iv) => `${clock(iv.open, h12)} – ${clock(iv.close, h12)}`).join(', ') };
  });
}

/** Minor units -> "$49" (the đồng has no sub-unit, so it is never divided). */
export function money(minorUnits: number, currency: string | null | undefined): string {
  const code = currency || 'USD';
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 });
    const zeroDecimal = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits === 0;
    return nf.format(zeroDecimal ? minorUnits : minorUnits / 100);
  } catch {
    return `$${Math.round(minorUnits / 100)}`;
  }
}

/**
 * The price as a customer should read it. A bare "$0" looks like a placeholder
 * to a reviewer and like a mistake to a customer: a free add-on says Free, and
 * a "from $0" (the price is set at the chair) says so in words.
 */
export function priceLabel(cents: number | null | undefined, from: boolean, currency: string | null | undefined): string {
  const c = Number(cents) || 0;
  if (c <= 0) return from ? 'Price set at the salon' : 'Free';
  return `${from ? 'from ' : ''}${money(c, currency)}`;
}

/** The salon's own cancellation rule, in one sentence. */
export function cancelLine(policy: SeoPolicy | null | undefined, phone: string | null | undefined): string {
  if (policy?.selfCancel) {
    const h = Number(policy.cancelNoticeHours) || 0;
    return h > 0
      ? `You can cancel or reschedule online up to ${h} hour${h === 1 ? '' : 's'} before your appointment, using the link in your confirmation.`
      : 'You can cancel or reschedule online using the link in your confirmation.';
  }
  return phone ? `To cancel or reschedule, call the salon at ${phone}.` : 'To cancel or reschedule, contact the salon.';
}


/** What the no-JavaScript menu needs from the salon (a subset of the SEO payload). */
export interface StaticMenuInput {
  name: string;
  address: string | null;
  contactPhone: string | null;
  accentColor: string;
  currency: string;
  hours: SeoHours[];
  menu?: { id: string; name: string; priceCents: number; priceFrom: boolean; durationMinutes: number; category: string | null }[];
  policy?: SeoPolicy | null;
}

/** HTML-escape a value going into the static menu markup. */
export const esc = (v: unknown) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The menu for crawlers that run no JavaScript, as an HTML STRING inside
 * <noscript>.
 *
 * It used to be React elements inside <noscript>. A browser running
 * JavaScript reads a noscript's contents as plain text, so React found text
 * where it expected the elements it rendered, gave up on hydration ("Text
 * content does not match", React errors 425/418/423) and threw the whole
 * server-rendered page away to draw it again in the browser: the dark app
 * background showed for a moment between the two — the black flash on every
 * booking page load — and the page took longer to come up. As a string React
 * never looks inside it. Same markup, same facts for the crawler.
 */
export function staticMenuHtml(s: StaticMenuInput, webUrl = 'https://lumiobooking.com'): string {
  const menu = s.menu ?? [];
  if (!menu.length) return '';
  const accent = /^#[0-9a-f]{6}$/i.test(s.accentColor || '') ? s.accentColor : '#4f46e5';
  const groups = new Map<string, typeof menu>();
  for (const m of menu) { const k = m.category ?? ''; groups.set(k, [...(groups.get(k) ?? []), m]); }
  const hours = hoursRows(s.hours, uses12h(s.currency));
  const muted = '#475569';
  const out: string[] = [];
  out.push(`<section id="lumio-ssr-menu" aria-label="${esc(`${s.name} services`)}" style="max-width:760px;margin:0 auto;padding:20px 16px 32px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#0f172a;line-height:1.5">`);
  out.push(`<h1 style="font-size:24px;margin:0 0 4px">${esc(s.name)}</h1>`);
  out.push(`<p style="margin:0 0 12px;color:${muted};font-size:14px">`);
  if (s.address) out.push(`<span>${esc(s.address)}</span>`);
  if (s.contactPhone) out.push(`<span>${s.address ? ' · ' : ''}<a href="tel:${esc(s.contactPhone)}" style="color:#0f172a">${esc(s.contactPhone)}</a></span>`);
  out.push('</p>');
  out.push(`<a href="#book" style="display:inline-block;background:${accent};color:#ffffff;border-radius:10px;padding:10px 18px;font-weight:700;text-decoration:none;font-size:15px">Book an appointment</a>`);
  out.push('<h2 style="font-size:17px;margin:20px 0 8px">Services &amp; prices</h2>');
  for (const [cat, items] of groups.entries()) {
    out.push('<div style="margin-bottom:12px">');
    if (cat) out.push(`<h3 style="font-size:14px;margin:8px 0 4px;color:${muted};text-transform:uppercase;letter-spacing:0.5px">${esc(cat)}</h3>`);
    out.push('<ul style="list-style:none;padding:0;margin:0">');
    for (const m of items) {
      out.push(`<li style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #e5e7eb;font-size:14px">`
        + `<a href="?service=${encodeURIComponent(m.id)}#book" style="color:#0f172a;text-decoration:none;flex:1">${esc(m.name)}${m.durationMinutes ? `<span style="color:#64748b"> · ${esc(m.durationMinutes)} min</span>` : ''}</a>`
        + `<b>${esc(priceLabel(m.priceCents, m.priceFrom, s.currency))}</b></li>`);
    }
    out.push('</ul></div>');
  }
  out.push('<p style="margin:4px 0 0;font-size:13px;color:#64748b">Prices are set by the salon. Tips are not included.</p>');
  if (hours.length > 0) {
    out.push('<h2 style="font-size:17px;margin:20px 0 8px">Opening hours</h2><table style="border-collapse:collapse;font-size:14px"><tbody>');
    for (const h of hours) out.push(`<tr><td style="padding:3px 16px 3px 0;color:${muted}">${esc(h.day)}</td><td style="padding:3px 0">${esc(h.text)}</td></tr>`);
    out.push('</tbody></table>');
  }
  out.push('<h2 style="font-size:17px;margin:20px 0 8px">Cancellation policy</h2>');
  out.push(`<p style="margin:0;font-size:14px">${esc(cancelLine(s.policy, s.contactPhone))}</p>`);
  out.push(`<p style="margin:28px 0 0;padding-top:14px;border-top:1px solid #e5e7eb;font-size:12.5px;color:#64748b">Online booking for ${esc(s.name)} is provided by <a href="${esc(webUrl)}" style="color:#4338ca">Lumio Booking</a>, operated by Lumio Agency LLC. `
    + `<a href="${esc(webUrl)}/privacy" style="color:#4338ca">Privacy policy</a> · <a href="${esc(webUrl)}/terms" style="color:#4338ca">Terms</a> · <a href="${esc(webUrl)}/booking-policy" style="color:#4338ca">Booking policy</a></p>`);
  out.push('</section>');
  return out.join('');
}

