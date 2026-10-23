import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { FEATURE_DEFS, GOVERNED_HREFS, OPEN_BY_DEFAULT, resolvePolicy } from './feature-policy.constants';
import { FeaturePolicyGuard } from './feature-policy.guard';
import { FeaturePolicyService } from './feature-policy.service';
import { FEATURE_KEY_META } from './requires-feature.decorator';
import { SettingsController } from '../settings/settings.controller';
import { AiBrainController } from '../ai-brain/ai-brain.controller';
import { TikTokController } from '../tiktok/tiktok.controller';
import { ZaloController } from '../messenger/zalo.controller';
import { MessengerController } from '../messenger/messenger.controller';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * The AI assistant group, the inbox, and every screen where a salon connects
 * an outside account (social channels, SMS / Zalo gateway, website & API) are
 * Lumio's to set up. A salon account sees them only when Super Admin hands
 * them over; a Lumio support session always does.
 */

const owner = (tenantId: string): AuthenticatedUser => ({ userId: 'u-' + tenantId, email: 'o@x.test', role: UserRole.SALON_ADMIN, tenantId });
const support = (tenantId: string): AuthenticatedUser => ({ ...owner(tenantId), supportSession: true } as AuthenticatedUser);
const superAdmin: AuthenticatedUser = { userId: 'sa', email: 'sa@x.test', role: UserRole.SUPER_ADMIN, tenantId: null } as unknown as AuthenticatedUser;

function svcWith(policies: Record<string, Record<string, string>>) {
  const prisma = {
    tenant: { findUnique: jest.fn(async ({ where }: any) => ({ featurePolicy: policies[where.id] ?? {}, market: 'US' })) },
  };
  return new FeaturePolicyService(prisma as any);
}

describe('the AI assistant and self-connect screens ship hidden', () => {
  it.each([['aiBrain', '/salon/ai'], ['channels', '/salon/channels'], ['inbox', '/salon/inbox'], ['messengerAi', '/salon/messenger'], ['voiceAi', '/salon/voice'], ['integrations', '/salon/integrations']])(
    '%s (%s) is its own switch and is OFF by default', (key, href) => {
      const def = FEATURE_DEFS.find((f) => f.key === key)!;
      expect(def.hrefs).toContain(href);
      expect(def.default).toBe('platform');
      expect(resolvePolicy({})[key]).toBe('platform');
    });

  it('the SMS / Zalo gateway keys have a switch too, with no menu route of their own', () => {
    const def = FEATURE_DEFS.find((f) => f.key === 'messagingGateway')!;
    expect(def.default).toBe('platform');
    expect(def.hrefs).toEqual([]);
  });

  it('nothing new ships open, and no route has two switches', () => {
    expect(OPEN_BY_DEFAULT).toEqual(['postApproval']);
    expect(new Set(GOVERNED_HREFS).size).toBe(GOVERNED_HREFS.length);
  });

  it('Super Admin can hand one over to one salon', () => {
    expect(resolvePolicy({ aiBrain: 'salon' }).aiBrain).toBe('salon');
    expect(resolvePolicy({ aiBrain: 'salon' }).channels).toBe('platform');
  });
});

describe('who is locked out of a switched-off feature', () => {
  const svc = svcWith({ a: {}, b: { messagingGateway: 'salon' } });

  it('a salon account whose switch is off', async () => {
    await expect(svc.lockedFor(owner('a'), 'messagingGateway')).resolves.toBe(true);
  });
  it('never the Lumio support session or Super Admin — they set it up', async () => {
    await expect(svc.lockedFor(support('a'), 'messagingGateway')).resolves.toBe(false);
    await expect(svc.lockedFor(superAdmin, 'messagingGateway')).resolves.toBe(false);
  });
  it('one salon being handed the gateway does not open it for another', async () => {
    await expect(svc.lockedFor(owner('b'), 'messagingGateway')).resolves.toBe(false);
    await expect(svc.lockedFor(owner('a'), 'messagingGateway')).resolves.toBe(true);
  });
});

