import { INTAKES, redFlags, resolveTemplate, templateFor, validateAnswers } from './form-templates';
import { defaultFormSettings, intakeStyleFor, sanitizeFormSettings } from './form-settings';

describe('an intake for every kind of business', () => {
  it('each business starts with its own intake; only massage/spa start switched on', () => {
    expect(intakeStyleFor('MASSAGE')).toBe('massage');
    expect(intakeStyleFor('NAIL')).toBe('nail');
    expect(intakeStyleFor('HAIR')).toBe('general');
    const nail = defaultFormSettings('NAIL');
    expect(nail).toMatchObject({ enabled: false, intakeStyle: 'nail', soapRequired: false });
    expect(nail.consents.cupping.enabled).toBe(false);
    expect(defaultFormSettings('SPA')).toMatchObject({ enabled: true, intakeStyle: 'massage', soapRequired: true });
  });

  it('the owner can pick another style; nonsense keeps the current one', () => {
    const base = defaultFormSettings('NAIL');
    expect(sanitizeFormSettings({ intakeStyle: 'general' }, base).intakeStyle).toBe('general');
    expect(sanitizeFormSettings({ intakeStyle: 'tattoo' }, base).intakeStyle).toBe('nail');
  });

  it('the nail form asks the nail questions and ends with a release', () => {
    const tpl = templateFor('intake', [], 'nail');
    expect(tpl).toBe(INTAKES.nail);
    const ids = tpl.fields.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['n_fungus', 'n_allergy_products', 'n_diabetes', 'ack_release']));
    expect(resolveTemplate(tpl, 'vi').title).toMatch(/móng/i);
    const { missing } = validateAnswers(tpl, { name: 'Lan' });
    expect(missing).toEqual(expect.arrayContaining(['n_fungus', 'ack_release']));
  });

  it('a salon question lands before the acknowledgements on a form with no visit section', () => {
    const tpl = templateFor('intake', [{ id: 'q1', vi: 'Có hình xăm mới?', en: 'New tattoo?', flag: true }], 'general');
    const at = tpl.fields.findIndex((f) => f.id === 'x_q1');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(tpl.fields.findIndex((f) => f.id === 's_ack'));
  });

  it('a "yes" on the nail form is a caution the technician sees', () => {
    const snap = resolveTemplate(INTAKES.nail, 'en');
    const flags = redFlags([{ kind: 'intake', answers: { n_fungus: true, n_fungus__note: 'left big toe', n_shaved: true }, snapshot: snap }], [], 'en');
    expect(flags.map((f) => f.fieldId)).toEqual(['n_fungus']);
    expect(flags[0].note).toBe('left big toe');
  });
});
