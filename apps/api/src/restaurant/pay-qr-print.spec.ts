import { prebillText, moneyText } from './check-logic';
import { payQrBlock, RestaurantService } from './restaurant.service';
import { escposBytes, styleRows } from '../print/print-devices.logic';
import { qrMatrix, vietQrPayload, withoutQrLines } from '../common/vietqr';

const bank = { bin: '970436', accountNo: '0123456789', accountName: 'PHO LUMIO' };

function check(payQr: ReturnType<typeof payQrBlock>) {
  return prebillText({
    lang: 'vi', business: 'Phở Lumio', tables: 'A7', checkNumber: 57, count: 1, at: '20/10 19:24',
    lines: [{ quantity: 2, name: 'Phở bò tái', amountCents: 130000 }, { quantity: 1, name: 'Trà đá', amountCents: 120000 }],
    payCode: 'LM57', payQr, totalCents: 250000, money: (c) => moneyText(c, 'VND'),
  });
}

describe('the VietQR printed on the guest check', () => {
  it('prints the exact amount and bill code as a QR, with the account under it', () => {
    const block = payQrBlock({ bank, printPayQr: true }, 250000, 'LM57', 'VND')!;
    expect(block.line).toBe(`[[QR:${vietQrPayload(bank, 250000, 'LM57')}]]`);
    const text = check(block);
    expect(text).toContain('QUÉT MÃ ĐỂ CHUYỂN KHOẢN');
    expect(text).toContain('Vietcombank · 0123456789');
    expect(text).toContain('Nội dung: LM57');
    expect(text).not.toContain('Chuyển khoản ghi nội dung');
  });

  it('is left out when switched off, without an account, or outside the đồng', () => {
    expect(payQrBlock({ bank, printPayQr: false }, 250000, 'LM57', 'VND')).toBeNull();
    expect(payQrBlock({ bank: null }, 250000, 'LM57', 'VND')).toBeNull();
    expect(payQrBlock({ bank }, 2500, 'LM57', 'USD')).toBeNull();
    expect(check(null)).toContain('Chuyển khoản ghi nội dung: LM57');
  });

  it('reaches the printer as a QR: drawn squares for Windows, a raster image for network printers', () => {
    const text = check(payQrBlock({ bank }, 250000, 'LM57', 'VND'));
    const rows = styleRows(text, null);
    const q = rows.find((r) => r.r === 'q')!;
    expect(q.t).toBe('');
    expect(q.m).toEqual(qrMatrix(vietQrPayload(bank, 250000, 'LM57')!).map((r) => r.map((d) => (d ? '1' : '0')).join('')));
    // The long QR line does not widen the bill (centred lines stay centred).
    expect(rows.find((r) => /QUÉT MÃ/.test(r.t))?.c).toBe(true);
    const raw = escposBytes(rows, { paper: 80 } as never);
    expect(raw.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00]))).toBe(true);
    // The old plain-text agent gets the bill without the QR line.
    expect(withoutQrLines(text)).not.toContain('[[QR:');
    expect(withoutQrLines(text)).toContain('Vietcombank · 0123456789');
  });
});

describe('each restaurant prints its own account', () => {
  it('reads Payments and the till settings for the caller’s tenant only', async () => {
    const store: Record<string, unknown> = {
      'tA/restaurant_service': { bank: { bin: '970422', accountNo: '1111' } },
      'tB/restaurant_service': { bank: { bin: '970407', accountNo: '2222' } },
    };
    const pos: Record<string, unknown> = { tA: { bankAccount: bank, printPayQr: true }, tB: {} };
    const prisma = { setting: { findUnique: jest.fn(async (a: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
      const v = store[`${a.where.tenantId_key.tenantId}/${a.where.tenantId_key.key}`];
      return v ? { value: v } : null;
    }) } };
    const settings = { getPosSettings: jest.fn(async (t: string) => pos[t] ?? {}) };
    const svc = new RestaurantService(prisma as never, {} as never, settings as never, {} as never);
    expect((await svc.getSettings('tA')).bank).toEqual(bank);
    expect((await svc.getSettings('tB')).bank).toEqual({ bin: '970407', accountNo: '2222', accountName: '' });
    expect((await svc.getSettings('tC')).bank).toBeNull();
    expect(settings.getPosSettings.mock.calls.map((c) => c[0])).toEqual(['tA', 'tB', 'tC']);
    for (const c of prisma.setting.findUnique.mock.calls) expect(['tA', 'tB', 'tC']).toContain(c[0].where.tenantId_key.tenantId);
  });
});