describe('the API refuses a salon write the switch does not allow', () => {
  const ctxFor = (user: AuthenticatedUser, handler: Function, cls: Function) => ({
    getHandler: () => handler, getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  const guard = (policies: Record<string, Record<string, string>>) => new FeaturePolicyGuard(new Reflector(), svcWith(policies));

  it('tags every connect / AI-brain write with its switch', () => {
    const keys = (h: Function) => Reflect.getMetadata(FEATURE_KEY_META, h);
    expect(keys(TikTokController.prototype.connect)).toEqual(['channels']);
    expect(keys(TikTokController.prototype.disconnect)).toEqual(['channels']);
    expect(keys(ZaloController.prototype.connect)).toEqual(['channels', 'messengerAi']);
    expect(keys(ZaloController.prototype.oauthUrl)).toEqual(['channels', 'messengerAi']);
    expect(keys(MessengerController.prototype.connect)).toEqual(['channels', 'messengerAi']);
    expect(keys(MessengerController.prototype.disconnect)).toEqual(['channels', 'messengerAi']);
    expect(keys(AiBrainController.prototype.save)).toEqual(['aiBrain']);
    expect(keys(AiBrainController.prototype.sandbox)).toEqual(['aiBrain']);
  });

  it('blocks a salon whose switches are all off', async () => {
    await expect(guard({ a: {} }).canActivate(ctxFor(owner('a'), TikTokController.prototype.connect, TikTokController)))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard({ a: {} }).canActivate(ctxFor(owner('a'), AiBrainController.prototype.save, AiBrainController)))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('any one of several switches is enough (Facebook lives on two screens)', async () => {
    await expect(guard({ a: { messengerAi: 'salon' } }).canActivate(ctxFor(owner('a'), MessengerController.prototype.connect, MessengerController)))
      .resolves.toBe(true);
  });

  it('lets the support session and Super Admin through', async () => {
    await expect(guard({ a: {} }).canActivate(ctxFor(support('a'), TikTokController.prototype.connect, TikTokController))).resolves.toBe(true);
    await expect(guard({ a: {} }).canActivate(ctxFor(superAdmin, TikTokController.prototype.connect, TikTokController))).resolves.toBe(true);
  });

  it('a switch on for salon B never opens salon A', async () => {
    await expect(guard({ a: {}, b: { channels: 'salon' } }).canActivate(ctxFor(owner('a'), TikTokController.prototype.connect, TikTokController)))
      .rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard({ a: {}, b: { channels: 'salon' } }).canActivate(ctxFor(owner('b'), TikTokController.prototype.connect, TikTokController)))
      .resolves.toBe(true);
  });
});

describe('saving notifications with the gateway switched off', () => {
  const run = async (user: AuthenticatedUser, policies: Record<string, Record<string, string>>) => {
    const settings = { updateNotifications: jest.fn(async (_u: unknown, dto: unknown) => dto) };
    const ctl = new SettingsController(settings as any, svcWith(policies));
    await ctl.updateNotifications(user, { senderName: 'Q Nails', twilio: { accountSid: 'AC1' }, esms: { apiKey: 'k' } } as any);
    return settings.updateNotifications.mock.calls[0][1] as Record<string, unknown>;
  };

  it('keeps the salon’s email edits and drops the gateway keys', async () => {
    const dto = await run(owner('a'), { a: {} });
    expect(dto.senderName).toBe('Q Nails');
    expect(dto.twilio).toBeUndefined();
    expect(dto.esms).toBeUndefined();
  });

  it('saves the keys for the support session, or a salon handed the gateway', async () => {
    expect((await run(support('a'), { a: {} })).twilio).toEqual({ accountSid: 'AC1' });
    expect((await run(owner('b'), { b: { messagingGateway: 'salon' } })).esms).toEqual({ apiKey: 'k' });
  });
});
