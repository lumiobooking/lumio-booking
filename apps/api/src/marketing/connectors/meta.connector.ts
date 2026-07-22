import { ChannelCreds, MonthlyMetrics, SocialConnector, VerifyResult, getJson, monthBounds } from './social-connector.interface';

const GRAPH = 'https://graph.facebook.com/v21.0';

/** Meta Marketing API — account-level Insights (spend, impressions, reach, clicks). */
export class MetaConnector implements SocialConnector {
  readonly platform = 'meta' as const;
  readonly label = 'Facebook / Instagram';
  readonly enabled = true;
  readonly hasSpend = true;

  private acct(creds: ChannelCreds): string {
    const id = (creds.externalAccountId || '').trim();
    return id.startsWith('act_') ? id : `act_${id}`;
  }

  async verify(creds: ChannelCreds): Promise<VerifyResult> {
    if (!creds.token) return { ok: false, error: 'Access token is required' };
    if (!creds.externalAccountId) return { ok: false, error: 'Ad Account ID is required (act_...)' };
    const r = await getJson(`${GRAPH}/${this.acct(creds)}?fields=name,account_status&access_token=${encodeURIComponent(creds.token)}`);
    if (!r.ok) return { ok: false, error: r.json?.error?.message || `Meta ${r.status}` };
    return { ok: true, accountName: r.json?.name };
  }

  async fetchMonthly(creds: ChannelCreds, month: string): Promise<MonthlyMetrics> {
    const { since, until } = monthBounds(month);
    const tr = encodeURIComponent(JSON.stringify({ since, until }));
    const url = `${GRAPH}/${this.acct(creds)}/insights?level=account&fields=spend,impressions,reach,clicks&time_range=${tr}&access_token=${encodeURIComponent(creds.token || '')}`;
    const r = await getJson(url);
    if (!r.ok) throw new Error(r.json?.error?.message || `Meta insights ${r.status}`);
    const row = (r.json?.data && r.json.data[0]) || {};
    const num = (v: any) => (v == null || v === '' ? null : Number(v));
    return {
      spendCents: row.spend != null ? Math.round(Number(row.spend) * 100) : null,
      impressions: num(row.impressions),
      reach: num(row.reach),
      clicks: num(row.clicks),
      raw: row,
    };
  }
}
