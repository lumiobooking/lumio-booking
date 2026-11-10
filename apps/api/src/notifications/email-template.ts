// ===========================================================================
// Booking notification templates. Renders a polished, branded HTML email and a
// plain-text fallback, plus SMS text. All copy supports {placeholders}.
// ===========================================================================

export interface BookingTemplateData {
  salon: string;
  customer: string;
  service: string;
  date: string;
  time: string;
  technician: string;
  total: string;
  duration: string;
  /** Every extra line on the visit — extra services AND add-ons. Unchanged on
   *  purpose: salon-authored templates render %add_ons% and must keep seeing
   *  exactly what they saw before. The split below is what the built-in email
   *  uses. */
  addons: string;
  accent: string;
  contact: string;

  // -------------------------------------------------------------------------
  // Everything below is optional and was added later. A caller that does not
  // set a field gets an empty string from fill(), and the row is skipped — so
  // no existing template and no existing message changes shape.
  // -------------------------------------------------------------------------

  /** Add-ons only (the extra SERVICES are listed under `lineup` instead). */
  addonsOnly?: string;
  /** Every service on the visit with the technician doing it, e.g.
   *  "Colour — Anna · Nail Design — Kim". Empty for a single-service visit. */
  lineup?: string;
  /** Short human-quotable booking code (what a customer reads on the phone). */
  reference?: string;
  /** What the customer typed into the booking form. */
  notes?: string;
  /** Street address of the salon, so the customer knows where to turn up. */
  address?: string;
  /** The customer's own contacts — for the OWNER and STAFF copies only. Never
   *  rendered on the customer's copy. */
  customerPhone?: string;
  customerEmail?: string;
  /** Where the booking came in from: online page, front desk, Messenger… */
  source?: string;
  /** Self-service view / reschedule / cancel link (only when the salon turned it on). */
  manageUrl?: string;
  /** The salon's phone: "Need to change? Call …" when there is no self-service link. */
  salonPhone?: string;
  /**
   * Who is coming and what each person is having (Nov 2026). One entry for a
   * single visit, one per person for a party. When given, the email shows a
   * clean "who · what · with whom" block instead of the one-line lineup, and
   * the party size up top.
   */
  people?: PartyPerson[];
  /** Short forms for the header and the SMS: "Sun, Dec 6" · "6:00 PM". */
  dateShort?: string;
  timeStart?: string;
}

/** One service on a visit, and who does it. */
export interface VisitLine { service: string; tech?: string }
/** One person in the booking: their name, their services (with technician), their add-ons. */
export interface PartyPerson { name: string; lines: VisitLine[]; addons?: string }

/** Who is reading this email. Decides which rows are shown. */
export type EmailAudience = 'customer' | 'owner' | 'staff';

/** Row labels. A VN salon writes to VN customers; a US salon is untouched. */
const LABELS = {
  en: {
    reference: 'Reference', service: 'Service', services: 'Services', addons: 'Add-ons',
    date: 'Date', time: 'Time', duration: 'Duration', technician: 'Technician',
    notes: 'Notes', total: 'Total', customer: 'Customer', phone: 'Phone',
    email: 'Email', where: 'Address', source: 'Booked via', manage: 'Manage booking',
    party: 'Party', people: (n: number) => (n === 1 ? '1 person' : `${n} people`), who: 'Who is coming',
    tbd: 'to be assigned', details: 'Booking details',
  },
  vi: {
    reference: 'Mã lịch', service: 'Dịch vụ', services: 'Dịch vụ', addons: 'Dịch vụ thêm',
    date: 'Ngày', time: 'Giờ', duration: 'Thời lượng', technician: 'Thợ làm',
    notes: 'Ghi chú', total: 'Tổng cộng', customer: 'Khách hàng', phone: 'Điện thoại',
    email: 'Email', where: 'Địa chỉ', source: 'Đặt qua', manage: 'Quản lý lịch hẹn',
    party: 'Số người', people: (n: number) => `${n} người`, who: 'Khách & dịch vụ',
    tbd: 'tiệm sắp xếp', details: 'Chi tiết lịch hẹn',
  },
} as const;

export type EmailLang = keyof typeof LABELS;

/**
 * The detail rows, in reading order, for one audience.
 *
 * A confirmation that leaves out who is doing the work, what the customer
 * asked for, or how to reach them is a confirmation the salon has to chase by
 * phone. Each audience gets the whole booking, minus what it must not see: the
 * customer never reads their own phone number back, and only the salon side
 * sees where the booking came from.
 */
