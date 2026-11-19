import { amountsIn, applyBankCredit, cleanRequests, newPayCode, payCodeInText, payQrImageUrl, readClaim, suggestedDeposit, type PayRequest } from './chat-pay';
import { ChatPayService } from './chat-pay.service';
import { keepFromReading } from './photo-library.service';
import { blockedReason } from './photo-library';
import { payCodeIn } from '../restaurant/check-logic';

const req = (o: Partial<PayRequest> = {}): PayRequest => ({ code: 'LB482913', threadId: 'tA', appointmentId: null, amountCents: 100000, at: '2026-11-19T05:00:00Z', by: null, status: 'sent', claim: null, bank: null, ...o });

describe('chat deposit QR — pure', () => {
  it('codes: LB + six digits, never one already open, and found wherever the bank put it', () => {
    let i = 0;
    const seq = [0.1, 0.1, 0.5];
    const taken = new Set([newPayCode(new Set(), () => 0.1)]);
    expect(newPayCode(taken, () => seq[i++])).not.toBe([...taken][0]);
    expect(payCodeInText('MBVCB.123.LB482913.CHUYEN TIEN')).toBe('LB482913');
    expect(payCodeInText('chuyen khoan lb 482913 coc')).toBe('LB482913');
    expect(payCodeInText('LB4829131')).toBeNull();
    // The restaurant bill code and the chat code never read as each other.
    expect(payCodeIn('LB482913')).toBeNull();
    expect(payCodeInText('LM57')).toBeNull();
  });

  it('reads amounts off a receipt in the ways Vietnamese banks write them', () => {
    expect(amountsIn('Số tiền: 100.000đ · Phí 0đ · Số dư 1,250,000 VND')).toEqual([100000, 1250000]);
    expect(amountsIn('+500000')).toEqual([500000]);
  });

  it('a receipt claim prefers the requested amount, and notes whether the code was there', () => {
    expect(readClaim(req(), 'Chuyển khoản thành công 100.000 VND nội dung LB482913. Số dư 2.300.000')).toEqual({ amountCents: 100000, codeSeen: true });
    expect(readClaim(req(), 'Đã chuyển 50.000đ')).toEqual({ amountCents: 50000, codeSeen: false });
  });

  it('bank credit: paid when it covers, partial when short, counted once per bank ref', () => {
    let r = applyBankCredit([req()], 'LB482913', 50000, 'ref1', 'now');
    expect(r.hit?.status).toBe('partial');
    r = applyBankCredit(r.list, 'LB482913', 50000, 'ref2', 'now');
    expect(r.hit?.status).toBe('paid');
    expect(r.list[0].bank?.amountCents).toBe(100000);
    expect(applyBankCredit(r.list, 'LB482913', 50000, 'ref2', 'now').hit).toBeNull();
    expect(applyBankCredit([req()], 'LB000000', 50000, 'x', 'now').hit).toBeNull();
  });

  it('stored list is cleaned: bad codes, ids and amounts dropped', () => {
    expect(cleanRequests([req(), { code: 'XX1', threadId: 'a', amountCents: 1 }, { ...req(), threadId: 'bad id!' }, { ...req(), amountCents: 0 }])).toHaveLength(1);
  });

  it('suggested deposit follows the salon rule', () => {
    expect(suggestedDeposit({ enabled: true, type: 'percent', percent: 30 }, 500000)).toBe(150000);
    expect(suggestedDeposit({ enabled: true, type: 'fixed', fixedCents: 100000 }, 0)).toBe(100000);
    expect(suggestedDeposit({ enabled: false, type: 'fixed', fixedCents: 100000 }, 500000)).toBeNull();
  });

  it('QR picture carries the exact amount and code', () => {
    expect(payQrImageUrl({ bin: '970436', accountNo: '0123456789', accountName: 'NGUYEN A' }, 100000, 'LB482913'))
      .toBe('https://img.vietqr.io/image/970436-0123456789-compact2.png?amount=100000&addInfo=LB482913&accountName=NGUYEN+A');
  });

  it('the last-look answer is read safely', () => {
    expect(keepFromReading('{"keep":[1,3,9]}', 3)).toEqual([1, 3]);
    expect(keepFromReading('{"keep":[]}', 2)).toEqual([]);
    expect(keepFromReading('no', 2)).toBeNull();
  });

  it('a picture a customer sent in chat is never used without consent', () => {
    const it0 = { id: 'c', url: 'https://x/c.jpg', kind: 'sample' as const, title: '', serviceId: null, tags: [], aiAllowed: true, expiresAt: null, flags: [], consent: false, status: 'ready' as const, source: 'chat' };
    expect(blockedReason(it0, new Date())).toBe('no_consent');
    expect(blockedReason({ ...it0, consent: true }, new Date())).toBeNull();
  });
});

