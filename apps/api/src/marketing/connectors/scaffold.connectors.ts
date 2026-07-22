import { ChannelCreds, MonthlyMetrics, SocialConnector, SocialPlatform, VerifyResult } from './social-connector.interface';

/**
 * Scaffolded connectors. The framework, storage, sync and UI already treat them
 * as first-class; they are `enabled: false` only because they need the platform's
 * heaviest approvals (TikTok app review, Google Ads developer token) and cannot be
 * finished/tested without live credentials. The registry refuses to use a disabled
 * connector, so a salon never sees a half-working integration.
 *
 * TikTok — Reporting: POST https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/
 *   headers: Access-Token; body: advertiser_id, report_type=BASIC, dimensions, metrics
 *   (spend, impressions, clicks, reach), start_date, end_date.
 * Google Ads — GAQL: POST https://googleads.googleapis.com/v17/customers/{id}/googleAds:searchStream
 *   headers: Authorization Bearer, developer-token; query selects metrics.cost_micros,
 *   metrics.impressions, metrics.clicks, metrics.conversions over segments.date.
 */
abstract class ScaffoldConnector implements SocialConnector {
  abstract readonly platform: SocialPlatform;
  abstract readonly label: string;
  readonly enabled = false;
  readonly hasSpend = true;
  async verify(_creds: ChannelCreds): Promise<VerifyResult> { return { ok: false, error: `${this.label} connector is not enabled yet` }; }
  async fetchMonthly(_creds: ChannelCreds, _month: string): Promise<MonthlyMetrics> { throw new Error(`${this.label} connector is not enabled yet`); }
}

export class TikTokConnector extends ScaffoldConnector { readonly platform = 'tiktok' as const; readonly label = 'TikTok Ads'; }
export class GoogleAdsConnector extends ScaffoldConnector { readonly platform = 'google_ads' as const; readonly label = 'Google Ads'; }