export function bookingRowValues(d: BookingTemplateData, audience: EmailAudience, lang: EmailLang): Array<[string, string, boolean]> {
  const L = LABELS[lang] ?? LABELS.en;
  const addons = d.addonsOnly != null ? d.addonsOnly : d.addons;
  const rows: Array<[string, string, boolean]> = [];
  const put = (label: string, value: string | undefined, strong = false) => {
    if (value) rows.push([label, value, strong]);
  };

  // A party (or a visit split across services) is listed person by person in
  // its own block (peopleBlock); these rows then carry only what is shared.
  const listed = hasPeopleBlock(d);
  put(L.reference, d.reference);
  if (audience !== 'customer') {
    put(L.customer, d.customer);
    put(L.phone, d.customerPhone);
    put(L.email, d.customerEmail);
  }
  if (listed) {
    if ((d.people?.length ?? 0) > 1) put(L.party, L.people(d.people!.length));
  } else {
    // A multi-service visit lists every service WITH the technician on it — the
    // single-service row would only repeat the first of them.
    if (d.lineup) put(L.services, d.lineup);
    else put(L.service, d.service);
    put(L.addons, addons);
  }
  put(L.date, d.date);
  put(L.time, d.time);
  put(L.duration, d.duration);
  if (!listed) put(L.technician, d.technician);
  put(L.notes, d.notes);
  if (audience === 'customer') put(L.where, d.address);
  if (audience === 'owner') put(L.source, d.source);
  put(L.total, d.total, true);
  return rows;
}

/** The people block replaces the service rows when there is more than one person or more than one service. */
export function hasPeopleBlock(d: BookingTemplateData): boolean {
  const p = d.people ?? [];
  return p.length > 1 || (p.length === 1 && p[0].lines.length > 1);
}

/** "Rinata: Manicure & Pedicure — Lisa, Gel X — Kim (+ French tip)" — the plain-text form of one person. */
export function personLine(p: PartyPerson, tbd: string): string {
  const lines = p.lines.map((l) => `${l.service} — ${l.tech || tbd}`).join(', ');
  return `${p.name}: ${lines}${p.addons ? ` (+ ${p.addons})` : ''}`;
}

/** Replaces {key} tokens in a template string. Unknown tokens are left blank. */
export function fill(template: string, d: BookingTemplateData): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = (d as unknown as Record<string, string>)[key];
    return v == null ? '' : String(v);
  });
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function detailRow(label: string, value: string, emphasize = false): string {
  if (!value) return '';
  return `
    <tr>
      <td style="padding:9px 0;border-bottom:1px solid #eef0f4;color:#8a94a6;font-size:12px;letter-spacing:.04em;text-transform:uppercase;">${esc(label)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #eef0f4;color:#1f2733;font-size:${emphasize ? '16px' : '14px'};font-weight:${emphasize ? 700 : 600};text-align:right;">${esc(value)}</td>
    </tr>`;
}

/** Optional "refer a friend" invite shown at the bottom of the customer email. */
export interface ReferralInvite {
  link: string;
  headline: string;
  sub: string;
}

/** Email-safe (inline-style) referral card. Rendered only when passed. */
export function referralBlockHtml(r: ReferralInvite, accent: string): string {
  return `
    <div style="margin-top:22px;padding:18px 18px 20px;border:1px solid #eef0f4;border-radius:12px;background:#fafbff;">
      <div style="font-size:15px;font-weight:800;color:#111827;margin:0 0 6px;">${esc(r.headline)}</div>
      <p style="margin:0 0 14px;color:#4b5563;font-size:13px;line-height:1.6;">${esc(r.sub)}</p>
      <a href="${esc(r.link)}" style="display:inline-block;background:${esc(accent)};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;">Invite a friend &rarr;</a>
      <div style="margin-top:12px;font-size:12px;color:#8a94a6;word-break:break-all;">Your link: <a href="${esc(r.link)}" style="color:${esc(accent)};text-decoration:none;">${esc(r.link)}</a></div>
    </div>`;
}

/** Plain-text version of the referral invite. */
export function referralBlockText(r: ReferralInvite): string {
  return `${r.headline}\n${r.sub}\nYour link: ${r.link}`;
}

/**
 * Builds the email. `heading` is the bold title, `intro` the paragraph below it,
 * `footer` the closing note — all already placeholder-filled by the caller.
 */
