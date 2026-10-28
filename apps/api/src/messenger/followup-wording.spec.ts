import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import {
  botSignedOff, cleanFollowUp, contextualNudge, customerClosed, decideFollowUp, DEFAULT_FOLLOWUP,
  isNudgeLine, NUDGE_TEMPLATES, threadStateFrom, type StoredTurn,
} from './followup';
import { SettingsService } from '../settings/settings.service';
import { AiBrainController, TEACH_KEYS } from '../ai-brain/ai-brain.controller';
import { FeaturePolicyGuard } from '../feature-policy/feature-policy.guard';
import { FeaturePolicyService } from '../feature-policy/feature-policy.service';
import { FEATURE_KEY_META } from '../feature-policy/requires-feature.decorator';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

/**
 * "I cannot change what the AI says": the owner pressed Fix under a bot line
 * in the Inbox and got "managed by Lumio", and the line itself — "I am still
 * here — …" — was a fixed reminder no instruction could reach, sent after the
 * customer had already said "thanks, have a great day", and sent again
 * word for word. Each of those, here.
 */
const NOW = new Date('2026-10-28T19:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const on = { ...DEFAULT_FOLLOWUP, enabled: true, firstAfterMin: 30, secondAfterMin: 120, maxPerWindow: 2 };

describe('a conversation that already ended is not nudged', () => {
  it.each([
    'Not vain enough. Thanks and have a great day',
    'no thanks',
    'Thank you!',
    'ok thanks',
    'I’ll let you know',
    "I'll think about it",
    'maybe next time',
    "I'm good, thanks",
    'bye',
    'không cần đâu ạ',
    'thôi em nhé',
    'cảm ơn em nhiều',
    'để lần sau nha',
    'để chị suy nghĩ thêm',
    'ko',
  ])('customer: %s', (t) => expect(customerClosed(t)).toBe(true));

  it.each([
    'How much is a gel fill?',
    'no thanks — how much for a pedicure?',
    "I'm good with 3pm",
    'Thanks, can I come at 4?',
    'Lan',
    '5128868189',
    'tối nay còn chỗ không em',
    'thứ 7 được không',
  ])('still talking: %s', (t) => expect(customerClosed(t)).toBe(false));

  it('the bot signing off closes it; a sign-off that still asks something does not', () => {
    expect(botSignedOff('No problem at all! Have a great day 😊')).toBe(true);
    expect(botSignedOff('Dạ em cảm ơn chị, chúc chị một ngày vui vẻ ạ!')).toBe(true);
    expect(botSignedOff('Have a great day! Is there anything else I can help with?')).toBe(false);
    expect(botSignedOff('We have openings at 2pm and 4pm.')).toBe(false);
  });

  it('the screenshot thread: declined, the bot said goodbye → skipped as "closed"', () => {
    const history: StoredTurn[] = [
      { role: 'user', content: 'How much for a full set?', at: ago(200) },
      { role: 'assistant', content: 'A full set is $55. Want me to book a time?', at: ago(199) },
      { role: 'user', content: 'Not vain enough. Thanks and have a great day', at: ago(190) },
      { role: 'assistant', content: 'No worries at all — have a wonderful day!', at: ago(189) },
    ];
    const s = threadStateFrom({ history, lastCustomerAt: ago(190), lastMessageAt: ago(189), handoff: false, assigned: false, booked: false });
    expect(s.closed).toBe(true);
    expect(decideFollowUp(s, on, NOW, 14)).toEqual({ send: false, why: 'closed' });
  });

  it('a customer who reopens after a no-thanks is nudged again as normal', () => {
    const history: StoredTurn[] = [
      { role: 'user', content: 'no thanks', at: ago(300) },
      { role: 'assistant', content: 'Okay!', at: ago(299) },
      { role: 'user', content: 'actually what time tomorrow?', at: ago(60) },
      { role: 'assistant', content: 'Tomorrow we have 10am or 2pm — which works for you?', at: ago(59) },
    ];
    const s = threadStateFrom({ history, lastCustomerAt: ago(60), lastMessageAt: ago(59), handoff: false, assigned: false, booked: false });
    expect(s.closed).toBe(false);
    expect(decideFollowUp(s, on, NOW, 14)).toEqual({ send: true, nth: 1 });
  });
});

describe('the salon writes its own reminder, and none is sent twice', () => {
  it('the salon’s line replaces the generic one, in the customer’s language', () => {
    const custom = { vi: 'Dạ chị ơi, tiệm còn chỗ chiều nay ạ.', en: 'We still have an opening this afternoon if you’d like it.' };
    expect(contextualNudge('Anything else?', false, 1, { custom })).toBe(custom.en);
    expect(contextualNudge('Anything else?', true, 1, { custom })).toBe(custom.vi);
    // A concrete ask (confirm the recap) keeps its specific line first.
    expect(contextualNudge('Shall I book it?', false, 1, { custom })).toMatch(/reply "yes"/);
  });

  it('a second nudge is never the same sentence; when nothing new is left, nothing is sent', () => {
    const first = contextualNudge('Anything else?', false, 1)!;
    expect(first).toBe(NUDGE_TEMPLATES[1].en);
    const second = contextualNudge('Anything else?', false, 2, { sent: [first] });
    expect(second).not.toBe(first);
    expect(second).toBeTruthy();
    expect(contextualNudge('Anything else?', false, 2, { sent: [first, second!] })).toBeNull();
    // Case, spacing and a trailing emoji do not make it "different".
    expect(contextualNudge('x', false, 2, { sent: [first.toUpperCase() + ' 😊', NUDGE_TEMPLATES[0].en] })).toBeNull();
  });

  it('the thread remembers every nudge it got', () => {
    const history: StoredTurn[] = [
      { role: 'user', content: 'price for gel?', at: ago(400) },
      { role: 'assistant', content: 'Gel is $35.', at: ago(399) },
      { role: 'assistant', content: NUDGE_TEMPLATES[1].en, at: ago(300), nudge: true },
    ];
    const s = threadStateFrom({ history, lastCustomerAt: ago(400), lastMessageAt: ago(300), handoff: false, assigned: false, booked: false });
    expect(s.sentNudges).toEqual([NUDGE_TEMPLATES[1].en]);
    expect(contextualNudge(s.lastBotText, false, 2, { sent: s.sentNudges })).not.toBe(NUDGE_TEMPLATES[1].en);
  });

  it('stored wording is cleaned and capped; junk is empty', () => {
    const c = cleanFollowUp({ messageEn: '  Hi\u0000 there   friend  ', messageVi: 'x'.repeat(900) });
    expect(c.messageEn).toBe('Hi there friend');
    expect(c.messageVi.length).toBe(300);
    expect(cleanFollowUp({ messageEn: 42 }).messageEn).toBe('');
    expect(cleanFollowUp({}).enabled).toBe(false);
  });

  it('the Inbox can tell a reminder from an answer', () => {
    expect(isNudgeLine(NUDGE_TEMPLATES[1].en)).toBe(true);
    expect(isNudgeLine('My own line', { en: 'My own line' })).toBe(true);
    expect(isNudgeLine('A full set is $55.')).toBe(false);
  });

  it('cross-tenant: salon A’s wording is stored under salon A only', async () => {
    const rows = new Map<string, unknown>();
    const prisma = {
      setting: {
        findUnique: jest.fn(async ({ where }: any) => (rows.has(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) ? { value: rows.get(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`) } : null)),
        upsert: jest.fn(async ({ where, create }: any) => { rows.set(`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`, create.value); }),
      },
    };
    const svc = new SettingsService(prisma as any, { log: jest.fn() } as any);
    const a = { userId: 'ua', email: 'a@x', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' } as AuthenticatedUser;
    const b = { userId: 'ub', email: 'b@x', role: UserRole.SALON_ADMIN, tenantId: 'tenant-b' } as AuthenticatedUser;
    const saved = await svc.updateChatFollowUp(a, { enabled: true, messageEn: 'Salon A says hi', tenantId: 'tenant-b' } as any);
    expect(saved.messageEn).toBe('Salon A says hi');
    expect((await svc.getChatFollowUp(a)).messageEn).toBe('Salon A says hi');
    expect((await svc.getChatFollowUp(b)).messageEn).toBe('');
    expect(prisma.setting.upsert.mock.calls.every(([x]: any) => x.where.tenantId_key.tenantId === 'tenant-a')).toBe(true);
  });
});

describe('teaching the AI from the Inbox is not blocked by the AI-brain screen switch', () => {
  const owner = (tenantId: string): AuthenticatedUser => ({ userId: 'u-' + tenantId, email: 'o@x.test', role: UserRole.SALON_ADMIN, tenantId });
  const guard = (policies: Record<string, Record<string, string>>) => new FeaturePolicyGuard(new Reflector(), new FeaturePolicyService({
    tenant: { findUnique: jest.fn(async ({ where }: any) => ({ featurePolicy: policies[where.id] ?? {}, market: 'US' })) },
  } as any));
  const ctx = (user: AuthenticatedUser, handler: Function) => ({
    getHandler: () => handler, getClass: () => AiBrainController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as any;
  const routes = [AiBrainController.prototype.createInstruction, AiBrainController.prototype.tryInstruction, AiBrainController.prototype.updateInstruction, AiBrainController.prototype.deleteInstruction];

  it('every teach route opens on the brain, the Inbox or either bot screen', () => {
    for (const r of routes) expect(Reflect.getMetadata(FEATURE_KEY_META, r)).toEqual(TEACH_KEYS);
    expect(TEACH_KEYS).toEqual(['aiBrain', 'inbox', 'messengerAi', 'voiceAi']);
    // The brain's own settings stay with the brain switch.
    expect(Reflect.getMetadata(FEATURE_KEY_META, AiBrainController.prototype.save)).toEqual(['aiBrain']);
  });

  it('a salon handed the Inbox may teach; one with every switch off may not', async () => {
    for (const r of routes) {
      await expect(guard({ a: { inbox: 'salon' } }).canActivate(ctx(owner('a'), r))).resolves.toBe(true);
      await expect(guard({ a: {} }).canActivate(ctx(owner('a'), r))).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('cross-tenant: salon B’s Inbox switch never opens teaching for salon A', async () => {
    await expect(guard({ a: {}, b: { inbox: 'salon' } }).canActivate(ctx(owner('a'), AiBrainController.prototype.createInstruction))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard({ a: {}, b: { inbox: 'salon' } }).canActivate(ctx(owner('b'), AiBrainController.prototype.createInstruction))).resolves.toBe(true);
  });
});

