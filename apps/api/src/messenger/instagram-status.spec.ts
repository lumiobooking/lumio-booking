/**
 * Instagram "receiving" is decided by what Facebook-Login delivery depends on,
 * never by the Instagram-Login-only `/{ig-id}/subscribed_apps` edge.
 */
import { igCustomer, igVerdict, type IgFacts } from './instagram-status';

const ok: IgFacts = {
  igId: '1784',
  pageSubscribed: true,
  app: { fields: ['messages', 'messaging_postbacks'], callbackUrl: 'https://lumio-api-uqm6.onrender.com/api/messenger/webhook' },
  myHosts: ['lumio-api-uqm6.onrender.com'],
  probe: { ok: true, newestAt: '2026-10-27T04:00:00Z' },
  ourNewestAt: '2026-10-27T04:00:30Z',
  lastEventAt: null,
};

describe('Instagram receiving', () => {
  it('a healthy salon reads OK — the empty Instagram-Login edge plays no part', () => {
    expect(igVerdict(ok).state).toBe('ok');
  });
  it('no Instagram linked is not "not receiving"', () => {
    expect(igVerdict({ ...ok, igId: null }).state).toBe('not_linked');
  });
  it('each real cause is named, first failing check wins', () => {
    expect(igVerdict({ ...ok, pageSubscribed: false }).reasonVi).toMatch(/Page Facebook chưa đăng ký/);
    expect(igVerdict({ ...ok, app: { ...ok.app!, fields: ['messaging_postbacks'] } }).reasonVi).toMatch(/App Lumio chưa đăng ký/);
    expect(igVerdict({ ...ok, app: { ...ok.app!, callbackUrl: 'https://lumio-api-vn.onrender.com/api/messenger/webhook' } }).reasonVi).toMatch(/lumio-api-vn/);
    expect(igVerdict({ ...ok, probe: { ok: false, error: '(#200) Requires instagram_manage_messages' } }).reasonVi).toMatch(/instagram_manage_messages/);
  });
  it('a callback on another host is fine once events have arrived here', () => {
    expect(igVerdict({ ...ok, app: { ...ok.app!, callbackUrl: 'https://api.lumiobooking.com/api/messenger/webhook' }, lastEventAt: '2026-10-27T03:00:00Z' }).state).toBe('ok');
  });
  it('Meta holding a newer conversation than the inbox is a missed DM', () => {
    expect(igVerdict({ ...ok, ourNewestAt: '2026-10-27T03:00:00Z' }).state).toBe('not_receiving');
    expect(igVerdict({ ...ok, ourNewestAt: null }).state).toBe('not_receiving');
    expect(igVerdict({ ...ok, probe: { ok: true, newestAt: null }, ourNewestAt: null }).state).toBe('ok');
  });
});

describe('the customer in a mirrored Instagram conversation', () => {
  it('is the participant who is neither the account nor the Page', () => {
    expect(igCustomer([{ id: '1784', username: 'ansenwellness' }, { id: '999', username: 'jane.doe' }], '1784', 'p1')).toEqual({ id: '999', name: 'jane.doe' });
    expect(igCustomer([{ id: '1784' }], '1784', 'p1')).toBeNull();
  });
});
