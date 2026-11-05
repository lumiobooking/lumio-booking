import { payQrFor } from './pay-qr';
import { vietQrPayload } from './vietqr';

const account = { bin: '970436', accountNo: '0123456789', accountName: 'PHO LUMIO' };

describe('which QR the till shows', () => {
  it('draws a VietQR for the exact amount from the one account', () => {
    const q = payQrFor({ method: 'VIETQR', account, amount: 250000, currency: 'VND', note: 'Chị Lan' });
    expect(q.exact).toBe(true);
    expect(q.src?.startsWith('data:image/svg+xml')).toBe(true);
    expect(q.lines).toEqual(['Vietcombank · 0123456789', 'PHO LUMIO']);
    expect(vietQrPayload(account, 250000, 'Chị Lan')).toContain('0807CHI LAN');
  });

  it('lets MoMo / ZaloPay use it, unless the owner added the wallet’s own QR', () => {
    expect(payQrFor({ method: 'MOMO', account, amount: 1000, currency: 'VND' }).exact).toBe(true);
    const own = payQrFor({ method: 'ZALOPAY', account, amount: 1000, currency: 'VND', details: { qrUrl: 'data:image/png;base64,AAAA', instructions: '0909 · Mai' } });
    expect(own).toEqual({ src: 'data:image/png;base64,AAAA', exact: false, lines: ['0909 · Mai'] });
  });

  it('changes nothing outside the đồng or without an account', () => {
    const zelle = payQrFor({ method: 'TRANSFER', account, amount: 2500, currency: 'USD', details: { instructions: 'Zelle: a@b.c', qrUrl: 'https://x.y/q.png' } });
    expect(zelle).toEqual({ src: 'https://x.y/q.png', exact: false, lines: ['Zelle: a@b.c'] });
    expect(payQrFor({ method: 'VIETQR', account: null, amount: 1, currency: 'VND' })).toEqual({ src: null, exact: false, lines: [] });
  });
});
