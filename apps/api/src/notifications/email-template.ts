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
  addons: string;
  accent: string;
  contact: string;
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
}): string {
  const { heading, intro, footer, d, referral } = args;
  const rows =
    detailRow('Service', d.service) +
    detailRow('Add-ons', d.addons) +
    detailRow('Date', d.date) +
    detailRow('Time', d.time) +
    detailRow('Duration', d.duration) +
    detailRow('Technician', d.technician) +
    detailRow('Total', d.total, true);

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

/** Replaces %key% tokens. Unknown tokens are left blank. */
export function fillPct(template: string, data: Record<string, string>): string {
  return template.replace(/%(\w+)%/g, (_m, key: string) => {
    const v = data[key];
    return v == null ? '' : String(v);
  });
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
export function renderBookingEmailText(heading: string, intro: string, footer: string, d: BookingTemplateData, referral?: ReferralInvite | null): string {
  const lines = [
    heading,
    '',
    intro,
    '',
    `Service: ${d.service}`,
    d.addons ? `Add-ons: ${d.addons}` : '',
    `Date: ${d.date}`,
    `Time: ${d.time}`,
    `Duration: ${d.duration}`,
    `Technician: ${d.technician}`,
    `Total: ${d.total}`,
    '',
    footer,
    referral ? referralBlockText(referral) : '',
    '',
    `${d.salon}${d.contact ? ' · ' + d.contact : ''}`,
  ];
  return lines.filter((l) => l !== '').join('\n');
}
