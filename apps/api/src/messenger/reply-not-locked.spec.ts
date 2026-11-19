import { FEATURE_KEY_META } from '../feature-policy/requires-feature.decorator';
import { MessengerController } from './messenger.controller';

/**
 * rt221 — "tài khoản nhân viên không cho phép nhắn". A salon whose AI is run by
 * Lumio (messengerAi = platform) still answers its own customers: sending a
 * message, a photo, a payment QR or a library photo, and the takeover brief
 * carry no feature lock. The AI's settings keep theirs.
 */
describe('rt221 — replying is never locked by the AI feature switch', () => {
  const proto = MessengerController.prototype as unknown as Record<string, unknown>;
  it.each(['send', 'sendPhoto', 'sendPayQr', 'sendLibraryPhoto', 'threadBrief'])('%s has no feature lock', (m) => {
    expect(typeof proto[m]).toBe('function');
    expect(Reflect.getMetadata(FEATURE_KEY_META, proto[m] as object)).toBeUndefined();
  });

  it('the AI settings stay locked to the switch', () => {
    expect(Reflect.getMetadata(FEATURE_KEY_META, proto.update as object)).toEqual(['messengerAi']);
  });
});

describe('rt221 — reading a read conversation writes nothing (no refresh loop)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MessengerService } = require('./messenger.service') as typeof import('./messenger.service');
  const call = (row: Record<string, unknown> | null, tenantId = 'A') => {
    const update = jest.fn(async () => ({}));
    const self = { tenantId: () => tenantId, prisma: { messengerThread: { findFirst: jest.fn(async ({ where }: { where: { tenantId: string } }) => (row && where.tenantId === row.tenantId ? row : null)), update } }, turns: undefined };
    return { run: () => (MessengerService.prototype.markThreadRead as unknown as (this: unknown, u: unknown, id: string) => Promise<unknown>).call(self, { userId: 'u', role: 'STAFF', tenantId }, 't1'), update };
  };
  it('already read since the last message: no write', async () => {
    const c = call({ id: 't1', tenantId: 'A', readAt: new Date('2026-11-19T10:05:00Z'), lastMessageAt: new Date('2026-11-19T10:00:00Z') });
    await c.run();
    expect(c.update).not.toHaveBeenCalled();
  });
  it('a newer message: it is marked read', async () => {
    const c = call({ id: 't1', tenantId: 'A', readAt: new Date('2026-11-19T09:00:00Z'), lastMessageAt: new Date('2026-11-19T10:00:00Z') });
    await c.run();
    expect(c.update).toHaveBeenCalled();
  });
  it('another salon’s conversation is not found', async () => {
    const c = call({ id: 't1', tenantId: 'A', readAt: null, lastMessageAt: new Date() }, 'B');
    await expect(c.run()).rejects.toThrow();
    expect(c.update).not.toHaveBeenCalled();
  });
});
