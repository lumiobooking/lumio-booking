import { cleanPaymentDetails, nextBankAccount, resolvePayAccount } from './pay-account';

const VCB = { bin: '970436', accountNo: '0123456789', accountName: 'PHO LUMIO' };

describe('the one bank account (VietQR)', () => {
  it('prefers the account saved in Payments, else the till’s older one', () => {
    expect(resolvePayAccount({ bankAccount: VCB }, { bin: '970422', accountNo: '9999' }).bank).toEqual(VCB);
    expect(resolvePayAccount({}, { bin: '970422', accountNo: '9999', accountName: 'Mai' }).bank).toEqual({ bin: '970422', accountNo: '9999', accountName: 'MAI' });
    // Removed on purpose in Payments: the old one does not come back.
    expect(resolvePayAccount({ bankAccount: null }, { bin: '970422', accountNo: '9999' }).bank).toBeNull();
    expect(resolvePayAccount(null, null)).toEqual({ bank: null, printPayQr: true });
    expect(resolvePayAccount({ printPayQr: false }, null).printPayQr).toBe(false);
  });

  it('keeps it when not sent, removes it when emptied, refuses a half-typed one', () => {
    expect(nextBankAccount({}, { bankAccount: VCB })).toEqual({ bankAccount: VCB });
    expect(nextBankAccount({}, {})).toEqual({});
    expect(nextBankAccount({ bankAccount: null }, { bankAccount: VCB })).toEqual({ bankAccount: null });
    expect(nextBankAccount({ bankAccount: { bin: '', accountNo: '' } }, { bankAccount: VCB })).toEqual({ bankAccount: null });
    expect(() => nextBankAccount({ bankAccount: { bin: '9704', accountNo: '0123456789' } }, {})).toThrow('BANK_ACCOUNT_INVALID');
    expect(nextBankAccount({ bankAccount: { bin: '970436', accountNo: '0123 456 789', accountName: 'Phở Lumio' } }, {})).toEqual({ bankAccount: VCB });
  });

  it('keeps per-method details safe to show every guest', () => {
    const png = `data:image/png;base64,${'A'.repeat(100)}`;
    const out = cleanPaymentDetails({
      MOMO: { instructions: '0909 · Mai', qrUrl: png },
      ZALOPAY: { qrUrl: 'javascript:alert(1)' },
      VIETQR: { qrUrl: 'https://example.com/qr.png' },
      TRANSFER: { qrUrl: `data:image/png;base64,${'A'.repeat(300_000)}` },
      'bad key': { instructions: 'x' },
    });
    expect(out.MOMO).toEqual({ instructions: '0909 · Mai', qrUrl: png });
    expect(out.ZALOPAY.qrUrl).toBe('');
    expect(out.VIETQR.qrUrl).toBe('https://example.com/qr.png');
    expect(out.TRANSFER.qrUrl).toBe('');
    expect(out['bad key']).toBeUndefined();
  });
});
