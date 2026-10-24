import { addOption, duplicateField, formProblems, freshId, moveField, newField, previewOf, ruleText, type EditForm } from './form-editor';

const form = (over: Partial<EditForm> = {}): EditForm => ({
  kind: 'c_abc12345', name: 'Lash form', intro: '', signer: 'client', active: true, lang: 'en', version: 1,
  appliesTo: { all: true, serviceIds: [], categoryIds: [] }, validMonths: 12,
  fields: [{ id: 'q1', type: 'yesno', label: 'Contact lenses?', required: true, flag: true }],
  ...over,
});

describe('building questions', () => {
  it('new questions get ids nobody else has', () => {
    expect(freshId([{ id: 'q1' }, { id: 'q2' }])).toBe('q3');
    expect(freshId([{ id: 'q3' }])).toBe('q2');
    const f = newField('choice', [{ id: 'q1', type: 'text', label: 'x' }], false);
    expect(f.id).toBe('q2');
    expect(f.options).toHaveLength(2);
  });

  it('a yes/no starts required and warns the technician; an agree tick is required', () => {
    expect(newField('yesno', [], true)).toEqual(expect.objectContaining({ required: true, flag: true }));
    expect(newField('ack', [], true).required).toBe(true);
    expect(newField('scale', [], true)).toEqual(expect.objectContaining({ min: 0, max: 10 }));
  });

  it('moves, copies and adds options without losing anything', () => {
    expect(moveField(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveField(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    const two = duplicateField(form().fields, 0);
    expect(two.map((x) => x.id)).toEqual(['q1', 'q2']);
    expect(two[1].label).toBe('Contact lenses?');
    const withOpt = addOption({ id: 'q1', type: 'choice', label: 'Curl', options: [{ id: 'o1', label: 'C' }] }, 'D');
    expect(withOpt.options!.map((o) => o.id)).toEqual(['o1', 'o2']);
  });
});

describe('what stops a save', () => {
  it('a good form has nothing to fix', () => {
    expect(formProblems(form(), false)).toEqual([]);
  });

  it('names every problem in plain words', () => {
    const p = formProblems(form({
      name: ' ',
      appliesTo: { all: false, serviceIds: [], categoryIds: [] },
      fields: [
        { id: 'q1', type: 'text', label: '' },
        { id: 'q2', type: 'multi', label: 'Areas', options: [{ id: 'o1', label: ' ' }] },
        { id: 'q3', type: 'scale', label: 'Pain', min: 5, max: 5 },
      ],
    }), true);
    expect(p).toEqual(expect.arrayContaining([
      'Đặt tên cho biểu mẫu', 'Câu 1: chưa có nội dung', 'Câu 2: cần ít nhất một lựa chọn',
      'Câu 3: số nhỏ nhất phải nhỏ hơn số lớn nhất', 'Chọn dịch vụ cần biểu mẫu này, hoặc chọn “Mọi lượt khách”',
    ]));
  });

  it('a form of headings alone has no question', () => {
    expect(formProblems(form({ fields: [{ id: 'q1', type: 'section', label: 'Part 1' }] }), false)).toContain('Add at least one question');
  });
});

describe('the preview and the list line', () => {
  it('previews in the form\'s own language with the caution mark', () => {
    const t = previewOf(form());
    expect(t.title).toBe('Lash form');
    expect(t.fields[0].flags).toEqual(['massage']);
  });

  it('says who fills it, when, and for which services', () => {
    const names = new Map([['sv1', 'Classic set'], ['sv2', 'Volume set']]);
    expect(ruleText(form(), names, false)).toBe('Client signs before · sign again after 12 months · every visit');
    expect(ruleText(form({ signer: 'staff', appliesTo: { all: false, serviceIds: ['sv1', 'sv2'], categoryIds: [] } }), names, true))
      .toBe('Thợ ghi sau buổi làm · Classic set, Volume set');
    expect(ruleText(form({ validMonths: 0 }), names, true)).toContain('mỗi lần đến');
  });
});
