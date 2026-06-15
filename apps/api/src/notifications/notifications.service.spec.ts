import { NotificationChannel } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function makePrisma() {
  return {
    notification: {
      create: jest.fn(async ({ data }: any) => ({ id: 'notif-1', ...data })),
    },
  };
}

describe('NotificationsService', () => {
  it('sends via the mock provider and records the notification as SENT', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);

    const notif: any = await svc.send({
      tenantId: 'tenant-a',
      channel: NotificationChannel.EMAIL,
      recipient: 'jane@example.com',
      subject: 'Hello',
      body: 'Your booking is received',
      relatedType: 'appointment',
      relatedId: 'appt-1',
    });

    expect(notif.status).toBe('SENT');
    expect(notif.tenantId).toBe('tenant-a');
    expect(notif.channel).toBe('EMAIL');
    expect(notif.provider).toBe('mock');
    expect(notif.sentAt).not.toBeNull();
  });

  it('records an SMS notification scoped to the tenant', async () => {
    const prisma = makePrisma();
    const svc = new NotificationsService(prisma as any);

    const notif: any = await svc.send({
      tenantId: 'tenant-b',
      channel: NotificationChannel.SMS,
      recipient: '+1-555-0000',
      body: 'Reminder',
    });

    expect(notif.status).toBe('SENT');
    expect(notif.tenantId).toBe('tenant-b');
    expect(notif.channel).toBe('SMS');
  });
});
