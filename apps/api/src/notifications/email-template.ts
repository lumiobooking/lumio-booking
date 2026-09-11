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
  /** Self-service view / reschedule / cancel link. */
  manageUrl?: string;
}

/** Who is reading this email. Decides which rows are shown. */
export type EmailAudience = 'customer' | 'owner' | 'staff';

/** Row labels. A VN salon writes to VN customers; a US salon is untouched. */
const LABELS = {
  en: {
    reference: 'Reference', service: 'Service', services: 'Services', addons: 'Add-ons',
    date: 'Date', time: 'Time', duration: 'Duration', technician: 'Technician',
    notes: 'Notes', total: 'Total', customer: 'Customer', phone: 'Phone',
    email: 'Email', where: 'Address', source: 'Booked via', manage: 'Manage booking',
  },
  vi: {
    reference: 'Mã lịch', service: 'Dịch vụ', services: 'Dịch vụ', addons: 'Dịch vụ thêm',
    date: 'Ngày', time: 'Giờ', duration: 'Thời lượng', technician: 'Thợ làm',
    notes: 'Ghi chú', total: 'Tổng cộng', customer: 'Khách hàng', phone: 'Điện thoại',
    email: 'Email', where: 'Địa chỉ', source: 'Đặt qua', manage: 'Quản lý lịch hẹn',
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

  put(L.reference, d.reference);
  if (audience !== 'customer') {
    put(L.customer, d.customer);
    put(L.phone, d.customerPhone);
    put(L.email, d.customerEmail);
  }
  // A multi-service visit lists every service WITH the technician on it — the
  // single-service row would only repeat the first of them.
  if (d.lineup) put(L.services, d.lineup);
  else put(L.service, d.service);
  put(L.addons, addons);
  put(L.date, d.date);
  put(L.time, d.time);
  put(L.duration, d.duration);
  put(L.technician, d.technician);
  put(L.notes, d.notes);
  if (audience === 'customer') put(L.where, d.address);
  if (audience === 'owner') put(L.source, d.source);
  put(L.total, d.total, true);
  return rows;
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
  const rows = bookingRowValues(d, audience, lang)
    .map(([label, value, strong]) => detailRow(label, value, strong))
    .join('');
  const manage = d.manageUrl
    ? `<p style="margin:18px 0 0;"><a href="${esc(d.manageUrl)}" style="display:inline-block;background:${esc(d.accent)};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:9px;">${esc((LABELS[lang] ?? LABELS.en).manage)} &rarr;</a></p>`
    : '';

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f6fb;">
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f6fb;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 6px 24px rgba(15,23,42,.08);">
      <div style="background:${esc(d.accent)};padding:22px 26px;">
        <div style="color:#ffffff;font-size:19px;font-weight:800;letter-spacing:.2px;">${esc(d.salon)}</div>
      </div>
      <div style="padding:26px;">
        <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">${esc(heading)}</h1>
        <p style="margin:0 0 18px;color:#4b5563;font-size:14px;line-height:1.6;">${esc(intro)}</p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
        ${manage}
        ${footer ? `<p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">${esc(footer)}</p>` : ''}
        ${referral ? referralBlockHtml(referral, d.accent) : ''}
      </div>
      <div style="background:#f9fafb;padding:16px 26px;color:#9aa4b2;font-size:12px;border-top:1px solid #eef0f4;">
        ${esc(d.salon)}${d.contact ? ' · ' + esc(d.contact) : ''}
      </div>
    </div>
    <div style="text-align:center;color:#b6bdc9;font-size:11px;margin-top:14px;">Powered by Lumio Booking</div>
  </div>
</body>
</html>`;
}

// ===========================================================================
// Catalog templates use the Amelia-style %placeholder% syntax and a free-form
// body the salon fully controls. These helpers fill and render those.
// ===========================================================================

/**
 * Replaces %key% tokens. Unknown tokens are left blank.
 *
 * A line that is nothing but a label and an empty placeholder — "Add-ons:" on a
 * booking with no add-ons, "Your note:" when the customer wrote none — is
 * dropped whole. Leaving the bare label in is how a confirmation ends up
 * looking broken, and it is the reason templates could not afford to carry the
 * optional half of a booking. A line is only dropped when EVERY placeholder in
 * it is empty and what is left over is just a label (blank, or ending in ':'),
 * so prose is never touched.
 */
export function fillPct(template: string, data: Record<string, string>): string {
  const value = (key: string) => {
    const v = data[key];
    return v == null ? '' : String(v);
  };
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
    ...bookingRowValues(d, audience, lang).map(([label, value]) => `${label}: ${value}`),
    d.manageUrl ? `${L.manage}: ${d.manageUrl}` : '',
    '',
    footer,
    referral ? referralBlockText(referral) : '',
    '',
    `${d.salon}${d.contact ? ' · ' + d.contact : ''}`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}
