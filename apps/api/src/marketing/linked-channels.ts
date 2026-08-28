import { ChannelCreds } from './connectors/social-connector.interface';

/**
 * Reusing connections the salon has ALREADY made, instead of asking again.
 *
 * The report page used to ask for a Facebook connection and a Google connection
 * that other screens of the same product already held:
 *
 *   meta_social  — Messenger AI holds a Page token, the Page ID and the linked
 *                  Instagram. Exactly what the organic-insights connector needs.
 *   gbp          — Google Reviews holds a business.manage refresh token and the
 *                  location. business.manage is the SAME scope the Performance
 *                  API needs, so that OAuth already covers this.
 *
 * Being asked to connect something twice does not read as "two features" to a
 * salon owner; it reads as "this software does not know what I already did."
 * And the second connection is a second thing that can silently expire.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER
 *
 *   meta (Ads)   — an ad account is a different asset from a Page, and a Page
 *                  token cannot read spend. Reusing the Messenger connection
 *                  here would VERIFY fine and then sync nothing, which is the
 *                  worst outcome: a green tick over an empty report.
 *   tiktok       — no other screen has ever connected TikTok.
 *
 * PRECEDENCE: an explicit connection made on the report page always wins over
 * a linked one. A salon that manages its own ads/insights with its own token
 * has said something deliberate, and a fallback must never override it.
 */

/** What the messenger module knows, reduced to what this decision needs. */
export interface MessengerLink {
  pageId?: string | null;
  pageToken?: string | null;
  pageName?: string | null;
}

/** What the Google-reviews settings know, reduced likewise. */
export interface GbrLink {
  connected?: boolean;
  refreshToken?: string | null;
  locationId?: string | null;
  locationTitle?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
}

export interface LinkedCreds {
  creds: ChannelCreds;
  /** Where the credentials came from — shown to the salon so the green tick
   *  explains itself ("dùng kết nối Messenger AI"), and shown INSTEAD of a
   *  connect form. */
  source: 'messenger' | 'google-reviews';
  accountName: string;
}

export function linkedMetaSocial(link: MessengerLink | null | undefined): LinkedCreds | null {
  const pageId = String(link?.pageId ?? '').trim();
  const token = String(link?.pageToken ?? '').trim();
  // Both or nothing. A page id without its token would make verify() fall back
  // to the agency token and read a DIFFERENT salon's asset permissions.
  if (!pageId || !token) return null;
  return {
    creds: { token, externalAccountId: pageId },
    source: 'messenger',
    accountName: String(link?.pageName ?? '').trim() || pageId,
  };
}

export function linkedGbp(link: GbrLink | null | undefined): LinkedCreds | null {
  if (!link?.connected) return null;
  const refreshToken = String(link.refreshToken ?? '').trim();
  const locationId = String(link.locationId ?? '').trim();
  const clientId = String(link.clientId ?? '').trim();
  const clientSecret = String(link.clientSecret ?? '').trim();
  // The refresh token is useless without the app's client id/secret (they are
  // what the token exchange authenticates as), and the location id is the
  // asset being read. Any of them missing means "not linkable", not "try".
  if (!refreshToken || !locationId || !clientId || !clientSecret) return null;
  return {
    creds: {
      refreshToken,
      clientId,
      clientSecret,
      externalAccountId: locationId.startsWith('locations/') ? locationId : `locations/${locationId}`,
    },
    source: 'google-reviews',
    accountName: String(link.locationTitle ?? '').trim() || locationId,
  };
}

/** One entry point so the service has a single question to ask. */
export function linkedCredsFor(
  platform: string,
  sources: { messenger?: MessengerLink | null; gbr?: GbrLink | null },
): LinkedCreds | null {
  if (platform === 'meta_social') return linkedMetaSocial(sources.messenger);
  if (platform === 'gbp') return linkedGbp(sources.gbr);
  // meta (Ads) and tiktok on purpose — see the header comment.
  return null;
}

/** The platforms worth attempting a linked sync for, in syncAllChannels. */
export const LINKABLE_PLATFORMS = ['meta_social', 'gbp'] as const;
