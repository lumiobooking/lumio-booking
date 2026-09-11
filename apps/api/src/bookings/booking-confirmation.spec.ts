import { BookingsService } from './bookings.service';
import { fillPct, bookingRowValues, renderBookingEmailHtml, renderBookingEmailText, BookingTemplateData } from '../notifications/email-template';

// ===========================================================================
// The confirmation has to describe the booking that actually exists: who is
// doing the work, what was booked, and how to reach the person who booked it.
// These tests guard the two ways that used to fail — the technician being
// picked a moment AFTER the mail was written, and optional fields having
// nowhere to go.
// ===========================================================================

const futureStart = '2099-06-20T14:00:00.000Z';

function makePrisma() {
  const row = {
    id: 'appt-new',
    tenantId: 'tenant-a',
    serviceId: 'svc-a',
    startTime: new Date(futureStart),
    endTime: new Date('2099-06-20T15:00:00.000Z'),
    assignedStaffId: null as string | null,
    preferredStaffId: null,
    addons: [],
  };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    customer: { upsert: jest.fn(async () => ({ id: 'cust-1' })), create: jest.fn(async () => ({ id: 'cust-1' })) },
    tenant: { findUnique: jest.fn(async () => ({ businessType: 'SALON' })) },
    appointment: {
      // Two different questions arrive here: "is this slot free?" (a where with
      // assignedStaffId) and "give me the row back".
      findFirst: jest.fn(async ({ where }: any) => (where.assignedStaffId !== undefined ? null : { ...row })),
      create: jest.fn(async ({ data }: any) => ({ ...row, ...data })),
      updateMany: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
    },
  };
  const prisma = {
    service: {
      findFirst: jest.fn(async () => ({ id: 'svc-a', tenantId: 'tenant-a', durationMinutes: 60, priceCents: 3500, currency: 'USD', isActive: true })),
      findMany: jest.fn(async () => []),
    },
    staffMember: { findFirst: jest.fn(async () => ({ id: 'staff-9' })), findMany: jest.fn(async () => []) },
    appointment: {
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => ({ ...row })),
      updateMany: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
    },
    bookingRejection: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    _tx: tx,
    _row: row,
  };
  return prisma;
}

const audit = { log: jest.fn(async () => undefined) };
const notifications = { send: jest.fn(async () => undefined) };
const payments = { settleOnComplete: jest.fn(async () => undefined) };
const referral = { resolveReferrerId: jest.fn(async () => null) };
const push = { sendToTenant: jest.fn(async () => undefined) };
const trash = { softDelete: jest.fn(async () => undefined) };

function makeService(prisma: unknown, assignment: unknown, settings: unknown) {
  return new BookingsService(
    prisma as never, audit as never, assignment as never, notifications as never,
    settings as never, payments as never, referral as never, push as never, trash as never,
  );
}

const dto = {
  serviceId: 'svc-a',
  startTime: futureStart,
  customerFirstName: 'Jane',
  customerEmail: 'jane@example.com',
  customerPhone: '+14155550123',
};

describe('the technician is chosen before the confirmation is written', () => {
  function autoSetup(orderedStaffIds: string[]) {
    const prisma = makePrisma();
    const assignment = { rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds, ranked: [] })) };
    const settings = {
      getBookingRules: jest.fn(async () => ({ assignmentMode: 'auto' })),
      getNotificationSettings: jest.fn(async () => ({ smtp: {}, twilio: {} })),
    };
    const svc = makeService(prisma, assignment, settings);
    const confirm = jest.fn(async () => undefined);
    (svc as any).sendBookingConfirmation = confirm;
    const staffMail = jest.fn(async () => undefined);
    (svc as any).sendStaffAssignmentEmail = staffMail;
    return { prisma, assignment, settings, svc, confirm, staffMail };
  }

  it('hands the confirmation a booking that already names the technician', async () => {
    const { svc, confirm } = autoSetup(['staff-9']);

    await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'hosted', null, { autoAssign: true });

    expect(confirm).toHaveBeenCalledTimes(1);
    // This is the whole bug: the argument used to be the freshly-created row,
    // with assignedStaffId still null, so the customer read "To be assigned".
    expect(confirm.mock.calls[0][1].assignedStaffId).toBe('staff-9');
  });

  it('does not tell the technician twice', async () => {
    const { svc, staffMail } = autoSetup(['staff-9']);
    await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'hosted', null, { autoAssign: true });
    // autoAssignForTenant sends that mail itself, once the whole visit is staffed.
    expect(staffMail).toHaveBeenCalledTimes(1);
  });

  it('still confirms when nobody can be assigned', async () => {
    const { svc, confirm } = autoSetup([]);
    await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'hosted', null, { autoAssign: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][1].assignedStaffId).toBeNull();
  });

  it('leaves callers that did not ask for it exactly as they were', async () => {
    const { svc, assignment, confirm } = autoSetup(['staff-9']);
    await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'admin', null);
    expect(assignment.rankEligibleStaff).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('never lets a failing engine lose the booking', async () => {
    const prisma = makePrisma();
    const assignment = { rankEligibleStaff: jest.fn(async () => { throw new Error('engine down'); }) };
    const settings = { getBookingRules: jest.fn(async () => ({ assignmentMode: 'auto' })) };
    const svc = makeService(prisma, assignment, settings);
    (svc as any).sendBookingConfirmation = jest.fn(async () => undefined);
    (svc as any).sendStaffAssignmentEmail = jest.fn(async () => undefined);

    const out: any = await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'hosted', null, { autoAssign: true });
    expect(out.id).toBe('appt-new');
  });

  it('respects a salon that assigns by hand', async () => {
    const prisma = makePrisma();
    const assignment = { rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: ['staff-9'], ranked: [] })) };
    const settings = { getBookingRules: jest.fn(async () => ({ assignmentMode: 'none' })) };
    const svc = makeService(prisma, assignment, settings);
    (svc as any).sendBookingConfirmation = jest.fn(async () => undefined);
    (svc as any).sendStaffAssignmentEmail = jest.fn(async () => undefined);

    await svc.createForTenant('tenant-a', dto as any, 'u-admin', 'hosted', null, { autoAssign: true });
    expect(assignment.rankEligibleStaff).not.toHaveBeenCalled();
  });
});

