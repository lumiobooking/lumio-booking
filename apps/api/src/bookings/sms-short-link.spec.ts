import { BookingsService } from './bookings.service';
import { fillPct, pctValue } from '../notifications/email-template';
import { smsSegments, toGsm7 } from '../notifications/sms-text';

/**
 * The SMS manage link: /a/<33 chars> instead of /appt/<~180 chars>.
 * Signed like the long one, nothing stored, and the long links already in
 * customers' phones keep working.
 */
describe('short SMS manage link', () => {
  const ID_A = '3f2b8c1e-9d4a-4b7e-8a21-5c6d7e8f9a0b';
  const ID_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const prev = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = 'test-secret-for-short-links'; });
  afterAll(() => { process.env.JWT_SECRET = prev; });

  function service(appts: Record<string, { tenantId: string; status: string; startTime: Date }> = {}) {
    const svc = Object.create(BookingsService.prototype) as any;
    const update = jest.fn(async () => ({}));
    svc.prisma = {
      appointment: {
        findUnique: jest.fn(async ({ where }: any) => (appts[where.id] ? { id: where.id, ...appts[where.id] } : null)),
        update,
      },
    };
    svc.audit = { log: jest.fn(async () => undefined) };
    return { svc, update };
  }

  it('is 33 URL-safe characters and round-trips to the appointment id', () => {
    const { svc } = service();
    const code = svc.apptShortCode(ID_A);
    expect(code).toMatch(/^[A-Za-z0-9_-]{33}$/);
    expect(svc.verifyApptToken(code)).toBe(ID_A);
    expect(svc.buildApptSmsUrl(ID_A)).toBe(`https://lumiobooking.com/a/${code}`);
    expect(svc.buildApptSmsUrl(ID_A).length).toBeLessThanOrEqual(60);
  });

  it('refuses a tampered code or one signed for another appointment', () => {
    const { svc } = service();
    const a = svc.apptShortCode(ID_A) as string;
    const b = svc.apptShortCode(ID_B) as string;
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1);
    expect(svc.verifyApptToken(flip(a, 3))).toBeNull(); // id changed
    expect(svc.verifyApptToken(flip(a, 30))).toBeNull(); // signature changed
    expect(svc.verifyApptToken(a.slice(0, 22) + b.slice(22))).toBeNull(); // B's signature on A's id
  });

  it('is worthless under another secret', () => {
    const { svc } = service();
    const code = svc.apptShortCode(ID_A);
    process.env.JWT_SECRET = 'a-different-secret-entirely';
    expect(svc.verifyApptToken(code)).toBeNull();
    process.env.JWT_SECRET = 'test-secret-for-short-links';
  });

  it('keeps the long links already sent working', () => {
    const { svc } = service();
    const long = svc.apptToken(ID_A);
    expect(long).toContain('.');
    expect(svc.verifyApptToken(long)).toBe(ID_A);
  });

  it('falls back to the long link for an id that is not a uuid', () => {
    const { svc } = service();
    expect(svc.apptShortCode('legacy-id-1')).toBeNull();
    expect(svc.buildApptSmsUrl('legacy-id-1')).toContain('/appt/');
  });

  it('confirms through the short link', async () => {
    const { svc, update } = service({ [ID_A]: { tenantId: 'tenant-a', status: 'PENDING', startTime: new Date(Date.now() + 86400_000) } });
    const r = await svc.confirmByToken(svc.apptShortCode(ID_A));
    expect(r).toEqual({ ok: true, status: 'CONFIRMED' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ID_A } }));
  });

  it('stops working 30 days after the visit', async () => {
    const { svc, update } = service({ [ID_A]: { tenantId: 'tenant-a', status: 'PENDING', startTime: new Date(Date.now() - 31 * 86400_000) } });
    await expect(svc.confirmByToken(svc.apptShortCode(ID_A))).rejects.toThrow(/expired/);
    await expect(svc.cancelByToken(svc.apptShortCode(ID_A))).rejects.toThrow(/expired/);
    expect(update).not.toHaveBeenCalled();
  });

  it("only ever reaches the one appointment it names — never another salon's", async () => {
    const { svc, update } = service({
      [ID_A]: { tenantId: 'tenant-a', status: 'PENDING', startTime: new Date(Date.now() + 86400_000) },
      [ID_B]: { tenantId: 'tenant-b', status: 'PENDING', startTime: new Date(Date.now() + 86400_000) },
    });
    const a = svc.apptShortCode(ID_A) as string;
    await svc.confirmByToken(a);
    expect(update).toHaveBeenCalledTimes(1);
    expect((update.mock.calls[0] as any[])[0].where).toEqual({ id: ID_A });
    // Splicing tenant B's id onto tenant A's signature reaches nobody.
    const forged = svc.apptShortCode(ID_B).slice(0, 22) + a.slice(22);
    await expect(svc.confirmByToken(forged)).rejects.toThrow(/invalid/);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("brings Amy's confirmation from 5 segments to 2", () => {
    const { svc } = service();
    const body = 'Hi Rhonda! This is Amy’s Lash and Brows 💕 your appointment for Refill 3 Weeks on Thu, Oct 30 at 2:30 PM is all set see you then✨';
    const before = `${body}\nManage/cancel: https://lumiobooking.com/appt/${svc.apptToken(ID_A)}`;
    const after = toGsm7(`${body}\nManage/cancel: ${svc.buildApptSmsUrl(ID_A)}`);
    expect(smsSegments(before).segments).toBeGreaterThanOrEqual(5);
    expect(smsSegments(after)).toMatchObject({ encoding: 'GSM-7', segments: 2 });
  });
});

describe('placeholder aliases — "on %date% at %time%" no longer reads "on at"', () => {
  const data = {
    salon_name: "Amy's Lash and Brows", customer_name: 'Rhonda', customer_full_name: 'Rhonda Diaz',
    service_name: 'Refill 3 Weeks', staff_name: 'Kim', appointment_date: 'Thu, Oct 30',
    appointment_time: '2:30 PM – 4:00 PM', total_price: '$65', duration: '90 min', manage_url: '',
  };

  it('fills the common other names', () => {
    expect(fillPct('%service_name% on %date% at %time%', data)).toBe('Refill 3 Weeks on Thu, Oct 30 at 2:30 PM – 4:00 PM');
    expect(fillPct('Hi %customer_first_name%, %employee_name% at %company_name%', data)).toBe("Hi Rhonda, Kim at Amy's Lash and Brows");
    expect(fillPct('%appointment_date% at %appointment_start_time%', data)).toBe('Thu, Oct 30 at 2:30 PM');
    expect(pctValue(data, 'appointment_end_time')).toBe('4:00 PM');
    expect(pctValue(data, 'appointment_date_time')).toBe('Thu, Oct 30, 2:30 PM');
    expect(fillPct('%Date% %TIME%', data)).toBe('Thu, Oct 30 2:30 PM – 4:00 PM');
  });

  it('never overrides a key the caller provides, even an empty one', () => {
    expect(pctValue({ ...data, date: 'custom' }, 'date')).toBe('custom');
    expect(pctValue({ ...data, manage_url: '' }, 'manage_link')).toBe('');
  });

  it('still blanks a token nobody knows', () => {
    expect(fillPct('a %nonsense_token% b', data)).toBe('a  b');
  });
});
