/**
 * The salon's public pages on each connected channel (9 Nov 2026).
 *
 * Built ONLY from what the salon itself connected in Lumio (Social channels):
 * its Facebook Page, the Instagram account linked to that Page, its Google
 * Business Profile and its TikTok account. Used twice:
 *  - the Social channels screen: "Open on Facebook ↗" — staff check they
 *    connected the RIGHT page;
 *  - the public booking page: follow buttons for customers.
 * Every id is checked against its platform's shape, so a stored value can
 * never turn into a link to somewhere else. Nothing secret is read.
 */

export type SocialChannel = 'facebook' | 'instagram' | 'google' | 'tiktok';
export interface SocialLink { channel: SocialChannel; url: string; handle?: string }

export interface SocialSource {
  pages?: { pageId: string; pageName?: string | null; igUsername?: string | null; enabled?: boolean }[] | null;
  google?: { connected?: boolean; placeId?: string | null } | null;
  tiktok?: { connected?: boolean; username?: string | null } | null;
}

const FB_ID = /^\d{5,25}$/;
const IG_USER = /^(?!.*\.\.)[A-Za-z0-9._]{1,30}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const TT_USER = /^[A-Za-z0-9._]{2,24}$/;

const clean = (v: unknown) => String(v ?? '').trim().replace(/^@/, '');

export function googleMapsUrl(placeId: unknown): string | null {
  const p = clean(placeId);
  return PLACE_ID.test(p) ? `https://www.google.com/maps/place/?q=place_id:${p}` : null;
}

export function socialLinks(src: SocialSource): SocialLink[] {
  const out: SocialLink[] = [];
  const pages = (src.pages ?? []).filter((p) => p && p.enabled !== false);
  const fb = pages.find((p) => FB_ID.test(clean(p.pageId)));
  if (fb) out.push({ channel: 'facebook', url: `https://www.facebook.com/${clean(fb.pageId)}`, handle: fb.pageName ?? undefined });
  const ig = pages.map((p) => clean(p.igUsername)).find((u) => IG_USER.test(u));
  if (ig) out.push({ channel: 'instagram', url: `https://www.instagram.com/${ig}/`, handle: `@${ig}` });
  if (src.google?.connected) {
    const g = googleMapsUrl(src.google.placeId);
    if (g) out.push({ channel: 'google', url: g });
  }
  if (src.tiktok?.connected) {
    const t = clean(src.tiktok.username);
    if (TT_USER.test(t)) out.push({ channel: 'tiktok', url: `https://www.tiktok.com/@${t}`, handle: `@${t}` });
  }
  return out;
}
