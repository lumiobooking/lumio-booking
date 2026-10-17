import { answerText, missingFields, printHtml, safeReturn, type FormEntry, type ResolvedTemplate } from './client-forms';

const TPL: ResolvedTemplate = {
  kind: 'intake', version: 1, lang: 'en', title: 'Client intake <form>', signer: 'client',
  areas: [{ id: 'neck', label: 'Neck', side: 'back' }, { id: 'lower_back', label: 'Lower back', side: 'back' }],
  fields: [
    { id: 's', type: 'section', label: 'Health' },
    { id: 'thinners', type: 'yesno', label: 'Blood thinners', required: true, flags: ['massage'], detail: true },
    { id: 'pressure', type: 'choice', label: 'Pressure', options: [{ id: 'firm', label: 'Firm' }] },
    { id: 'avoid', type: 'bodymap', label: 'Avoid' },
    { id: 'pain', type: 'scale', label: 'Pain', max: 10 },
    { id: 'ok', type: 'ack', label: 'True', required: true },
    { id: 'name', type: 'text', label: 'Name', required: true },
  ],
};

describe('reading a signed form back', () => {
  it('turns answers into words', () => {
    const a = { thinners: true, thinners__note: 'warfarin', pressure: 'firm', avoid: ['neck', 'lower_back'], pain: 4, ok: true };
    const f = (id: string) => TPL.fields.find((x) => x.id === id)!;
    expect(answerText(f('thinners'), a, TPL.areas, false)).toBe('Yes — warfarin');
    expect(answerText(f('thinners'), { thinners: false, thinners__note: 'x' }, TPL.areas, true)).toBe('Không');
    expect(answerText(f('pressure'), a, TPL.areas, false)).toBe('Firm');
    expect(answerText(f('avoid'), a, TPL.areas, false)).toBe('Neck, Lower back');
    expect(answerText(f('pain'), a, TPL.areas, false)).toBe('4 / 10');
    expect(answerText(f('ok'), a, TPL.areas, false)).toBe('✓');
  });

  it('knows what is still unanswered', () => {
    expect(missingFields(TPL, {})).toEqual(['thinners', 'ok', 'name']);
    expect(missingFields(TPL, { thinners: false, ok: true, name: ' Anna ' })).toEqual([]);
  });

  it('prints escaped, with the signature only when it is a PNG', () => {
    const e: FormEntry = {
      id: 'e1', kind: 'intake', signedAt: '2026-10-17T10:00:00Z', signerRole: 'client', signedName: '<script>x</script>',
      signatureData: 'data:image/png;base64,AAAA', answers: { thinners: true, name: 'A&B' }, snapshot: TPL,
      addenda: [{ at: '2026-10-18T10:00:00Z', by: 'Owner', text: 'Off thinners now' }], customerName: 'Anna', staffName: null, salonName: 'Zen', canAmend: true,
    };
    const html = printHtml(e, false);
    expect(html).toContain('Client intake &lt;form&gt;');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('<img class="sig"');
    expect(html).toContain('Off thinners now');
    expect(html).toMatch(/class="r f"/);
    expect(printHtml({ ...e, signatureData: 'javascript:alert(1)' }, false)).not.toContain('<img');
  });
});

describe('the sign page\'s way back', () => {
  it('goes back only to this app\'s own pages', () => {
    expect(safeReturn('/checkin')).toBe('/checkin');
    expect(safeReturn('/salon/walkins?x=1')).toBe('/salon/walkins?x=1');
    expect(safeReturn('//evil.com')).toBeNull();
    expect(safeReturn('https://evil.com')).toBeNull();
    expect(safeReturn('/\\evil.com')).toBeNull();
    expect(safeReturn(null)).toBeNull();
  });
});