export function renderBookingEmailHtml(args: {
  heading: string;
  intro: string;
  footer: string;
  d: BookingTemplateData;
  referral?: ReferralInvite | null;
  /** Defaults to 'customer', which is exactly what this used to render. */
  audience?: EmailAudience;
  lang?: EmailLang;
}): string {
  const { heading, intro, footer, d, referral } = args;
  const audience = args.audience ?? 'customer';
  const lang: EmailLang = args.lang === 'vi' ? 'vi' : 'en';
  const L = LABELS[lang] ?? LABELS.en;
  const accent = esc(d.accent || '#6366f1');
  const rows = bookingRowValues(d, audience, lang)
    // Date and time are the hero line when the short forms are known.
    .filter(([label]) => !(d.dateShort && d.timeStart && (label === L.date || label === L.time || label === L.duration || label === L.party)))
    .map(([label, value, strong]) => detailRow(label, value, strong))
    .join('');
  const manage = d.manageUrl
    ? `<p style="margin:20px 0 0;text-align:center;"><a href="${esc(d.manageUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:10px;">${esc(L.manage)} &rarr;</a></p>`
    // No self-service link (the default since 10/11/2026): a change goes through the salon.
    : audience === 'customer' && d.salonPhone
      ? `<p style="margin:20px 0 0;color:#374151;font-size:14px;line-height:1.6;">${esc(changeLine(lang, d.salonPhone))}</p>`
      : '';
  const size = d.people?.length ?? 0;
  // The hero: when, and how many — what anyone reading this needs first.
  const hero = d.dateShort && d.timeStart
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#f7f8fc;border-radius:12px;">
        <tr>
          <td style="padding:14px 16px;">
            <div style="font-size:12px;color:#8a94a6;letter-spacing:.04em;text-transform:uppercase;">${esc(L.date)} · ${esc(L.time)}</div>
            <div style="font-size:20px;font-weight:800;color:#111827;margin-top:2px;">${esc(d.dateShort)} · <span style="white-space:nowrap;">${esc(d.timeStart)}</span></div>
            ${(d.time && d.time !== d.timeStart) || d.duration ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${[d.time !== d.timeStart ? d.time : '', d.duration].filter(Boolean).map((x) => esc(x as string)).join(' · ')}</div>` : ''}
          </td>
          ${size > 1 ? `<td style="padding:14px 16px;text-align:right;vertical-align:middle;white-space:nowrap;"><span style="display:inline-block;background:${accent};color:#ffffff;font-weight:800;font-size:14px;padding:7px 12px;border-radius:999px;">&#128101; ${esc(L.people(size))}</span></td>` : ''}
        </tr>
      </table>`
    : '';
  const people = hasPeopleBlock(d) ? peopleBlock(d.people ?? [], size > 1 ? L.who : L.services, L.tbd, accent) : '';

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f6fb;">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f6fb;padding:24px 12px;">
    <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.08);">
      <div style="background:${accent};padding:20px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:800;letter-spacing:.2px;">${esc(d.salon)}</div>
      </div>
      <div style="padding:24px;">
        <h1 style="margin:0 0 6px;font-size:21px;line-height:1.3;color:#111827;">${esc(heading)}</h1>
        ${intro ? `<p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.6;">${esc(intro)}</p>` : ''}
        ${hero}
        ${people}
        <table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table>
        ${manage}
        ${footer ? `<p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">${esc(footer)}</p>` : ''}
        ${referral ? referralBlockHtml(referral, d.accent) : ''}
      </div>
      <div style="background:#f9fafb;padding:14px 24px;color:#9aa4b2;font-size:12px;border-top:1px solid #eef0f4;">
        ${esc(d.salon)}${d.contact ? ' · ' + esc(d.contact) : ''}
      </div>
    </div>
    <div style="text-align:center;color:#b6bdc9;font-size:11px;margin-top:14px;">Powered by Lumio Booking</div>
  </div>
</body>
</html>`;
}

/** Person by person: name, then each service with its technician, then add-ons. Email-safe. */
function peopleBlock(people: PartyPerson[], title: string, tbd: string, accent: string): string {
  const many = people.length > 1;
  const items = people.map((p, i) => {
    const lines = p.lines.map((l) => `
          <tr>
            <td style="padding:2px 0;color:#1f2733;font-size:14px;font-weight:600;">${esc(l.service)}</td>
            <td style="padding:2px 0;color:${l.tech ? '#4b5563' : '#9aa4b2'};font-size:13px;text-align:right;white-space:nowrap;">${l.tech ? '&#128100; ' + esc(l.tech) : esc(tbd)}</td>
          </tr>`).join('');
    return `
      <tr>
        <td style="padding:10px 0;${i < people.length - 1 ? 'border-bottom:1px solid #eef0f4;' : ''}">
          ${many ? `<div style="font-size:13px;font-weight:800;color:${accent};margin-bottom:3px;">${i + 1}. ${esc(p.name)}</div>` : ''}
          <table role="presentation" style="width:100%;border-collapse:collapse;">${lines}</table>
          ${p.addons ? `<div style="font-size:12.5px;color:#6b7280;margin-top:2px;">+ ${esc(p.addons)}</div>` : ''}
        </td>
      </tr>`;
  }).join('');
  return `
    <div style="margin:0 0 16px;padding:4px 16px;border:1px solid #eef0f4;border-radius:12px;">
      <div style="font-size:12px;color:#8a94a6;letter-spacing:.04em;text-transform:uppercase;padding-top:10px;">${esc(title)}</div>
      <table role="presentation" style="width:100%;border-collapse:collapse;">${items}</table>
    </div>`;
}

// ===========================================================================
// Catalog templates use the Amelia-style %placeholder% syntax and a free-form
// body the salon fully controls. These helpers fill and render those.
// ===========================================================================

/**
 * Replaces %key% tokens (and their common other names — PCT_ALIASES). Tokens
 * still unknown are left blank.
 *
 * A line that is nothing but a label and an empty placeholder — "Add-ons:" on a
 * booking with no add-ons, "Your note:" when the customer wrote none — is
 * dropped whole. Leaving the bare label in is how a confirmation ends up
 * looking broken, and it is the reason templates could not afford to carry the
 * optional half of a booking. A line is only dropped when EVERY placeholder in
 * it is empty and what is left over is just a label (blank, or ending in ':'),
 * so prose is never touched.
 */
/**
 * Other names salons type for our placeholders — most of them Amelia's, which
 * many salons copy their old texts from. "on %date% at %time%" used to come
 * out as "on at": the token was unknown, so it was blanked. An alias is only
 * read when the template's own key is missing, so a key a caller really
 * provides always wins.
 */
export const PCT_ALIASES: Readonly<Record<string, string>> = {
  date: 'appointment_date', appointment_day: 'appointment_date', booking_date: 'appointment_date',
  appt_date: 'appointment_date', appointment_date_formatted: 'appointment_date',
  time: 'appointment_time', booking_time: 'appointment_time', appt_time: 'appointment_time',
  customer_first_name: 'customer_name', first_name: 'customer_name', client_name: 'customer_name', client_first_name: 'customer_name',
  full_name: 'customer_full_name', client_full_name: 'customer_full_name', booked_customer_full_name: 'customer_full_name',
  employee_name: 'staff_name', employee_first_name: 'staff_name', employee_full_name: 'staff_name',
  technician: 'staff_name', technician_name: 'staff_name', tech_name: 'staff_name', staff: 'staff_name', provider_name: 'staff_name',
  company_name: 'salon_name', business_name: 'salon_name', shop_name: 'salon_name', store_name: 'salon_name', salon: 'salon_name',
  company_phone: 'salon_contact', salon_phone: 'salon_contact', business_phone: 'salon_contact', company_email: 'salon_contact', salon_email: 'salon_contact',
  company_address: 'salon_address', location_address: 'salon_address', salon_location: 'salon_address',
  appointment_price: 'total_price', service_price: 'total_price', price: 'total_price', total: 'total_price', booking_price: 'total_price',
  service_duration: 'duration', appointment_duration: 'duration',
  manage_link: 'manage_url', appointment_link: 'manage_url', cancel_link: 'manage_url', manage_appointment_url: 'manage_url',
  booking_number: 'booking_ref', appointment_id: 'booking_ref',
};

/** One placeholder's value: the key itself, any case, then its alias. */
export function pctValue(data: Record<string, string>, key: string): string {
  const own = data[key] ?? data[key.toLowerCase()];
  if (own != null) return String(own);
  const k = key.toLowerCase();
  // appointment_time is a range ("2:30 PM – 4:00 PM"); the start / end
  // placeholders are its two halves.
  const [start = '', end = ''] = String(data.appointment_time ?? '').split(/\s+[–-]\s+/);
  switch (k) {
    case 'appointment_start_time': case 'start_time': case 'appointment_time_start':
      return start;
    case 'appointment_end_time': case 'end_time':
      return end;
    case 'appointment_date_time': case 'appointment_datetime': case 'date_time': case 'datetime':
      return data.appointment_date && start ? `${data.appointment_date}, ${start}` : '';
    default: {
      const canon = PCT_ALIASES[k];
      return canon && data[canon] != null ? String(data[canon]) : '';
    }
  }
}

export function fillPct(template: string, data: Record<string, string>): string {
  const value = (key: string) => pctValue(data, key);
  // Split on line AND paragraph boundaries, keeping them, so the shape of the
  // body survives. Paragraph tags matter: the editor joins paragraphs with no
  // newline between them, so without </p><p> in this list the last label of one
  // paragraph and the first sentence of the next read as a single line — and a
  // line containing prose is never dropped.
  const parts = template.split(/(<br\s*\/?>|<\/p\s*>|<p[^>]*>|\n)/i);
  const isSep = (x: string) => /^(<br\s*\/?>|<\/p\s*>|<p[^>]*>|\n)$/i.test(x);
  const isBreak = (x: string) => /^(<br\s*\/?>|\n)$/i.test(x);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (isSep(part)) { out.push(part); continue; }
    const tokens = part.match(/%(\w+)%/g);
    if (tokens && tokens.every((tk) => value(tk.slice(1, -1)) === '')) {
      const leftover = part.replace(/%(\w+)%/g, '').replace(/<[^>]+>/g, '').trim();
      if (leftover === '' || /[::]$/.test(leftover)) {
        // Drop the line AND the break that followed it, or the body grows a
        // blank gap everywhere an optional field was missing.
        const tags = part.match(/<[^>]+>/g);
        if (tags) out.push(tags.join('')); // keep any inline markup that was on the line
        // Swallow the line break that followed it — but never a paragraph tag,
        // which would unbalance the markup.
        if (i + 1 < parts.length && isBreak(parts[i + 1])) i++;
        continue;
      }
    }
    out.push(part.replace(/%(\w+)%/g, (_m, key: string) => value(key)));
  }
  return out.join('');
}

/** Strips HTML to a readable plain-text fallback (for the SMS-less text email + log). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Renders an already-filled, free-form body (with \n line breaks) inside the
 * branded HTML shell. Used by the per-event catalog templates.
 */
export function renderTemplatedEmailHtml(args: {
  salon: string;
  accent: string;
  contact: string;
  bodyText: string;
}): string {
  const { salon, accent, contact, bodyText } = args;
  // The editor produces HTML; legacy/plain bodies are converted on the fly.
  const hasTags = /<[a-z][\s\S]*>/i.test(bodyText);
  const content = hasTags
    ? `<div style="color:#374151;font-size:14px;line-height:1.65;">${bodyText}</div>`
    : bodyText
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.65;">${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('');

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f6fb;">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f6fb;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.08);">
      <div style="background:${esc(accent)};padding:22px 26px;">
        <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:.2px;">${esc(salon)}</div>
      </div>
      <div style="padding:26px;">${content}</div>
      <div style="background:#f9fafb;padding:16px 26px;color:#9aa4b2;font-size:12px;border-top:1px solid #eef0f4;">
        ${esc(salon)}${contact ? ' · ' + esc(contact) : ''}
      </div>
    </div>
    <div style="text-align:center;color:#b6bdc9;font-size:11px;margin-top:14px;">Powered by Lumio Booking</div>
  </div>
</body>
</html>`;
}

/** "Need to change your appointment? Please call us at …" */
export function changeLine(lang: EmailLang, phone: string): string {
  return lang === 'vi' ? `Cần đổi lịch? Vui lòng gọi tiệm: ${phone}` : `Need to change your appointment? Please call us at ${phone}.`;
}

/** Plain-text fallback (for clients that don't render HTML). */
export function renderBookingEmailText(
  heading: string,
  intro: string,
  footer: string,
  d: BookingTemplateData,
  referral?: ReferralInvite | null,
  audience: EmailAudience = 'customer',
  lang: EmailLang = 'en',
): string {
  const L = LABELS[lang] ?? LABELS.en;
  const lines = [
    heading,
    '',
    intro,
    '',
    ...(hasPeopleBlock(d) ? [...(d.people ?? []).map((p) => `- ${personLine(p, L.tbd)}`), ''] : []),
    ...bookingRowValues(d, audience, lang).map(([label, value]) => `${label}: ${value}`),
    d.manageUrl ? `${L.manage}: ${d.manageUrl}` : audience === 'customer' && d.salonPhone ? changeLine(lang, d.salonPhone) : '',
    '',
    footer,
    referral ? referralBlockText(referral) : '',
    '',
    `${d.salon}${d.contact ? ' · ' + d.contact : ''}`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}
