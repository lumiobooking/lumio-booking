import { pushAudience, pushPayload, isDeadEndpoint, PushDevice } from './push-payload';

const dev = (over: Partial<PushDevice> = {}): PushDevice => ({
  id: 'd1', userId: 'u1', endpoint: 'https://push.example/1', ...over,
});

describe('who gets woken up', () => {
  it('wakes every device the salon has registered', () => {
    const devices = [dev({ id: 'a', endpoint: 'e1' }), dev({ id: 'b', userId: 'u2', endpoint: 'e2' })];
    expect(pushAudience(devices)).toHaveLength(2);
  });

  it('does NOT buzz the person who just replied', () => {
    // Being buzzed by your own message is the single fastest way to make
    // somebody switch notifications off permanently.
    const devices = [dev({ userId: 'u1', endpoint: 'e1' }), dev({ userId: 'u2', endpoint: 'e2' })];
    expect(pushAudience(devices, { exceptUserId: 'u1' }).map((d) => d.endpoint)).toEqual(['e2']);
  });

  it('wakes everyone when nobody caused it — a customer wrote', () => {
    const devices = [dev({ userId: 'u1', endpoint: 'e1' }), dev({ userId: 'u2', endpoint: 'e2' })];
    expect(pushAudience(devices, { exceptUserId: null })).toHaveLength(2);
  });

  it('never buzzes the same device twice for one message', () => {
    const devices = [dev({ id: 'a', endpoint: 'same' }), dev({ id: 'b', endpoint: 'same' })];
    expect(pushAudience(devices)).toHaveLength(1);
  });

  it('skips rows with no endpoint rather than throwing', () => {
    const devices = [dev(), { id: 'x', userId: 'u', endpoint: '' }, null as never];
    expect(pushAudience(devices)).toHaveLength(1);
  });

  it('is empty when the salon has no devices', () => {
    expect(pushAudience([])).toEqual([]);
    expect(pushAudience(null as never)).toEqual([]);
  });
});

describe('what the notification says', () => {
  // The rule this whole file exists to protect.
  it('NEVER contains the customer’s message', () => {
    const secret = 'chị cho em xin số thẻ 4111 1111 1111 1111';
    const p = pushPayload({ name: 'Diana Huynh', pageName: 'Nailstop' });
    expect(JSON.stringify(p)).not.toContain(secret);
    expect(JSON.stringify(p)).not.toContain('4111');
  });

  it('names the customer, because that is what makes somebody stop what they are doing', () => {
    expect(pushPayload({ name: 'Diana Huynh' }).title).toBe('Diana Huynh vừa nhắn tin');
  });

  it('says which Page when the salon runs more than one', () => {
    expect(pushPayload({ name: 'Mai', pageName: 'Nailstop' }).body).toContain('Nailstop');
  });

  it('falls back to a polite word when Meta gave no name', () => {
    expect(pushPayload({ name: null }).title).toBe('Khách vừa nhắn tin');
    expect(pushPayload({ name: '   ' }).title).toBe('Khách vừa nhắn tin');
  });

  it('speaks English when the salon does', () => {
    expect(pushPayload({ name: 'Diana', vi: false }).title).toBe('Diana sent a message');
  });

  it('uses one tag, so a busy morning replaces instead of stacking', () => {
    expect(pushPayload({ name: 'a' }).tag).toBe(pushPayload({ name: 'b' }).tag);
  });

  it('lands on the inbox', () => {
    expect(pushPayload({ name: 'a' }).url).toBe('/staff/inbox');
    expect(pushPayload({ name: 'a', url: '/salon/inbox' }).url).toBe('/salon/inbox');
  });
});

describe('when a device has gone for good', () => {
  it.each([404, 410, '410'])('%s means delete the row', (code) => {
    // Retrying these forever, several times an hour, for every message, is how
    // a push service starts rate-limiting the devices that DO still work.
    expect(isDeadEndpoint(code)).toBe(true);
  });

  it.each([429, 500, 502, 503, 0, undefined, null, 'boom'])('%s means keep it — this is temporary', (code) => {
    // Deleting somebody's device because a push service had a bad minute
    // unsubscribes a person who never asked to be unsubscribed, and they will
    // never know: it fails silent in exactly the direction nobody checks.
    expect(isDeadEndpoint(code)).toBe(false);
  });
});
