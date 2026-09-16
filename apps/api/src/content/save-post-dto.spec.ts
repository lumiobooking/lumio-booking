import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SavePostDto } from './dto/save-post.dto';
import { cleanGbpOptions } from './gbp-cta';

/**
 * The door and the room behind it must agree.
 *
 * A post carrying `google` was rejected with "property google should not
 * exist" — the composer had been sending the field for months and the DTO
 * never declared it. Nothing failed loudly: the validator runs with
 * `forbidNonWhitelisted`, so an undeclared field does not get ignored, it
 * kills the whole request. Choosing Google Business made a post unsaveable.
 *
 * These tests are the check that was missing: every field the SERVICE reads
 * must survive the DOOR.
 */
const base = () => ({
  channels: ['facebook'],
  message: 'Bộ nail mùa thu mới về.',
  scheduledAt: '2026-10-01T15:00:00.000Z',
});

const check = (body: Record<string, unknown>) => {
  const dto = plainToInstance(SavePostDto, body);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
};

describe('a post that goes to Google Business', () => {
  it('is accepted with the button, the link and the accepted risks', () => {
    const errors = check({
      ...base(),
      channels: ['facebook', 'google'],
      google: { button: 'book', url: 'https://lumiobooking.com/tu-nails', ack: ['medical'] },
    });
    expect(errors).toEqual([]);
  });

  it('accepts a null link — "use the salon default" is a real answer', () => {
    expect(check({ ...base(), channels: ['google'], google: { button: 'call', url: null } })).toEqual([]);
  });

  it('accepts a post with no google block at all', () => {
    expect(check({ ...base(), channels: ['google'] })).toEqual([]);
  });

  it('REGRESSION: "property google should not exist" never comes back', () => {
    const errors = check({ ...base(), channels: ['google'], google: { button: 'book', url: null, ack: [] } });
    expect(JSON.stringify(errors)).not.toContain('should not exist');
  });
});

describe('every field the service reads survives the door', () => {
  it('a body that passes validation still carries what cleanGbpOptions needs', () => {
    const body = {
      ...base(),
      channels: ['google'],
      google: { button: 'learn', url: 'https://example.com/x', ack: ['medical', 'political'] },
    };
    expect(check(body)).toEqual([]);
    // The DTO keeps the field, and the service's own cleaner reads all of it.
    const dto = plainToInstance(SavePostDto, body, { excludeExtraneousValues: false });
    const opts = cleanGbpOptions(dto.google);
    expect(opts).toEqual({ button: 'learn', url: 'https://example.com/x', ack: ['medical', 'political'] });
  });
});

describe('the door still refuses nonsense', () => {
  it('rejects a button Google does not have', () => {
    expect(check({ ...base(), channels: ['google'], google: { button: 'buy-now' } })).not.toEqual([]);
  });

  it('rejects a field nobody declared, which is the check working as intended', () => {
    expect(check({ ...base(), surprise: 'x' })).not.toEqual([]);
  });

  it('refuses an accepted-risk list long enough to be an attack', () => {
    expect(check({ ...base(), google: { ack: Array(50).fill('medical') } })).not.toEqual([]);
  });
});
