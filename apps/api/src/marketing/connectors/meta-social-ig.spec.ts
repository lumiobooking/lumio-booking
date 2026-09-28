import { MetaSocialConnector } from './meta-social.connector';
import * as iface from './social-connector.interface';

/**
 * The Instagram column of the report came back blank — followers and new
 * follows filled, reach / views / engagement "—". The sync rides on the
 * Messenger Page token now; this checks the two ways the connector recovers:
 * a second (agency) token for the insights, and the month's own posts when
 * the account-level numbers are missing.
 */
type Resp = { ok: boolean; status: number; json: any };
const ok = (json: any): Resp => ({ ok: true, status: 200, json });
const fail = (msg: string): Resp => ({ ok: false, status: 400, json: { error: { message: msg } } });

function route(url: string, opts: { pageTokenInsights: boolean; agencyInsights: boolean }): Resp {
  const tok = decodeURIComponent((url.match(/access_token=([^&]+)/) || [])[1] || '');
  const isAgency = tok === 'agency';
  if (/\/page1\?fields=id,name/.test(url)) return ok({ id: 'page1', name: 'Lux', followers_count: 752, instagram_business_account: { id: 'ig1' } });
  if (/\/page1\?fields=access_token/.test(url)) return ok({ access_token: tok });
  if (/\/page1\//.test(url)) return ok({ data: [] });
  if (/\/ig1\?fields=followers_count/.test(url)) return ok({ followers_count: 123, username: 'luxnailspa_tx' });
  if (/\/ig1\/media\?/.test(url)) {
    return ok({ data: [
      { id: 'm1', media_type: 'IMAGE', timestamp: '2026-09-10T10:00:00+0000', like_count: 10, comments_count: 2, caption: 'đẹp 💅' },
      { id: 'm2', media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-09-12T10:00:00+0000', like_count: 5, comments_count: 1 },
    ] });
  }
  if (/\/m[12]\/insights/.test(url)) return fail('no media insights');
  if (/\/ig1\/insights\?metric=(reach|views|total_interactions)/.test(url)) {
    const allowed = isAgency ? opts.agencyInsights : opts.pageTokenInsights;
    if (!allowed) return fail('(#10) Application does not have permission for this action');
    if (!/metric_type=total_value/.test(url)) return fail('needs total_value');
    const m = url.match(/metric=([a-z_]+)/)![1];
    return ok({ data: [{ name: m, total_value: { value: m === 'reach' ? 900 : m === 'views' ? 4000 : 77 } }] });
  }
  if (/\/ig1\/insights\?metric=follower_count/.test(url)) return ok({ data: [{ values: [{ value: 1, end_time: '2026-09-02' }, { value: 1, end_time: '2026-09-03' }] }] });
  return fail('unrouted');
}

describe('Instagram numbers in the monthly report', () => {
  let seen: string[] = [];
  const setup = (opts: { pageTokenInsights: boolean; agencyInsights: boolean }) => {
    seen = [];
    jest.spyOn(iface, 'getJson').mockImplementation(async (url: string) => { seen.push(url); return route(url, opts); });
  };
  afterEach(() => jest.restoreAllMocks());

  it('falls back to the agency token when the Messenger Page token cannot read insights', async () => {
    setup({ pageTokenInsights: false, agencyInsights: true });
    const r = await new MetaSocialConnector().fetchOrganic!({ token: 'pagetok', fallbackToken: 'agency', externalAccountId: 'page1' }, '2026-09');
    expect(r.instagram).toMatchObject({ followers: 123, reach: 900, views: 4000, engagement: 77, newFollowers: 2 });
  });

  it('with no token able to read insights, engagement comes from the month\'s posts and the reason is kept', async () => {
    setup({ pageTokenInsights: false, agencyInsights: false });
    const r = await new MetaSocialConnector().fetchOrganic!({ token: 'pagetok', externalAccountId: 'page1' }, '2026-09');
    expect(r.instagram?.engagement).toBe(18); // 10+2 + 5+1
    expect(r.instagram?.reach).toBeNull();
    const dbg = (r.instagram?.raw as any).igDebug;
    expect(dbg.posts).toBe(2);
    expect(dbg.errors.join(' ')).toMatch(/permission/);
  });

  it('never asks Instagram for a range that ends in the future', async () => {
    setup({ pageTokenInsights: true, agencyInsights: true });
    const month = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    await new MetaSocialConnector().fetchOrganic!({ token: 'pagetok', externalAccountId: 'page1' }, month);
    const untils = seen.filter((u) => /\/ig1\/insights/.test(u)).map((u) => (u.match(/until=([0-9-]+)/) || [])[1]).filter(Boolean);
    expect(untils.length).toBeGreaterThan(0);
    for (const u of untils) expect(u <= today).toBe(true);
  });
});
