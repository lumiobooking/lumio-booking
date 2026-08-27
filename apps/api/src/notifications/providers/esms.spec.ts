import { toVietnamLocal, needsUnicode, describeCode, ESmsProvider } from './esms.provider';
import { routeSmsFor, hasESmsCredentials } from './sms-routing';

describe('no salon outside Vietnam is ever routed through eSMS', () => {
  // The whole safety argument. 25 live salons text their customers through
  // Twilio today, and a commit about Vietnam must not be able to move them.
  const goodCreds = { apiKey: 'k', secretKey: 's', brandname: 'LUMIO' };

  it.each(['US', 'CA', 'AU', 'GB', '', '   ', null, undefined, 'ZZ'])(
    'keeps market %s on its existing provider',
    (market) => {
      expect(routeSmsFor({ market, esms: goodCreds }).provider).toBe('twilio-or-existing');
    },
  );

  // Even with working Vietnamese credentials sitting right there.
  it('does not route a US salon to eSMS even when credentials exist', () => {
    expect(routeSmsFor({ market: 'US', esms: goodCreds })).toEqual({
      provider: 'twilio-or-existing',
      reason: 'non-vn-market',
    });
  });

  // 'vn' lowercase is the same market. A stored value's casing must not decide
  // which country's carriers a message goes to.
  it.each(['VN', 'vn', ' Vn '])('routes %s to eSMS', (market) => {
    expect(routeSmsFor({ market, esms: goodCreds }).provider).toBe('esms');
  });
});

describe('a half-configured Vietnamese salon behaves like an unconfigured one', () => {
  // Not like a broken one. Falling back to the existing path is the same thing
  // that happens today; throwing would be a new failure introduced by a feature.
  it.each([
    ['nothing at all', {}],
    ['keys but no brandname', { apiKey: 'k', secretKey: 's' }],
    ['brandname but no keys', { brandname: 'LUMIO' }],
    ['blank strings', { apiKey: '  ', secretKey: '  ', brandname: '  ' }],
    ['missing secret', { apiKey: 'k', brandname: 'LUMIO' }],
  ])('%s → falls back rather than failing', (_name, creds) => {
    expect(routeSmsFor({ market: 'VN', esms: creds })).toEqual({
      provider: 'twilio-or-existing',
      reason: 'vn-missing-credentials',
    });
  });

  it('requires all three before claiming to be configured', () => {
    expect(hasESmsCredentials({ apiKey: 'k', secretKey: 's', brandname: 'B' })).toBe(true);
    expect(hasESmsCredentials(null)).toBe(false);
  });
});

describe('phone numbers — eSMS wants local form, Twilio wants E.164', () => {
  // Sending one the other's format is a silent failure: accepted, then dropped.
  it.each([
    ['+84901888484', '0901888484'],
    ['84901888484', '0901888484'],
    ['0084901888484', '0901888484'],
    ['0901888484', '0901888484'],
    ['090 188 8484', '0901888484'],
    ['(090) 188-8484', '0901888484'],
    ['+84 90 188 84 84', '0901888484'],
  ])('%s → %s', (raw, expected) => {
    expect(toVietnamLocal(raw)).toBe(expected);
  });

  it.each([
    ['a US number', '+12015550123'],
    ['too short', '090188'],
    ['too long', '09018884840000'],
    ['a landline prefix', '0281234567'],
    ['empty', ''],
    ['letters', 'khong co so'],
  ])('refuses %s rather than guessing', (_name, raw) => {
    expect(toVietnamLocal(raw)).toBeNull();
  });

  it.each([null, undefined])('refuses %s', (raw) => {
    expect(toVietnamLocal(raw)).toBeNull();
  });
});

describe('unicode flag — it decides the length limit and the price', () => {
  // Getting it wrong truncates the message or gets it rejected.
  it('flags Vietnamese with tone marks', () => {
    expect(needsUnicode('Đặt lịch thành công lúc 14:00')).toBe(true);
    expect(needsUnicode('₫200.000')).toBe(true);
  });

  it('does not flag plain ASCII', () => {
    expect(needsUnicode('Dat lich thanh cong luc 14:00')).toBe(false);
    expect(needsUnicode('')).toBe(false);
  });

  // The first version of this used a mistyped character range and would have
  // flagged nearly every message as unicode — halving the length limit and
  // raising the bill on every single text.
  it('does not flag an ordinary English confirmation', () => {
    expect(needsUnicode('Your appointment at Lumio Nails is confirmed for 2:00 PM.')).toBe(false);
  });
});

describe('eSMS error codes, in words an operator can act on', () => {
  it.each([
    ['101', 'ApiKey'],
    ['104', 'Brandname'],
    ['146', 'Mẫu tin'],
    ['124', 'RequestId'],
    ['107', '30 số'],
  ])('explains %s', (code, contains) => {
    expect(describeCode(code)).toContain(contains);
  });

  it('passes through an unknown code with whatever eSMS said', () => {
    expect(describeCode('999', 'Something new')).toContain('Something new');
  });
});

describe('sending', () => {
  const cfg = { apiKey: 'k', secretKey: 's', brandname: 'LUMIO' };
  const okBody = { CodeResult: '100', SMSID: 'abc123' };
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => okBody });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  const bodyOf = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it('sends as CSKH (SmsType 2), not as advertising', async () => {
    await new ESmsProvider(cfg).sendSms({ to: '0901888484', body: 'Xin chao' });
    // Type 1 is advertising, a different endpoint and a different law. Sending a
    // receipt as an advert, or an advert as a receipt, is a compliance problem
    // either way.
    expect(bodyOf().SmsType).toBe('2');
  });

  it('converts the number to local form before sending', async () => {
    await new ESmsProvider(cfg).sendSms({ to: '+84901888484', body: 'Xin chao' });
    expect(bodyOf().Phone).toBe('0901888484');
  });

  it('reports 100 as accepted and carries the SMSID', async () => {
    const r = await new ESmsProvider(cfg).sendSms({ to: '0901888484', body: 'Xin chao' });
    // 100 means eSMS took the request, NOT that the customer got anything.
    // The SMSID is what a delivery callback later settles.
    expect(r).toEqual({ success: true, providerMessageId: 'abc123' });
  });

  it('passes a RequestId so a retry does not text the customer twice', async () => {
    await new ESmsProvider(cfg).sendSms({ to: '0901888484', body: 'Xin chao', requestId: 'notif-1' });
    expect(bodyOf().RequestId).toBe('notif-1');
  });

  it('does not call eSMS at all for a number that cannot be Vietnamese', async () => {
    const r = await new ESmsProvider(cfg).sendSms({ to: '+12015550123', body: 'Hi' });
    expect(r.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns a failure code into a readable reason', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ CodeResult: '104' }) });
    const r = await new ESmsProvider(cfg).sendSms({ to: '0901888484', body: 'Xin chao' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Brandname');
  });

  it('never throws when the network does', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const r = await new ESmsProvider(cfg).sendSms({ to: '0901888484', body: 'Xin chao' });
    expect(r.success).toBe(false);
  });

  it('refuses when no brandname is configured, without calling out', async () => {
    const r = await new ESmsProvider({ ...cfg, brandname: '' }).sendSms({ to: '0901888484', body: 'Hi' });
    expect(r.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
