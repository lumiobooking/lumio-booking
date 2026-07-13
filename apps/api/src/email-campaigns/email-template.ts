/**
 * The campaign email itself.
 *
 * Salons never touch HTML — they fill in blocks (heading, paragraphs, an image, a
 * button) and we render them into one battle-tested layout: tables + inline CSS,
 * because that is the only thing Outlook, Gmail and Apple Mail all agree on.
 * Rendering it here (not in the browser) also means every campaign we ever sent
 * can be re-rendered exactly as the customer saw it.
 */
export interface CampaignContent {
  subject: string;
  preheader?: string | null;
  logoUrl?: string | null;
  brandName: string;
  brandColor?: string | null;
  heading?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  footerNote?: string | null;
  unsubscribeUrl?: string | null;
  recipientName?: string | null;
}

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only http(s) links may ever be rendered — no javascript: or data: URLs. */
export function safeUrl(u?: string | null): string {
  const v = String(u ?? '').trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : '';
}

/** "Hi {{name}}," style tokens the salon can drop into the heading or body. */
export function fillTokens(text: string, vars: { name?: string | null; brand?: string }): string {
  return String(text)
    .replace(/\{\{\s*name\s*\}\}/gi, (vars.name || 'there').trim() || 'there')
    .replace(/\{\{\s*brand\s*\}\}/gi, vars.brand || '');
}

export function renderCampaignHtml(c: CampaignContent): string {
  const accent = /^#[0-9a-f]{6}$/i.test(String(c.brandColor || '')) ? String(c.brandColor) : '#6366f1';
  const brand = esc(c.brandName || 'Lumio');
  const heading = c.heading ? esc(fillTokens(c.heading, { name: c.recipientName, brand: c.brandName })) : '';
  const paragraphs = String(c.body || '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#334155">${esc(fillTokens(p, { name: c.recipientName, brand: c.brandName })).replace(/\n/g, '<br/>')}</p>`)
    .join('');
  const img = safeUrl(c.imageUrl);
  const cta = safeUrl(c.ctaUrl);
  const logo = safeUrl(c.logoUrl);
  const unsub = safeUrl(c.unsubscribeUrl);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-font-smoothing:antialiased">
${c.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
      <tr><td style="height:5px;background:${accent}"></td></tr>
      <tr><td style="padding:26px 32px 0;text-align:center">
        ${logo
          ? `<img src="${logo}" alt="${brand}" width="64" style="width:64px;height:auto;border-radius:12px;display:inline-block"/>`
          : `<div style="font-size:20px;font-weight:800;color:${accent};letter-spacing:-0.2px">${brand}</div>`}
      </td></tr>
      ${heading ? `<tr><td style="padding:20px 32px 0">
        <h1 style="margin:0;font-size:26px;line-height:1.28;font-weight:800;color:#0f172a;text-align:center">${heading}</h1>
      </td></tr>` : ''}
      ${img ? `<tr><td style="padding:22px 32px 0">
        <img src="${img}" alt="" width="536" style="width:100%;height:auto;border-radius:12px;display:block"/>
      </td></tr>` : ''}
      ${paragraphs ? `<tr><td style="padding:22px 32px 0">${paragraphs}</td></tr>` : ''}
      ${cta && c.ctaLabel ? `<tr><td style="padding:8px 32px 4px;text-align:center">
        <a href="${cta}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 30px;border-radius:10px;font-size:16px;font-weight:700">${esc(c.ctaLabel)}</a>
      </td></tr>
      <tr><td style="padding:12px 32px 0;text-align:center">
        <div style="font-size:12px;color:#94a3b8;word-break:break-all">${esc(cta)}</div>
      </td></tr>` : ''}
      <tr><td style="padding:28px 32px 0"><div style="height:1px;background:#e2e8f0"></div></td></tr>
      <tr><td style="padding:16px 32px 28px;text-align:center">
        ${c.footerNote ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#64748b">${esc(c.footerNote)}</p>` : ''}
        <p style="margin:0;font-size:12px;color:#94a3b8">
          ${brand}
          ${unsub ? ` &middot; <a href="${unsub}" style="color:#94a3b8;text-decoration:underline">Unsubscribe</a>` : ''}
        </p>
      </td></tr>
    </table>
    <div style="max-width:600px;margin:14px auto 0;font-size:11px;color:#94a3b8;text-align:center">
      You are receiving this because you are a customer of ${brand}.
    </div>
  </td></tr>
</table>
</body></html>`;
}

/** Plain-text fallback (spam filters penalise HTML-only mail). */
export function renderCampaignText(c: CampaignContent): string {
  const lines: string[] = [];
  if (c.heading) lines.push(fillTokens(c.heading, { name: c.recipientName, brand: c.brandName }), '');
  if (c.body) lines.push(fillTokens(c.body, { name: c.recipientName, brand: c.brandName }), '');
  const cta = safeUrl(c.ctaUrl);
  if (cta) lines.push(`${c.ctaLabel || 'Open'}: ${cta}`, '');
  if (c.footerNote) lines.push(c.footerNote, '');
  lines.push(`— ${c.brandName}`);
  if (c.unsubscribeUrl) lines.push(`Unsubscribe: ${c.unsubscribeUrl}`);
  return lines.join('\n');
}
