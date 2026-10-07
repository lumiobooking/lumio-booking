/**
 * The per-guest party deposit is asked ONLY through a real online provider —
 * without one there is nobody to take the money, and nothing may be recorded
 * as paid that was not (the mock provider would "charge" anything).
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), TenantStatus: { ACTIVE: 'ACTIVE' } }));
jest.mock('../payments/payments.service', () => ({ PaymentsService: class {} }));
jest.mock('../payments-hub/payment-orchestrator.service', () => ({ PaymentOrchestrator: class {} }));
import { PublicSalonController } from './public-salon.controller';
import { partyDepositCents } from '../payments/party-deposit';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(provider: string | null) {
  const charged: Row[] = [];
  const prisma: Row = { tenant: { findFirst: async () => ({ id: 't1', status: 'ACTIVE', billingExempt: true, accessUntil: null }) } };
  const bookings: Row = { createForTenant: async () => ({ id: 'ap1', customerId: 'c1', priceCents: 0, partySize: 10 }) };
  const payments: Row = {
    depositFor: async (_t: string, appt: Row, _d: Row, party: Row) => partyDepositCents(appt.partySize, party as never),
    createDepositForBookingTenant: async (...a: unknown[]) => { charged.push(a); return { id: 'p' }; },
    createForBookingTenant: async () => null,
  };
  const settings: Row = { getDepositSettings: async () => ({ enabled: false }), getPartyDeposit: async () => ({ enabled: true, fromParty: 8, perPersonCents: 1000 }) };
  const hub: Row = { onlineProviderFor: async () => provider };
  return { ctl: new PublicSalonController(prisma as never, bookings as never, payments as never, settings as never, hub as never), charged };
}
const dto = { serviceId: 's', startTime: '2030-03-09T19:00:00.000Z', customerFirstName: 'Anna', customerPhone: '5125551234', partySize: 10 };

describe('party deposit at booking', () => {
  it('with a real provider: 10 × 10.00 is due, paid in the provider\'s checkout (nothing charged here)', async () => {
    const { ctl, charged } = make('helcim');
    const r: Row = await ctl.createBooking('bistro', dto as never);
    expect(r.depositCents).toBe(10000);
    expect(r.onlineProvider).toBe('helcim');
    expect(charged).toHaveLength(0);
  });
  it('without a provider: no party deposit, nothing recorded as paid', async () => {
    const { ctl, charged } = make(null);
    const r: Row = await ctl.createBooking('bistro', dto as never);
    expect(r.depositCents).toBe(0);
    expect(charged).toHaveLength(0);
  });
});
