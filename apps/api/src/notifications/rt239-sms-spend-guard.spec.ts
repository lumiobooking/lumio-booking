import { blockedDestination, onlineBookingsPerPhoneDay, phoneTail, spendHold, spendLimits } from './sms-spend-guard';

describe('rt239 — SMS spend guard', () => {
  const L = spendLimits({});
  it('defaults are sane and tunable by env', () => {
    expect(L).toEqual({ allowedDial: ['1', '61'], perNumberPerSalon: 8, perNumberPlatform: 15, perSalonHour: 80, platformDay: 800 });
    expect(spendLimits({ SMS_ALLOWED_DIAL: '1, 61, 44', SMS_CAP_PER_NUMBER_SALON: '3' }).allowedDial).toEqual(['1', '61', '44']);
    expect(spendLimits({ SMS_CAP_PER_NUMBER_SALON: 'x' }).perNumberPerSalon).toBe(8);
    expect(onlineBookingsPerPhoneDay({})).toBe(5);
  });

  it('texts only the countries Lumio serves; +1 only US / Canada / US territories', () => {
    expect(blockedDestination('+15125550101', L.allowedDial)).toBeNull(); // Texas
    expect(blockedDestination('+14165550101', L.allowedDial)).toBeNull(); // Toronto
    expect(blockedDestination('+17875550101', L.allowedDial)).toBeNull(); // Puerto Rico
    expect(blockedDestination('+61412345678', L.allowedDial)).toBeNull(); // Australia
    expect(blockedDestination('+18765550101', L.allowedDial)).toMatch(/876/); // Jamaica — pumping
    expect(blockedDestination('+18095550101', L.allowedDial)).toMatch(/809/); // Dominican Rep.
    expect(blockedDestination('+19005550101', L.allowedDial)).toMatch(/premium/);
    expect(blockedDestination('+2348012345678', L.allowedDial)).toMatch(/country not served/);
    expect(blockedDestination('+4479460000', L.allowedDial)).toMatch(/country not served/);
    expect(blockedDestination('5125550101', L.allowedDial)).toMatch(/not a valid/);
    expect(blockedDestination(null, L.allowedDial)).toMatch(/not a valid/);
  });

  it('caps one number per salon and across salons; staff/owner numbers exempt', () => {
    const ok = { numberAtSalon24h: 2, numberPlatform24h: 3, salonHour: 5, platform24h: 100 };
    expect(spendHold(ok, L)).toBeNull();
    expect(spendHold({ ...ok, numberAtSalon24h: 8 }, L)).toMatch(/to this number today/);
    expect(spendHold({ ...ok, numberPlatform24h: 15 }, L)).toMatch(/from Lumio today/);
    expect(spendHold({ ...ok, numberAtSalon24h: 40, numberPlatform24h: 40 }, L, { staffNumber: true })).toBeNull();
  });

  it('a salon bursting, or the whole platform over its ceiling, is held even for staff', () => {
    const ok = { numberAtSalon24h: 0, numberPlatform24h: 0, salonHour: 0, platform24h: 0 };
    expect(spendHold({ ...ok, salonHour: 80 }, L, { staffNumber: true })).toMatch(/last hour/);
    expect(spendHold({ ...ok, platform24h: 800 }, L)).toMatch(/platform daily/);
  });

  it('matches a phone across formats', () => {
    expect(phoneTail('+1 (512) 555-0101')).toBe(phoneTail('5125550101'));
    expect(phoneTail('')).toBe('');
  });
});

import { NotificationsService } from './notifications.service';

describe('rt239 — the counts are per salon where they should be', () => {
  it('per-number-at-salon and per-salon-hour counts are scoped to the salon; staff lookup too', async () => {
    const wheres: any[] = [];
    const prisma: any = {
      notification: { count: jest.fn(async (a: any) => { wheres.push(a.where); return 0; }) },
      user: { count: jest.fn(async (a: any) => { wheres.push({ user: a.where }); return 0; }) },
      staffMember: { count: jest.fn(async (a: any) => { wheres.push({ staff: a.where }); return 0; }) },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const svc = new NotificationsService(prisma);
    const why = await (svc as any).spendGuardFor('salon-A', '(512) 555-0101', '+15125550101');
    expect(why).toBeNull();
    const salonScoped = wheres.filter((w) => w.tenantId === 'salon-A');
    expect(salonScoped).toHaveLength(2); // this number at this salon, this salon's hour
    expect(wheres.find((w) => w.user)?.user.tenantId).toBe('salon-A');
    expect(wheres.find((w) => w.staff)?.staff.tenantId).toBe('salon-A');
    expect(wheres.some((w) => w.tenantId && w.tenantId !== 'salon-A')).toBe(false);
  });
  it('a pumping destination is held before any count is run', async () => {
    const prisma: any = { notification: { count: jest.fn() }, user: { count: jest.fn() }, staffMember: { count: jest.fn() }, auditLog: { create: jest.fn(async () => ({})) } };
    const why = await (new NotificationsService(prisma) as any).spendGuardFor('salon-A', '8765550101', '+18765550101');
    expect(why).toMatch(/876/);
    expect(prisma.notification.count).not.toHaveBeenCalled();
  });
});
