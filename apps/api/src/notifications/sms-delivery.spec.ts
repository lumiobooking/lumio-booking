import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { carrierCode, twilioOutcome, undeliveredError, undeliveredHold } from './sms-delivery';
import { senderForRecipient } from './providers/sms-routing';

const H = 60 * 60 * 1000;
const now = Date.parse('2026-10-29T18:00:00Z');
const row = (hoursAgo: number, error: string | null, delivered = false) => ({
  createdAt: new Date(now - hoursAgo * H), error, deliveredAt: delivered ? new Date(now - hoursAgo * H) : null,
});

describe('undeliveredHold — stop paying for texts that never arrive', () => {
  it('holds after two landline / unknown-number failures, with no time limit', () => {
    const rows = [row(200, undeliveredError('30006', 'undelivered')), row(201, undeliveredError('30005', 'undelivered'))];
    expect(undeliveredHold(rows, now)).toMatch(/Check the customer's phone number/);
  });

  it('holds 24 hours after two soft failures, then tries again', () => {
    const rows = [row(2, undeliveredError('30003', 'undelivered')), row(3, undeliveredError('30003', 'undelivered'))];
    expect(undeliveredHold(rows, now)).toMatch(/Paused for 24 hours/);
    const later = [row(25, undeliveredError('30003', 'undelivered')), row(26, undeliveredError('30003', 'undelivered'))];
    expect(undeliveredHold(later, now)).toBeNull();
  });

  it('sends when either of the last two arrived, is still pending, or failed at the API (not billed)', () => {
    expect(undeliveredHold([row(1, null, true), row(2, undeliveredError('30006', 'undelivered'))], now)).toBeNull();
    expect(undeliveredHold([row(1, null), row(2, undeliveredError('30006', 'undelivered'))], now)).toBeNull();
    expect(undeliveredHold([row(1, 'Twilio 21612: cannot route'), row(2, undeliveredError('30006', 'undelivered'))], now)).toBeNull();
    expect(undeliveredHold([row(1, undeliveredError('30006', 'undelivered'))], now)).toBeNull();
    expect(undeliveredHold([], now)).toBeNull();
  });

  it('reads Twilio statuses and its own stored errors', () => {
    expect(twilioOutcome('delivered')).toBe('delivered');
    expect(twilioOutcome('undelivered')).toBe('undelivered');
    expect(twilioOutcome('failed')).toBe('undelivered');
    expect(twilioOutcome('sent')).toBe('pending');
    expect(carrierCode(undeliveredError('30007', 'undelivered'))).toBe('30007');
    expect(carrierCode('Twilio 21211: invalid')).toBeNull();
  });
});

describe('senderForRecipient — an Australian customer is texted from the Australian number', () => {
  it('routes +61 recipients of a US salon through the shared AU number', () => {
    expect(senderForRecipient({ kind: 'default' }, '+61457678899', '+61485085339')).toEqual({ kind: 'from', from: '+61485085339' });
  });
  it('leaves US/CA recipients, refusals and explicit senders alone', () => {
    expect(senderForRecipient({ kind: 'default' }, '+16316420996', '+61485085339')).toEqual({ kind: 'default' });
    expect(senderForRecipient({ kind: 'refuse', error: 'x' }, '+61457678899', '+61485085339')).toEqual({ kind: 'refuse', error: 'x' });
    expect(senderForRecipient({ kind: 'from', from: '+61400000000' }, '+61457678899', '+61485085339')).toEqual({ kind: 'from', from: '+61400000000' });
  });
  it('keeps the default when no AU number is configured', () => {
    expect(senderForRecipient({ kind: 'default' }, '+61457678899', '')).toEqual({ kind: 'default' });
  });
});

describe('NotificationsService — delivery reports and the hold, per salon', () => {
  type Row = Record<string, any>;
  function harness(rows: Row[]) {
    const created: Row[] = [];
    const prisma: any = {
      notification: {
        create: jest.fn(async ({ data }: any) => { created.push(data); return { ...data }; }),
        findMany: jest.fn(async ({ where }: any) => rows
          .filter((r) => r.tenantId === where.tenantId && r.recipient === where.recipient && r.provider === where.provider)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 2)),
        findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.provider === where.provider && r.providerMessageId === where.providerMessageId) ?? null),
        update: jest.fn(async ({ where, data }: any) => { Object.assign(rows.find((r) => r.id === where.id)!, data); return {}; }),
      },
      tenant: { findUnique: jest.fn(async () => ({ market: 'US', timezone: 'America/New_York' })) },
      setting: { findFirst: jest.fn(async () => null) },
    };
    const svc = new NotificationsService(prisma);
    const sendSms = jest.fn(async (_m: any) => ({ success: true, providerMessageId: 'SMnew' }));
    (svc as any).sms = { name: 'twilio', sendSms };
    (svc as any).esmsForTenant = async () => null;
    return { svc, sendSms, created, prisma };
  }
  const dead = (tenantId: string, id: string, hoursAgo: number) => ({
    id, tenantId, recipient: '(631) 642-0996', provider: 'twilio', providerMessageId: `SM${id}`,
    createdAt: new Date(Date.now() - hoursAgo * H), error: undeliveredError('30006', 'undelivered'), deliveredAt: null,
  });

  it('holds the third text to a dead number instead of paying for it', async () => {
    const { svc, sendSms } = harness([dead('tenant-a', '1', 1), dead('tenant-a', '2', 2)]);
    const n: any = await svc.send({ tenantId: 'tenant-a', channel: NotificationChannel.SMS, recipient: '(631) 642-0996', body: 'Reminder' });
    expect(sendSms).not.toHaveBeenCalled();
    expect(n.status).toBe('FAILED');
    expect(n.provider).toBe('sms-guard');
  });

  it("never holds a text because of ANOTHER salon's failures", async () => {
    const { svc, sendSms } = harness([dead('tenant-a', '1', 1), dead('tenant-a', '2', 2)]);
    const n: any = await svc.send({ tenantId: 'tenant-b', channel: NotificationChannel.SMS, recipient: '(631) 642-0996', body: 'Reminder' });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(n.status).toBe('SENT');
  });

  it('sends plain GSM-7 text and asks Twilio for a delivery report', async () => {
    const { svc, sendSms, created } = harness([]);
    await svc.send({ tenantId: 'tenant-a', channel: NotificationChannel.SMS, recipient: '+15550001111', body: 'Amy’s Lash 💕 see you — soon' });
    const msg = (sendSms.mock.calls[0] as any[])[0];
    expect(msg.body).toBe("Amy's Lash see you - soon");
    expect(msg.statusCallback).toMatch(/\/api\/public\/twilio\/sms-status$/);
    expect(created[0].body).toBe("Amy's Lash see you - soon");
  });

  it('records the carrier outcome only on a Twilio row it sent', async () => {
    const rows: Row[] = [
      { id: 'r1', provider: 'twilio', providerMessageId: 'SMabc', status: 'SENT', error: null, deliveredAt: null },
      { id: 'r2', provider: 'esms', providerMessageId: 'SMxyz', status: 'SENT', error: null, deliveredAt: null },
    ];
    const { svc } = harness(rows);
    await svc.applyTwilioStatus({ MessageSid: 'SMabc', MessageStatus: 'undelivered', ErrorCode: '30006' });
    await svc.applyTwilioStatus({ MessageSid: 'SMxyz', MessageStatus: 'undelivered', ErrorCode: '30006' });
    expect(rows[0]).toMatchObject({ status: 'FAILED' });
    expect(carrierCode(rows[0].error)).toBe('30006');
    expect(rows[1]).toMatchObject({ status: 'SENT', error: null });
    // A later "delivered" for the same message wins; a later failure never undoes a delivery.
    await svc.applyTwilioStatus({ MessageSid: 'SMabc', MessageStatus: 'delivered' });
    expect(rows[0]).toMatchObject({ status: 'SENT', error: null });
    await svc.applyTwilioStatus({ MessageSid: 'SMabc', MessageStatus: 'undelivered', ErrorCode: '30003' });
    expect(rows[0]).toMatchObject({ status: 'SENT', error: null });
  });
});
