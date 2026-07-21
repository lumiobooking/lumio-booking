import {
  DejavooSpinCloudAdapter,
  packDejavooSecret,
  parseDejavooSecret,
  toReferenceId,
} from './dejavoo-spin-cloud.adapter';
import { AdapterCredentials } from './terminal-adapter.interface';

/**
 * The behaviour these tests protect is "never charge the customer twice".
 * Every ambiguous provider answer must come back as UNKNOWN, never as a
 * failure that would tempt the POS into retrying.
 */

const CRED: AdapterCredentials = { secret: 'zbhRAW9N6x', tpn: 'Z11NATASHA98', environment: 'sandbox' };

type Call = { url: string; init: any };
let calls: Call[] = [];

function mockFetch(responder: (url: string, init: any) => { status?: number; body: unknown } | Promise<never>) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    const r = await responder(url, init);
    return { status: (r as any).status ?? 200, text: async () => JSON.stringify((r as any).body) };
  });
}

function approvedSale(referenceId = '111') {
  return {
    GeneralResponse: { ResultCode: '0', StatusCode: '0000', Message: 'Approved', DetailedMessage: 'Approved' },
    AuthCode: 'AXS009',
    ReferenceId: referenceId,
    BatchNumber: '993',
    TransactionNumber: '9',
    RRN: '517705501432',
    Amounts: { TotalAmount: 27.5, Amount: 27.5, TipAmount: 2.5 },
    CardData: { CardType: 'Visa', CardBrand: 'Visa', Last4: '1234', EntryType: 'ChipContactless' },
  };
}

function body(i: number) {
  return JSON.parse(calls[i].init.body);
}

