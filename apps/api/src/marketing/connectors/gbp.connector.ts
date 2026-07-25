import { ChannelCreds, MonthlyMetrics, SocialConnector, VerifyResult, getJson, monthBounds, postForm } from './social-connector.interface';

const PERF = 'https://businessprofileperformance.googleapis.com/v1';

/** Google Business Profile Performance API — impressions, calls, directions, website clicks. */
export class GbpConnector implements SocialConnector {
  readonly platform = 'gbp' as const;
  readonly label = 'Google Maps (Business Profile)';
  readonly enabled = true;
  readonly hasSpend = false; // Maps has no ad spend.

  /** Use a raw access token if given, else exchange the refresh token. */
  private async accessToken(creds: ChannelCreds): Promise<string> {
    if (creds.token) return creds.token;
    if (creds.refreshToken && creds.clientId && creds.clientSecret) {
      const j = await postForm('https://oauth2.googleapis.com/token', {
        grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret,
      });
      if (!j.access_token) throw new Error(j.error_description || j.error || 'Could not refresh Google token');
      return j.access_token;
    }
    throw new Error('Provide an access token, or a refresh token + client id/secret');
  }

  private loc(creds: ChannelCreds): string {
    const id = (creds.externalAccountId || '').trim();
    return id.startsWith('locations/') ? id : `locations/${id}`;
  }

  /** Sum a single daily metric across the month. */
  private async metricSum(loc: string, metric: string, month: string, token: string): Promise<number | null> {
    const { since, until } = monthBounds(month);
    const [sy, sm, sd] = since.split('-'); const [uy, um, ud] = until.split('-');
    const q = `dailyMetric=${metric}` +
      `&dailyRange.start_date.year=${sy}&dailyRange.start_date.month=${Number(sm)}&dailyRange.start_date.day=${Number(sd)}` +
      `&dailyRange.end_date.year=${uy}&dailyRange.end_date.month=${Number(um)}&dailyRange.end_date.day=${Number(ud)}`;
    const r = await getJson(`${PERF}/${loc}:getDailyMetricsTimeSeries?${q}`, { Authorization: `Bearer ${token}` });
    if (!r.ok) throw new Error(r.json?.error?.message || `GBP ${r.status}`);
    const values = r.json?.timeSeries?.datedValues || [];
    let sum = 0; let any = false;
    for (const v of values) { if (v?.value != null) { sum += Number(v.value); any = true; } }
    return any ? sum : null;
  }

  async verify(creds: ChannelCreds): Promise<VerifyResult> {
    if (!creds.externalAccountId) return { ok: false, error: 'Location ID is required (locations/...)' };
    try {
      const token = await this.accessToken(creds);
      // A light call proves both the token and the location work.
      await this.metricSum(this.loc(creds), 'CALL_CLICKS', new Date().toISOString().slice(0, 7), token);
      return { ok: true, accountName: this.loc(creds) };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
  }

  /** Top search terms customers used to find the business this month. */
  private async searchKeywords(loc: string, month: string, token: string): Promise<Array<{ keyword: string; count: number | null }>> {
    const [y, m] = month.split('-').map(Number);
    const q = `monthlyRange.start_month.year=${y}&monthlyRange.start_month.month=${m}` +
      `&monthlyRange.end_month.year=${y}&monthlyRange.end_month.month=${m}`;
    const r = await getJson(`${PERF}/${loc}/searchkeywords/impressions/monthly?${q}`, { Authorization: `Bearer ${token}` });
    if (!r.ok) return [];
    const rows = (r.json?.searchKeywordsCounts as any[]) || [];
    return rows
      .map((x: any) => ({
        keyword: String(x?.searchKeyword ?? ''),
        count: x?.insightsValue?.value != null ? Number(x.insightsValue.value)
             : x?.insightsValue?.threshold != null ? Number(x.insightsValue.threshold) : null,
      }))
      .filter((x) => x.keyword)
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, 15);
  }

  async fetchMonthly(creds: ChannelCreds, month: string): Promise<MonthlyMetrics> {
    const token = await this.accessToken(creds);
    const loc = this.loc(creds);
    // Per-metric, resilient: a metric this business does not use (e.g. bookings)
    // returns null instead of failing the whole sync.
    const get = (metric: string) => this.metricSum(loc, metric, month, token).catch(() => null);
    const [dMaps, dSearch, mMaps, mSearch, calls, directions, website, bookings, conversations] = await Promise.all([
      get('BUSINESS_IMPRESSIONS_DESKTOP_MAPS'),
      get('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH'),
      get('BUSINESS_IMPRESSIONS_MOBILE_MAPS'),
      get('BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
      get('CALL_CLICKS'),
      get('BUSINESS_DIRECTION_REQUESTS'),
      get('WEBSITE_CLICKS'),
      get('BUSINESS_BOOKINGS'),
      get('BUSINESS_CONVERSATIONS'),
    ]);
    const sum = (...xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) : null;
    };
    const mapsImpr = sum(dMaps, mMaps);
    const searchImpr = sum(dSearch, mSearch);
    const desktopImpr = sum(dMaps, dSearch);
    const mobileImpr = sum(mMaps, mSearch);
    const impressions = sum(dMaps, dSearch, mMaps, mSearch);
    const keywords = await this.searchKeywords(loc, month, token).catch(() => []);
    return {
      spendCents: null,
      impressions,
      calls,
      directions,
      clicks: website,
      bookings,
      conversations,
      reach: impressions,
      raw: { gbp: { impressions, mapsImpr, searchImpr, desktopImpr, mobileImpr, calls, directions, websiteClicks: website, bookings, conversations, keywords } },
    };
  }
}
