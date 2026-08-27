import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateBookingRulesDto, UpdateBrandingDto, UpdateNotificationsDto } from './update-settings.dto';
import { DEFAULT_BOOKING_RULES, DEFAULT_BRANDING, DEFAULT_NOTIFICATION_SETTINGS } from '../settings.constants';

/**
 * The settings screen sends the WHOLE booking-rules object back on save, and
 * the endpoint validates with forbidNonWhitelisted. So any field that exists in
 * BookingRules but is missing from the DTO does not merely get ignored — it
 * makes the entire save fail, and the screen shows
 *
 *   property currencySymbol should not exist, property symbolPosition ...
 *
 * Four fields had been missing for a long time. Nobody noticed because that
 * panel had no reason to be saved; the moment a new setting was added to it,
 * the whole screen was dead. This test walks the real default object through
 * the real validator, so the two can never drift apart again in silence.
 */
async function rejectWith(cls: new () => object, payload: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(cls, payload);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const reject = (payload: Record<string, unknown>) => rejectWith(UpdateBookingRulesDto, payload);

/**
 * The same drift, on the other panels that post a whole form object.
 *
 * Only five settings endpoints declare a real DTO class — company, booking,
 * payments, notifications, branding. The rest annotate the body with an inline
 * type, which class-validator does not see at all, so they cannot fail this
 * way. Company and payments send an explicit field list and are safe by
 * construction. That leaves these two, which post `f` wholesale exactly the way
 * booking rules did.
 */
describe('the other panels that post their whole form', () => {
  it('branding accepts its own defaults', async () => {
    expect(await rejectWith(UpdateBrandingDto, { ...DEFAULT_BRANDING })).toEqual([]);
  });

  it('notifications accepts its own defaults', async () => {
    expect(await rejectWith(UpdateNotificationsDto, { ...DEFAULT_NOTIFICATION_SETTINGS })).toEqual([]);
  });
});

describe('the API accepts everything the settings screen sends', () => {
  it('accepts a complete BookingRules object, field for field', async () => {
    // If this fails, the message names the field the DTO is missing — add it
    // there rather than trimming what the screen sends, because the screen is
    // sending the salon's real settings.
    expect(await reject({ ...DEFAULT_BOOKING_RULES })).toEqual([]);
  });

  it.each(Object.keys(DEFAULT_BOOKING_RULES))('accepts %s on its own', async (key) => {
    const value = (DEFAULT_BOOKING_RULES as Record<string, unknown>)[key];
    expect(await reject({ [key]: value })).toEqual([]);
  });

  // The exact four from the error the salon owner saw.
  it.each(['currencySymbol', 'symbolPosition', 'priceDecimals', 'defaultPaymentMethod'])(
    '%s is declared — this is the field that broke the screen',
    async (key) => {
      const value = (DEFAULT_BOOKING_RULES as Record<string, unknown>)[key];
      expect(await reject({ [key]: value })).toEqual([]);
    },
  );
});

describe('it still refuses values that would damage a salon', () => {
  // Whitelisting everything would be the lazy fix and a worse one: these are
  // money-shaping fields, and a bad value shows a wrong price to customers.
  it('refuses a decimal count that would mangle every price', async () => {
    expect((await reject({ priceDecimals: 9 })).join()).toContain('priceDecimals');
    expect((await reject({ priceDecimals: -1 })).join()).toContain('priceDecimals');
  });

  it('refuses a symbol position it does not understand', async () => {
    expect((await reject({ symbolPosition: 'sideways' })).join()).toContain('symbolPosition');
  });

  it('refuses an unknown payment default', async () => {
    expect((await reject({ defaultPaymentMethod: 'crypto' })).join()).toContain('defaultPaymentMethod');
  });

  it('refuses a badge mode it does not understand', async () => {
    expect((await reject({ soonestBar: 'maybe' })).join()).toContain('soonestBar');
  });

  it('still refuses a genuinely unknown property', async () => {
    // The point is not to stop validating — it is to declare what is real.
    expect((await reject({ somethingInvented: 1 })).join()).toContain('somethingInvented');
  });
});