describe('DejavooSpinCloudAdapter', () => {
  let a: DejavooSpinCloudAdapter;
  const realFetch = (globalThis as any).fetch;

  beforeEach(() => {
    a = new DejavooSpinCloudAdapter();
    calls = [];
  });
  afterAll(() => {
    (globalThis as any).fetch = realFetch;
  });

  // ------------------------------------------------------------- references

  it('derives a stable, alphanumeric reference no longer than 50 chars', () => {
    expect(toReferenceId('ord-123_ab')).toBe('ord123ab');
    expect(toReferenceId('ord-123_ab')).toBe(toReferenceId('ord-123_ab')); // deterministic
    expect(toReferenceId('x'.repeat(80))).toHaveLength(50);
    expect(() => toReferenceId('---')).toThrow();
  });

  it('round-trips packed credentials and tolerates a bare auth key', () => {
    const packed = packDejavooSecret(CRED);
    expect(parseDejavooSecret(packed)).toMatchObject({ secret: 'zbhRAW9N6x', tpn: 'Z11NATASHA98', environment: 'sandbox' });
    expect(parseDejavooSecret('plainAuthKey')).toMatchObject({ secret: 'plainAuthKey', environment: 'production' });
  });

  // ------------------------------------------------------------------ sale

  it('sends dollars (not cents), folds the tip into Amount, and authenticates in the body', async () => {
    mockFetch(() => ({ body: approvedSale('ORD1') }));
    const r = await a.createPayment(CRED, { amountCents: 2500, tipCents: 250, currency: 'USD', reference: 'ORD-1' });

    const sent = body(0);
    expect(calls[0].url).toBe('https://test.spinpos.net/v2/Payment/Sale');
    expect(sent.Amount).toBe(27.5); // 2500 + 250 cents -> dollars
    expect(sent.TipAmount).toBe(2.5);
    expect(sent.ReferenceId).toBe('ORD1');
    expect(sent.Tpn).toBe('Z11NATASHA98');
    expect(sent.Authkey).toBe('zbhRAW9N6x'); // lowercase k, per spec
    expect(r.outcome).toBe('APPROVED');
    expect(r.approvalCode).toBe('AXS009');
    expect(r.last4).toBe('1234');
    expect(r.tipCents).toBe(250);
  });

  it('reports a decline as DECLINED', async () => {
    mockFetch(() => ({ body: { GeneralResponse: { ResultCode: '1', StatusCode: '1015', Message: 'Declined' } } }));
    expect((await a.createPayment(CRED, { amountCents: 100, currency: 'USD', reference: 'A1' })).outcome).toBe('DECLINED');
  });

  it('reports a customer cancel as CANCELED', async () => {
    mockFetch(() => ({ body: { GeneralResponse: { ResultCode: '1', StatusCode: '1012', Message: 'Canceled' } } }));
    expect((await a.createPayment(CRED, { amountCents: 100, currency: 'USD', reference: 'A2' })).outcome).toBe('CANCELED');
  });

  // -------------------------------------------------- the double-charge guard

  it('treats a proxy timeout as UNKNOWN, never as a failure', async () => {
    mockFetch(() => ({ body: { GeneralResponse: { ResultCode: '2', StatusCode: '2007', Message: 'The operation has timed out' } } }));
    const r = await a.createPayment(CRED, { amountCents: 5000, currency: 'USD', reference: 'A3' });
    expect(r.outcome).toBe('UNKNOWN');
    expect(r.outcome).not.toBe('DECLINED');
  });

  it('keeps the reference when the network aborts, so the sale can be resolved later', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new Error('aborted');
    });
    const r = await a.createPayment(CRED, { amountCents: 5000, currency: 'USD', reference: 'ORD-9' });
    expect(r.outcome).toBe('UNKNOWN');
    expect(r.externalId).toBe('ORD9');
  });

  it('resolves a duplicate reference by reading the existing sale instead of charging again', async () => {
    mockFetch((url) =>
      url.includes('/Sale')
        ? { body: { GeneralResponse: { ResultCode: '1', StatusCode: '1011', Message: 'Duplicate Reference ID' } } }
        : { body: approvedSale('ORD7') },
    );
    const r = await a.createPayment(CRED, { amountCents: 1000, currency: 'USD', reference: 'ORD-7' });

    expect(calls.map((c) => c.url.split('/v2')[1])).toEqual(['/Payment/Sale', '/Payment/Status']);
    expect(r.outcome).toBe('APPROVED');
    // Exactly one Sale was attempted.
    expect(calls.filter((c) => c.url.includes('/Sale'))).toHaveLength(1);
  });

  it('reports "no such transaction" as an error, the one state where retrying is safe', async () => {
    mockFetch(() => ({ body: { GeneralResponse: { ResultCode: '1', StatusCode: '1001', Message: 'Not Found' } } }));
    const r = await a.getPaymentStatus(CRED, 'ORD-404');
    expect(r.outcome).toBe('ERROR');
    expect(r.message).toMatch(/No transaction found/i);
  });

  it('passes through the wait time when the terminal is busy', async () => {
    mockFetch(() => ({ body: { GeneralResponse: { ResultCode: '2', StatusCode: '2008', Message: 'Terminal in use', DelayBeforeNextRequest: 12 } } }));
    const r = await a.createPayment(CRED, { amountCents: 100, currency: 'USD', reference: 'A4' });
    expect(r.outcome).toBe('ERROR');
    expect(r.retryAfterSeconds).toBe(12);
  });

  // ------------------------------------------------------------ void / refund

  it('voids against the ORIGINAL reference and amount', async () => {
    mockFetch(() => ({ body: approvedSale('ORD5') }));
    await a.voidPayment(CRED, { reference: 'ORD-5', amountCents: 4200 });
    expect(calls[0].url).toContain('/v2/Payment/Void');
    expect(body(0)).toMatchObject({ ReferenceId: 'ORD5', Amount: 42 });
  });

  it('refunds with a NEW deterministic reference and supports partial amounts', async () => {
    mockFetch(() => ({ body: approvedSale('R') }));
    const r1 = await a.refund(packDejavooSecret(CRED), 'ORD5', 1000);
    const first = body(0);

    calls = [];
    mockFetch(() => ({ body: approvedSale('R') }));
    await a.refund(packDejavooSecret(CRED), 'ORD5', 1000);

    expect(calls[0].url).toContain('/v2/Payment/Return');
    expect(first.ReferenceId).not.toBe('ORD5'); // must not reuse the sale reference
    expect(body(0).ReferenceId).toBe(first.ReferenceId); // same input -> same reference
    expect(first.Amount).toBe(10); // partial refund of a larger sale
    expect(r1.status).toBe('SUCCEEDED');
  });

  it('refuses a refund with no amount rather than guessing the full value', async () => {
    const r = await a.refund(packDejavooSecret(CRED), 'ORD5');
    expect(r.status).toBe('FAILED');
  });

  // --------------------------------------------------------- terminal health

  it('checks terminal health over GET with lowercase query keys', async () => {
    mockFetch(() => ({ body: { TerminalStatus: 'Online', Tpn: 'Z11NATASHA98', ErrorDescription: '' } }));
    const h = await a.testConnection(CRED);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].url).toContain('request.tpn=Z11NATASHA98');
    expect(calls[0].url).toContain('request.authkey=zbhRAW9N6x');
    expect(h.online).toBe(true);
  });

  it('treats anything other than Online as offline', async () => {
    mockFetch(() => ({ status: 404, body: { TerminalStatus: 'NotFound', ErrorDescription: 'bad tpn' } }));
    expect((await a.testConnection(CRED)).online).toBe(false);
  });

  it('refuses to connect without a TPN', async () => {
    const r = await a.connect({ secret: 'zbhRAW9N6x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/TPN/i);
  });

  // ------------------------------------------------------------- card safety

  it('never surfaces anything beyond brand and last 4', async () => {
    mockFetch(() => ({ body: approvedSale('ORD8') }));
    const r = await a.createPayment(CRED, { amountCents: 100, currency: 'USD', reference: 'ORD-8' });
    expect(Object.keys(r)).not.toContain('pan');
    expect(r.last4).toHaveLength(4);
    expect(JSON.stringify({ brand: r.cardBrand, last4: r.last4 })).not.toMatch(/\d{12,}/);
  });
});