function setup() {
  const settings = new Map<string, unknown>();
  const logs: { tenantId: string; action: string }[] = [];
  const prisma = {
    tenant: { findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({ market: where.id === 'US1' ? 'US' : 'VN' })) },
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
        const v = settings.get(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`); return v === undefined ? null : { value: v };
      }),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => { settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {}; }),
    },
    messengerThread: { findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => ((where.id === 'tA' && where.tenantId === 'A') || (where.id === 'tB' && where.tenantId === 'B') ? { id: where.id, customerId: null } : null)) },
    appointment: { findFirst: jest.fn(async ({ where }: { where: { id?: string; tenantId: string } }) => (where.id === 'apA' && where.tenantId === 'A' ? { id: 'apA' } : null)) },
    auditLog: { create: jest.fn(async ({ data }: { data: { tenantId: string; action: string } }) => { logs.push(data); return {}; }) },
  };
  const settingsSvc = {
    getPosSettings: jest.fn(async (t: string) => (t === 'NOBANK' ? {} : { bankAccount: { bin: '970436', accountNo: `00${t}12345`, accountName: `SALON ${t}` } })),
    getDepositSettings: jest.fn(async () => ({ enabled: true, type: 'fixed', fixedCents: 100000 })),
  };
  return { svc: new ChatPayService(prisma as never, settingsSvc as never), settings, logs };
}
const ownerA = { userId: 'oA', role: 'SALON_ADMIN', tenantId: 'A' } as never;
const ownerB = { userId: 'oB', role: 'SALON_ADMIN', tenantId: 'B' } as never;

describe('chat deposit QR — one salon at a time', () => {
  it('uses the calling salon own account; another salon thread or booking is refused', async () => {
    const { svc } = setup();
    const p = await svc.prepare(ownerA, 'tA', { amountCents: 100000 });
    expect(p.url).toContain('970436-00A12345');
    expect(p.text).toContain(p.code);
    await expect(svc.prepare(ownerB, 'tA', { amountCents: 100000 })).rejects.toThrow();
    await expect(svc.prepare(ownerB, 'tB', { amountCents: 100000, appointmentId: 'apA' })).rejects.toThrow(/không thuộc tiệm/);
  });

  it('refuses silly amounts and salons without a bank account or outside Vietnam', async () => {
    const { svc } = setup();
    await expect(svc.prepare(ownerA, 'tA', { amountCents: 5 })).rejects.toThrow(/Số tiền/);
    expect(await svc.bankOf('NOBANK')).toBeNull();
    expect(await svc.bankOf('US1')).toBeNull();
  });

  it('the panel never shows the full account number', async () => {
    const { svc } = setup();
    const p = await svc.panel(ownerA, 'tA');
    expect(p.available).toBe(true);
    expect(p.bank?.accountNo).toBe('•••2345');
    expect(JSON.stringify(p)).not.toContain('00A12345');
    expect(p.suggestedCents).toBe(100000);
  });

  it('a receipt picture is read only when this chat has an open request, and only noted — never paid', async () => {
    const { svc, settings, logs } = setup();
    const read = jest.fn(async () => 'Chuyển khoản thành công 100.000đ ND LB111111');
    await svc.onCustomerImages('A', 'tA', ['https://x/r.jpg'], read);
    expect(read).not.toHaveBeenCalled();
    settings.set('A|messenger.pay_requests', [req({ code: 'LB111111' })]);
    await svc.onCustomerImages('A', 'tA', ['https://x/r.jpg'], read);
    const list = settings.get('A|messenger.pay_requests') as PayRequest[];
    expect(list[0]).toMatchObject({ status: 'claimed', claim: { amountCents: 100000, codeSeen: true } });
    expect(list[0].bank).toBeNull();
    expect(logs).toContainEqual(expect.objectContaining({ tenantId: 'A', action: 'messenger.pay_claim_photo' }));
    // Salon B's chat with the same id never touches salon A's requests.
    await svc.onCustomerImages('B', 'tA', ['https://x/r.jpg'], read);
    expect(settings.get('B|messenger.pay_requests')).toBeUndefined();
  });
});
