import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FormSettingsDto } from './client-forms.controller';
import { defaultFormSettings } from './form-settings';

/**
 * The screen saves the settings exactly as GET handed them over. The global
 * pipe runs with forbidNonWhitelisted, so every key the API sends must be a
 * key the DTO declares — "property intakeStyle should not exist" stopped every
 * salon from saving the forms page until this was caught.
 */
describe('the forms settings DTO accepts what the API hands out', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };

  it.each(['MASSAGE', 'NAILS', null])('defaults for %s round-trip through the DTO', async (industry) => {
    const body = JSON.parse(JSON.stringify(defaultFormSettings(industry as string | null)));
    const errors = await validate(plainToInstance(FormSettingsDto, body), opts);
    expect(errors.map((e) => e.property)).toEqual([]);
  });

  it('a style it does not know is refused', async () => {
    const errors = await validate(plainToInstance(FormSettingsDto, { intakeStyle: 'tattoo' }), opts);
    expect(errors.map((e) => e.property)).toEqual(['intakeStyle']);
  });
});
