import {
  BODY_AREAS, TEMPLATES, cleanSignature, redFlags, resolveTemplate, templateFor, validateAnswers, visitNotes,
} from './form-templates';

const SIG = `data:image/png;base64,${'A'.repeat(400)}`;

describe('the built-in forms', () => {
  it('every form has unique field ids, both languages and options where needed', () => {
    for (const tpl of Object.values(TEMPLATES)) {
      const ids = tpl.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const f of tpl.fields) {
        expect(f.label.vi && f.label.en).toBeTruthy();
        if (f.type === 'choice' || f.type === 'multi') expect(f.options?.length).toBeGreaterThan(1);
      }
    }
  });

  it('the consents carry the paper version\'s initial-items as ticks (7 cupping, 6 hot stone)', () => {
    expect(TEMPLATES.cupping.fields.filter((f) => f.type === 'ack')).toHaveLength(7);
    expect(TEMPLATES.hot_stone.fields.filter((f) => f.type === 'ack')).toHaveLength(6);
    expect(TEMPLATES.soap.signer).toBe('staff');
  });

  it('the salon\'s own questions join the intake\'s health list', () => {
    const tpl = templateFor('intake', [{ id: 'tattoo', vi: 'Mới xăm?', en: 'New tattoo?', flag: true }]);
    const at = tpl.fields.findIndex((f) => f.id === 'x_tattoo');
    expect(at).toBeGreaterThan(0);
    expect(tpl.fields[at + 1].id).toBe('s_visit');
    expect(tpl.fields[at].flags).toEqual(['massage']);
    expect(templateFor('cupping', [{ id: 'tattoo', vi: 'x', en: 'x', flag: true }])).toBe(TEMPLATES.cupping);
  });

  it('resolves to one language with the body map areas named', () => {
    const r = resolveTemplate(TEMPLATES.intake, 'vi');
    expect(r.title).toBe('Phiếu thông tin khách hàng');
    expect(r.areas).toHaveLength(BODY_AREAS.length);
    expect(r.fields.find((f) => f.id === 'pressure')?.options?.map((o) => o.label)).toEqual(['Nhẹ', 'Vừa', 'Mạnh']);
  });
});

describe('answers', () => {
  it('keeps only what the form asks, in its shape', () => {
    const { answers } = validateAnswers(TEMPLATES.soap, {
      s_areas: ['neck', 'nowhere', 'neck'], s_symptoms: ['tight', 'bogus'], s_pain: '7', a_pain: 42,
      techniques: ['swedish'], pressure_used: 'firm', note: '  ok  ', hacker: 'x',
    });
    expect(answers).toEqual({ s_areas: ['neck'], s_symptoms: ['tight'], s_pain: 7, techniques: ['swedish'], pressure_used: 'firm', note: 'ok' });
  });

  it('refuses a consent until every question and every tick is answered', () => {
    const empty = validateAnswers(TEMPLATES.cupping, {});
    expect(empty.missing).toContain('c_pregnant');
    expect(empty.missing).toContain('c_release');
    const all: Record<string, unknown> = {};
    for (const f of TEMPLATES.cupping.fields) if (f.type === 'yesno') all[f.id] = false; else if (f.type === 'ack') all[f.id] = true;
    expect(validateAnswers(TEMPLATES.cupping, all).missing).toEqual([]);
  });

  it('a yes keeps its few words; a no drops them', () => {
    const a = validateAnswers(TEMPLATES.intake, { recent_surgery: true, recent_surgery__note: 'knee, May', heart: false, heart__note: 'x' }).answers;
    expect(a.recent_surgery__note).toBe('knee, May');
    expect(a.heart__note).toBeUndefined();
  });
});

describe('red flags for the therapist', () => {
  const intake = { kind: 'intake' as const, answers: { blood_thinners: true, bleeding: true, pregnant: false, varicose: true, varicose__note: 'left calf', arthritis: true } };

  it('shows any-massage cautions always and treatment cautions only for that treatment', () => {
    const plain = redFlags([intake], [], 'en').map((f) => f.fieldId);
    expect(plain).toEqual(['blood_thinners', 'varicose']);
    const cupping = redFlags([intake], ['cupping'], 'en').map((f) => f.fieldId);
    expect(cupping).toEqual(['blood_thinners', 'bleeding', 'varicose']);
    expect(redFlags([intake], ['cupping'], 'en').find((f) => f.fieldId === 'varicose')?.note).toBe('left calf');
  });

  it('reads the labels the client signed, and never from a SOAP note', () => {
    const snap = resolveTemplate(TEMPLATES.intake, 'vi');
    const f = redFlags([{ ...intake, snapshot: snap }], [], 'en');
    expect(f[0].label).toBe('Đang dùng thuốc chống đông máu');
    expect(redFlags([{ kind: 'soap', answers: { blood_thinners: true } }], [], 'en')).toEqual([]);
  });

  it('turns the intake into short notes: pressure, focus, avoid', () => {
    expect(visitNotes({ pressure: 'firm', focus: ['neck', 'upper_back'], avoid: ['lower_back'] }, 'vi')).toEqual(['Lực: Mạnh', 'Tập trung: Cổ / gáy, Lưng trên', 'TRÁNH: Lưng dưới']);
    expect(visitNotes(null, 'en')).toEqual([]);
  });
});

describe('the signature', () => {
  it('accepts a drawn PNG only', () => {
    expect(cleanSignature(SIG)).toBe(SIG);
    expect(cleanSignature('data:image/png;base64,AAAA')).toBeNull();
    expect(cleanSignature(`data:image/svg+xml;base64,${'A'.repeat(400)}`)).toBeNull();
    expect(cleanSignature(`javascript:alert(1)${'A'.repeat(400)}`)).toBeNull();
    expect(cleanSignature(42)).toBeNull();
  });
});
