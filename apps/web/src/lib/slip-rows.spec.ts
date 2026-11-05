import { slipRows } from './slip-rows';

describe('the guest check on screen', () => {
  it('draws the printer text: titles, rules, amounts on the right, the QR', () => {
    const rows = slipRows(['         NẪU CHILL ĐÊM', '', '         PHIẾU TẠM TÍNH', '             BÀN S1', '--------------------------------', '1 x Lẩu hải sản        199.000 đ', '================================', 'TỔNG CỘNG              199.000 đ', '[[QR:000201]]', '         Nội dung: LM10'].join('\n'));
    expect(rows[0]).toMatchObject({ text: 'NẪU CHILL ĐÊM', size: 'title' });
    expect(rows[2]).toMatchObject({ text: 'PHIẾU TẠM TÍNH', size: 'title', centre: true });
    expect(rows[3]).toMatchObject({ text: 'BÀN S1', size: 'title' });
    expect(rows[4].kind).toBe('rule');
    expect(rows[5]).toMatchObject({ text: '1 x Lẩu hải sản', right: '199.000 đ' });
    expect(rows[7]).toMatchObject({ text: 'TỔNG CỘNG', right: '199.000 đ', size: 'bold' });
    expect(rows[8]).toEqual({ kind: 'qr', text: '000201' });
    expect(rows[9]).toMatchObject({ centre: true, text: 'Nội dung: LM10' });
  });
});

describe('wrapped dish names', () => {
  it('keeps an indented second line on the left with its amount on the right', () => {
    const rows = slipRows(['1 x Bò lúc lắc khoai', '    tây chiên          119.000 đ', '    99.000 đ / phần'].join('\n'));
    expect(rows[1]).toMatchObject({ text: '    tây chiên', right: '119.000 đ' });
    expect(rows[2].centre).toBeFalsy();
  });
});
