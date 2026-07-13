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

/**
 * Turn plain URLs and phone numbers in the copy into real links — a signature is
 * useless if the reader can't tap the phone number from their inbox. Runs AFTER
 * esc(), so it only ever sees already-escaped text.
 */
function linkify(escaped: string, accent: string): string {
  return escaped
    // **bold** — the one bit of formatting worth having inside a sentence
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#0f172a">$1</strong>')
    .replace(/(https?:\/\/[^\s<)"']+)/g, (m) => {
      const clean = m.replace(/[.,;:]+$/, '');
      const tail = m.slice(clean.length);
      return `<a href="${clean}" style="color:${accent};font-weight:600;text-decoration:underline">${clean}</a>${tail}`;
    })
    .replace(/(\(\d{3}\)\s?\d{3}[-.\s]?\d{4})/g, (m) =>
      `<a href="tel:+1${m.replace(/\D/g, '')}" style="color:${accent};font-weight:600;text-decoration:none">${m}</a>`)
    .replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, (m) =>
      `<a href="mailto:${m}" style="color:${accent};font-weight:600;text-decoration:underline">${m}</a>`);
}

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

/**
 * A tiny markup so a plain textarea can produce a real marketing email — pricing
 * cards and all — without ever exposing HTML to the person writing it:
 *
 *   ## Heading                                   a section title
 *   - A benefit                                  a green-tick bullet
 *   [[PLAN]]  Name | $45/mo | tagline | a; b; c  a price card
 *   [[PLAN*]] ...                                the SAME, highlighted (the offer)
 *   [[NOTE]] small print                         a soft grey note box
 *   [[DIVIDER]]                                  a hairline
 *   anything else                                a normal paragraph
 */
function renderBody(raw: string, accent: string, vars: { name?: string | null; brand?: string }): string {
  const lines = raw.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let bullets: string[] = [];
  let plans: string[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const text = linkify(esc(fillTokens(para.join('\n'), vars)), accent).replace(/\n/g, '<br/>');
    out.push(`<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#334155">${text}</p>`);
    para = [];
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    out.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px">` +
      bullets.map((b) =>
        `<tr>` +
        `<td valign="top" width="24" style="padding:5px 0;color:${accent};font-weight:800;font-size:15px">&#10003;</td>` +
        `<td style="padding:5px 0;font-size:15.5px;line-height:1.6;color:#334155">${linkify(esc(fillTokens(b, vars)), accent)}</td>` +
        `</tr>`).join('') +
      `</table>`,
    );
    bullets = [];
  };
  const flushPlans = () => {
    if (!plans.length) return;
    const cards = plans.map((spec) => {
      const star = spec.startsWith('*');
      const body = star ? spec.slice(1) : spec;
      const [name = '', price = '', tag = '', feats = ''] = body.split('|').map((x) => x.trim());
      const items = feats.split(';').map((x) => x.trim()).filter(Boolean);
      const bg = star ? `${accent}0f` : '#ffffff';
      const border = star ? `2px solid ${accent}` : '1px solid #e2e8f0';
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px;background:${bg};border:${border};border-radius:14px">` +
        `<tr><td style="padding:18px 20px">` +
          `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>` +
            `<td style="font-size:17px;font-weight:800;color:#0f172a">${esc(name)}</td>` +
            `<td align="right" style="font-size:19px;font-weight:800;color:${accent};white-space:nowrap">${esc(price)}</td>` +
          `</tr></table>` +
          (tag ? `<div style="margin-top:4px;font-size:13.5px;color:#64748b">${esc(tag)}</div>` : '') +
          (items.length
            ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:10px">` +
              items.map((it) =>
                `<tr>` +
                `<td valign="top" width="20" style="padding:3px 0;color:${accent};font-weight:800;font-size:13px">&#10003;</td>` +
                `<td style="padding:3px 0;font-size:14px;line-height:1.55;color:#475569">${linkify(esc(it), accent)}</td>` +
                `</tr>`).join('') +
              `</table>`
            : '') +
        `</td></tr></table>`
      );
    }).join('');
    out.push(cards);
    plans = [];
  };
  const flushAll = () => { flushPara(); flushBullets(); flushPlans(); };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { flushAll(); continue; }

    if (line.startsWith('[[PLAN*]]')) { flushPara(); flushBullets(); plans.push('*' + line.slice(9).trim()); continue; }
    if (line.startsWith('[[PLAN]]'))  { flushPara(); flushBullets(); plans.push(line.slice(8).trim()); continue; }
    if (line.startsWith('[[NOTE]]')) {
      flushAll();
      out.push(`<div style="margin:0 0 18px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:13.5px;line-height:1.6;color:#64748b">${linkify(esc(fillTokens(line.slice(8).trim(), vars)), accent)}</div>`);
      continue;
    }
    if (line.startsWith('[[DIVIDER]]')) {
      flushAll();
      out.push('<div style="height:1px;background:#e2e8f0;margin:6px 0 22px"></div>');
      continue;
    }
    if (line.startsWith('## ')) {
      flushAll();
      out.push(`<h2 style="margin:6px 0 12px;font-size:19px;font-weight:800;color:#0f172a">${esc(fillTokens(line.slice(3).trim(), vars))}</h2>`);
      continue;
    }
    if (line.startsWith('- ')) { flushPara(); flushPlans(); bullets.push(line.slice(2).trim()); continue; }

    flushBullets(); flushPlans();
    para.push(line);
  }
  flushAll();
  return out.join('');
}

export function renderCampaignHtml(c: CampaignContent): string {
  const accent = /^#[0-9a-f]{6}$/i.test(String(c.brandColor || '')) ? String(c.brandColor) : '#6366f1';
  const brand = esc(c.brandName || 'Lumio');
  const heading = c.heading ? esc(fillTokens(c.heading, { name: c.recipientName, brand: c.brandName })) : '';
  const paragraphs = renderBody(String(c.body || ''), accent, {
    name: c.recipientName, brand: c.brandName,
  });
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
  if (c.body) {
    const plain = fillTokens(c.body, { name: c.recipientName, brand: c.brandName })
      .split('\n')
      .map((l) => l.trim())
      .map((l) => {
        if (l.startsWith('[[PLAN*]]') || l.startsWith('[[PLAN]]')) {
          const [name = '', price = '', tag = '', feats = ''] = l.replace(/^\[\[PLAN\*?\]\]/, '').split('|').map((x) => x.trim());
          return `* ${name} — ${price}${tag ? ` (${tag})` : ''}${feats ? `\n   - ${feats.split(';').map((x) => x.trim()).filter(Boolean).join('\n   - ')}` : ''}`;
        }
        if (l.startsWith('[[NOTE]]')) return l.slice(8).trim();
        if (l.startsWith('[[DIVIDER]]')) return '---';
        if (l.startsWith('## ')) return l.slice(3).trim().toUpperCase();
        if (l.startsWith('- ')) return `* ${l.slice(2).trim()}`;
        return l;
      })
      .join('\n');
    lines.push(plain, '');
  }
  const cta = safeUrl(c.ctaUrl);
  if (cta) lines.push(`${c.ctaLabel || 'Open'}: ${cta}`, '');
  if (c.footerNote) lines.push(c.footerNote, '');
  lines.push(`— ${c.brandName}`);
  if (c.unsubscribeUrl) lines.push(`Unsubscribe: ${c.unsubscribeUrl}`);
  return lines.join('\n');
}
