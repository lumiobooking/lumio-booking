import { buildTrace, likelySources, looksUnsourced, numbersOf, traceFrom, type TraceCandidate } from './reply-trace';

const priceDoc: TraceCandidate = { kind: 'doc', id: 's1', label: 'Bảng giá Lumio', text: 'Gói Starter: 490.000đ/tháng, 1 chi nhánh\nGói Pro: 990.000đ/tháng, không giới hạn nhân viên\nHỗ trợ cài đặt miễn phí' };
const hoursFact: TraceCandidate = { kind: 'fact', label: 'Giờ mở cửa', text: 'Giờ mở cửa: Thứ Hai đến Thứ Bảy 9:30–19:00, Chủ Nhật nghỉ' };
const parking: TraceCandidate = { kind: 'fact', label: 'Đậu xe', text: 'Đậu xe: bãi xe miễn phí phía sau tiệm' };

describe('reply trace — which note or document line a reply repeats', () => {
  it('a price reply names the document and the very line it read', () => {
    const refs = likelySources('Dạ gói Pro bên em là 990k/tháng, không giới hạn nhân viên ạ.', [parking, hoursFact, priceDoc]);
    expect(refs[0]).toMatchObject({ kind: 'doc', id: 's1', label: 'Bảng giá Lumio' });
    expect(refs[0].snippet).toContain('Gói Pro');
    expect(refs.find((r) => r.label === 'Đậu xe')).toBeUndefined();
  });

  it('990.000, 990,000 and 990k are the same number', () => {
    expect(numbersOf('990.000đ')).toEqual(numbersOf('990k'));
    expect(numbersOf('990,000 VND')).toEqual(numbersOf('990k'));
  });

  it('one common word never names a source; a greeting has none', () => {
    expect(likelySources('Dạ em chào chị ạ, chị cần em hỗ trợ gì ạ?', [priceDoc, hoursFact, parking])).toEqual([]);
    expect(likelySources('Dạ tiệm có nhận khách tháng này ạ', [priceDoc])).toEqual([]);
  });

  it('three shared words qualify without a number', () => {
    const refs = likelySources('Dạ tiệm có bãi xe miễn phí phía sau ạ', [priceDoc, parking]);
    expect(refs.map((r) => r.label)).toEqual(['Đậu xe']);
  });

  it('builds: guard first, matched rules, real tools, then sources; offer_choices is not a source', () => {
    const t = buildTrace({
      reply: 'Dạ gói Pro là 990k/tháng ạ', rules: [{ id: 'i1', text: 'Luôn mời khách dùng thử 14 ngày' }],
      tools: ['get_pricing', 'offer_choices', 'get_pricing'], guards: ['price'], candidates: [priceDoc],
    });
    expect(t.refs.map((r) => r.kind)).toEqual(['guard', 'rule', 'tool', 'doc']);
    expect(t.refs[1]).toMatchObject({ id: 'i1' });
  });

  it('nothing behind a plain reply: an empty trace, kept so the Inbox can say so', () => {
    expect(buildTrace({ reply: 'Dạ vâng ạ', tools: ['offer_choices'] })).toEqual({ v: 1, refs: [] });
    expect(traceFrom({ v: 1, refs: [] })).toEqual({ v: 1, refs: [] });
  });

  it('never more than six refs, and what is stored is read back safely', () => {
    const many = buildTrace({ reply: 'x', tools: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
    expect(many.refs).toHaveLength(6);
    expect(traceFrom({ refs: [{ kind: 'doc', label: 'Bảng giá', snippet: 'x'.repeat(500), id: 's1' }, { kind: 'nope', label: 'y' }, { kind: 'tool' }, null] }))
      .toEqual({ v: 1, refs: [{ kind: 'doc', label: 'Bảng giá', snippet: `${'x'.repeat(159)}…`, id: 's1' }] });
    expect(traceFrom(null)).toBeNull();
    expect(traceFrom({ refs: 'no' })).toBeNull();
  });

  it('a number with nothing behind it is flagged; a looked-up or sourced one is not', () => {
    expect(looksUnsourced('Dạ giá là 45$ ạ', null)).toBe(true);
    expect(looksUnsourced('Dạ giá là 45$ ạ', { v: 1, refs: [{ kind: 'guard', label: 'price' }] })).toBe(true);
    expect(looksUnsourced('Dạ giá là 45$ ạ', { v: 1, refs: [{ kind: 'tool', label: 'get_services' }] })).toBe(false);
    expect(looksUnsourced('Dạ em chào chị ạ', null)).toBe(false);
  });
});
