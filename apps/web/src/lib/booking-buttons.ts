/**
 * The booking page's buttons in the salon's own colours (9 Nov 2026), and its
 * follow buttons for the channels the salon connected (api common/social-links).
 * Pure, so the colour rules are tested without a browser.
 */

export type SocialChannel = 'facebook' | 'instagram' | 'google' | 'tiktok';
export interface SocialLink { channel: SocialChannel; url: string; handle?: string }
export type SocialStyle = 'brand' | 'salon' | 'outline' | 'off';

const HEX6 = /^#[0-9a-f]{6}$/i;

export function hex6(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return HEX6.test(s) ? s.toLowerCase() : null;
}

/** Relative luminance (WCAG) of a #rrggbb colour. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** White or near-black — whichever reads better on `bg`. */
export function inkOn(bg: string): string {
  return contrast(bg, '#ffffff') >= contrast(bg, '#0f172a') ? '#ffffff' : '#0f172a';
}

function darker(hex: string, by: number): string {
  const n = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - by)));
  return `#${n.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface ButtonLook { bg: string; dark: string; ink: string; glow: string; readable: boolean }

/**
 * The main button colours. Empty settings = exactly as before (the accent,
 * white text). A text colour that cannot be read on the button is replaced
 * by the automatic one — `readable` says so, for the settings screen.
 */
export function buttonLook(branding: { buttonColor?: string; buttonTextColor?: string } | null | undefined, accent: string): ButtonLook {
  const bg = hex6(branding?.buttonColor) ?? hex6(accent) ?? '#6366f1';
  const asked = hex6(branding?.buttonTextColor);
  const custom = Boolean(hex6(branding?.buttonColor));
  const auto = custom ? inkOn(bg) : '#ffffff';
  const readable = !asked || contrast(bg, asked) >= 3;
  const ink = asked && readable ? asked : auto;
  return { bg, dark: darker(bg, 0.22), ink, glow: `${bg}8c`, readable };
}

/** CSS variables the page's buttons read (book/[slug] ctaBtn / primaryBtn). */
export function buttonVars(branding: Parameters<typeof buttonLook>[0], accent: string): Record<string, string> {
  const b = buttonLook(branding, accent);
  return { '--btn': b.bg, '--btn-dark': b.dark, '--btn-ink': b.ink, '--btn-glow': b.glow };
}

export const SOCIAL_META: Record<SocialChannel, { name: string; icon: string; color: string; ink: string }> = {
  facebook: { name: 'Facebook', icon: '👍', color: '#1877f2', ink: '#ffffff' },
  instagram: { name: 'Instagram', icon: '📷', color: '#d62976', ink: '#ffffff' },
  google: { name: 'Google Maps', icon: '📍', color: '#1a73e8', ink: '#ffffff' },
  tiktok: { name: 'TikTok', icon: '🎵', color: '#111111', ink: '#ffffff' },
};

export function socialStyleOf(v: unknown): SocialStyle {
  return v === 'salon' || v === 'outline' || v === 'off' ? v : 'brand';
}

/** One follow button's colours for the chosen style. */
export function socialLook(channel: SocialChannel, style: SocialStyle, btn: ButtonLook): { bg: string; ink: string; border: string } {
  const m = SOCIAL_META[channel];
  if (style === 'salon') return { bg: btn.bg, ink: btn.ink, border: btn.bg };
  if (style === 'outline') return { bg: '#ffffff', ink: btn.bg, border: btn.bg };
  return { bg: m.color, ink: m.ink, border: m.color };
}

/** Only real https links on the four platforms are ever drawn. */
export function safeSocial(list: unknown): SocialLink[] {
  if (!Array.isArray(list)) return [];
  const ok: Record<SocialChannel, RegExp> = {
    facebook: /^https:\/\/www\.facebook\.com\/\d+$/,
    instagram: /^https:\/\/www\.instagram\.com\/[A-Za-z0-9._]+\/$/,
    google: /^https:\/\/www\.google\.com\/maps\/place\/\?q=place_id:[A-Za-z0-9_-]+$/,
    tiktok: /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]+$/,
  };
  return list.filter((l): l is SocialLink => Boolean(l && typeof l === 'object' && (l as SocialLink).channel in ok && ok[(l as SocialLink).channel].test(String((l as SocialLink).url))));
}