// ===========================================================================

const base: BookingTemplateData = {
  salon: 'Lumio Nails', customer: 'Jane', service: 'Colour',
  date: 'Sat, June 20, 2099', time: '2:00 PM – 3:00 PM', technician: 'Anna Tran',
  total: '$76.05', duration: '60 min', addons: 'Nail Design, Take Off',
  accent: '#6366f1', contact: 'hello@lumio.test',
};

describe('what each reader is shown', () => {
  const rich: BookingTemplateData = {
    ...base,
    addonsOnly: 'Take Off',
    lineup: 'Colour — Anna Tran · Nail Design — Kim Le',
    reference: 'A1B2C3',
    notes: 'Please use the gel top coat',
    address: '123 Bolsa Ave, Westminster CA',
    customerPhone: '+1 415 555 0123',
    customerEmail: 'jane@example.com',
    source: 'hosted',
    manageUrl: 'https://book.lumio.test/appt/xyz',
  };
  const labels = (a: 'customer' | 'owner' | 'staff') => bookingRowValues(rich, a, 'en').map(([l]) => l);

  it('never reads the customer their own contact details back', () => {
    expect(labels('customer')).not.toContain('Phone');
    expect(labels('customer')).not.toContain('Email');
  });

  it('gives the salon what it needs to act on the booking', () => {
    expect(labels('owner')).toEqual(expect.arrayContaining(['Customer', 'Phone', 'Email', 'Technician', 'Booked via', 'Notes']));
  });

  it('gives the technician the client and the split of the visit', () => {
    const rows = bookingRowValues(rich, 'staff', 'en');
    expect(rows.map(([l]) => l)).toEqual(expect.arrayContaining(['Phone', 'Services', 'Notes']));
    expect(rows.find(([l]) => l === 'Services')?.[1]).toContain('Kim Le');
  });

  it('puts the price last and makes it the emphasised row', () => {
    const rows = bookingRowValues(rich, 'customer', 'en');
    expect(rows[rows.length - 1][0]).toBe('Total');
    expect(rows[rows.length - 1][2]).toBe(true);
  });

  it('skips a row the booking has nothing for', () => {
    const thin = bookingRowValues(base, 'customer', 'en').map(([l]) => l);
    expect(thin).not.toContain('Notes');
    expect(thin).not.toContain('Address');
    expect(thin).toContain('Technician');
  });

  it('writes Vietnamese for a Vietnamese salon and English for everyone else', () => {
    expect(bookingRowValues(rich, 'customer', 'vi').map(([l]) => l)).toContain('Thợ làm');
    expect(bookingRowValues(rich, 'customer', 'en').map(([l]) => l)).toContain('Technician');
  });

  it('names the technician in both the HTML and the plain-text body', () => {
    const html = renderBookingEmailHtml({ heading: 'Booking confirmed', intro: 'Hi', footer: '', d: rich });
    const text = renderBookingEmailText('Booking confirmed', 'Hi', '', rich);
    expect(html).toContain('Anna Tran');
    expect(html).toContain(rich.manageUrl as string);
    expect(text).toContain('Technician: Anna Tran');
  });

  it('renders exactly what it used to for a caller that passes nothing new', () => {
    const html = renderBookingEmailHtml({ heading: 'Booking confirmed', intro: 'Hi', footer: '', d: base });
    expect(html).toContain('Nail Design, Take Off'); // legacy combined add-ons
    expect(html).not.toContain('Phone');
  });
});

describe('a label with nothing after it is not a line', () => {
  it('drops the empty one and keeps the filled one', () => {
    const out = fillPct('Service: %service_name%\nYour note: %booking_notes%\nTotal: %total_price%', {
      service_name: 'Colour', booking_notes: '', total_price: '$76.05',
    });
    expect(out).toBe('Service: Colour\nTotal: $76.05');
  });

  it('does the same inside the HTML bodies the editor produces', () => {
    const out = fillPct('<p>Service: %service_name%<br>Add-ons: %add_ons_only%<br>Total: %total_price%</p>', {
      service_name: 'Colour', add_ons_only: '', total_price: '$76.05',
    });
    expect(out).toBe('<p>Service: Colour<br>Total: $76.05</p>');
  });

  it('leaves prose alone even when a placeholder in it is empty', () => {
    const out = fillPct('We look forward to seeing you at %salon_address% soon.', { salon_address: '' });
    expect(out).toBe('We look forward to seeing you at  soon.');
  });

  it('keeps a line whose placeholders are filled', () => {
    expect(fillPct('Tech: %staff_name%', { staff_name: 'Anna' })).toBe('Tech: Anna');
  });

  it('is unchanged for a template with no empty placeholder', () => {
    const tpl = 'Hi %customer_name%,<br>Your %service_name% is confirmed.';
    expect(fillPct(tpl, { customer_name: 'Jane', service_name: 'Colour' }))
      .toBe('Hi Jane,<br>Your Colour is confirmed.');
  });
});
