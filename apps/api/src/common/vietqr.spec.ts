import * as fs from 'fs';
import * as path from 'path';
import { cleanAccount, crc16, plainUpper, qrLine, qrMatrix, QR_LINE, vietQrPayload, withoutQrLines, bankLabel } from './vietqr';

describe('VietQR payload', () => {
  it('uses CRC-16/CCITT-FALSE (the EMVCo check digits)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('carries the bank, the account, the exact amount and the bill code', () => {
    const p = vietQrPayload({ bin: '970436', accountNo: '0123456789' }, 255000, 'LM57')!;
    expect(p).toBe('00020101021238540010A00000072701240006970436011001234567890208QRIBFTTA530370454062550005802VN62080804LM576304' + crc16(p.slice(0, -4)));
    expect(p.slice(-8, -4)).toBe('6304');
  });

  it('is static (01 11) without an amount, and cleans the note', () => {
    const p = vietQrPayload({ bin: '970422', accountNo: '0909 123 456' }, 0, 'Bàn A7 + A8 — Phở')!;
    expect(p).toContain('010211');
    expect(p).not.toContain('5406');
    expect(p).toContain('01100909123456');
    expect(p).toContain('0813BAN A7 A8 PHO');
  });

  it('refuses an unusable account', () => {
    expect(vietQrPayload({ bin: '97', accountNo: '1' }, 1, 'x')).toBeNull();
    expect(vietQrPayload(null, 1, 'x')).toBeNull();
    expect(cleanAccount({ bin: '970436', accountNo: '0123 456 789', accountName: 'Phở Lumio Đặc biệt' })).toEqual({ bin: '970436', accountNo: '0123456789', accountName: 'PHO LUMIO DAC BIET' });
    expect(plainUpper('  Nguyễn   Văn Á ')).toBe('NGUYEN VAN A');
    expect(bankLabel('970436')).toBe('Vietcombank');
  });
});

describe('QR matrix', () => {
  it('picks the smallest version and draws the three finder patterns', () => {
    expect(qrMatrix('A').length).toBe(21);
    const m = qrMatrix(vietQrPayload({ bin: '970436', accountNo: '0123456789' }, 255000, 'LM57')!);
    expect(m.length).toBe(45); // version 7 at level M
    const finder = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6].every((i) => m[y][x + i] && m[y + 6][x + i] && m[y + i][x] && m[y + i][x + 6]);
    expect(finder(0, 0) && finder(m.length - 7, 0) && finder(0, m.length - 7)).toBe(true);
    expect(m[m.length - 8][8]).toBe(true); // the dark module
  });
});

describe('QR lines in print jobs', () => {
  it('marks a QR line and strips it for printers that cannot draw one', () => {
    const t = ['TOTAL  250.000 d', qrLine('0002010102'), 'Vietcombank · 0123'].join('\n');
    expect(QR_LINE.exec(t.split('\n')[1])?.[1]).toBe('0002010102');
    expect(withoutQrLines(t)).toBe('TOTAL  250.000 d\nVietcombank · 0123');
    expect(withoutQrLines(t, '[QR]')).toContain('[QR]');
  });
});

describe('one encoder for screen and paper', () => {
  it('keeps apps/web/src/lib/vietqr.ts identical to this file', () => {
    const api = fs.readFileSync(path.join(__dirname, 'vietqr.ts'), 'utf8');
    const web = fs.readFileSync(path.join(__dirname, '../../../web/src/lib/vietqr.ts'), 'utf8');
    expect(web).toBe(api);
  });
});
