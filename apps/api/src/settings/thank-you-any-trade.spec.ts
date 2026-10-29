/**
 * The thank-you after a visit used to say "We hope you love your nails" — to
 * a lash studio's, a spa's and a restaurant's customers too. It now speaks of
 * the visit. A salon that never edited it gets the new words (old default kept
 * verbatim in storage is still a default); a salon's own words are kept; and
 * one salon's stored text never reaches another.
 */
import { SettingsService } from './settings.service';
import { DEFAULT_NOTIFICATION_TEMPLATES, LEGACY_TEMPLATE_DEFAULTS, NOTIFICATION_TEMPLATES_KEY, VN_TEMPLATE_TEXTS } from './settings.constants';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function settings(byTenant: Record<string, { market: string; stored: Record<string, unknown> }>) {
  const prisma = {
    tenant: { findUnique: jest.fn(async ({ where }: Row) => ({ market: byTenant[where.id]?.market ?? 'US' })) },
    setting: {
      findUnique: jest.fn(async ({ where }: Row) => {
        const v = byTenant[where.tenantId_key.tenantId]?.stored[where.tenantId_key.key];
        return v ? { value: v } : null;
      }),
    },
  };
  return new SettingsService(prisma as never, { log: jest.fn() } as never);
}

const def = DEFAULT_NOTIFICATION_TEMPLATES.customer_followup;
const vn = VN_TEMPLATE_TEXTS.customer_followup!;
const legacy = LEGACY_TEMPLATE_DEFAULTS.customer_followup;

describe('the thank-you fits every trade', () => {
  it('today\'s defaults name no trade', () => {
    for (const s of [def.subject, def.body, def.smsBody, vn.subject, vn.body, vn.smsBody]) {
      expect(String(s)).not.toMatch(/nail/i);
    }
    expect(def.smsBody).toContain('We hope you enjoyed your visit.');
  });

  it('an old default stored verbatim follows today\'s words (US and VN); edited words are kept', async () => {
    const svc = settings({
      us: { market: 'US', stored: { [NOTIFICATION_TEMPLATES_KEY]: { customer_followup: { body: legacy.body![0], smsBody: legacy.smsBody![0] } } } },
      vn: { market: 'VN', stored: { [NOTIFICATION_TEMPLATES_KEY]: { customer_followup: { body: legacy.body![1] } } } },
      own: { market: 'US', stored: { [NOTIFICATION_TEMPLATES_KEY]: { customer_followup: { smsBody: 'Thanks for dining with us at %salon_name%!' } } } },
    });
    const us = (await svc.getNotificationTemplates('us')).customer_followup;
    expect(us.body).toBe(def.body);
    expect(us.smsBody).toBe(def.smsBody);
    expect((await svc.getNotificationTemplates('vn')).customer_followup.body).toBe(vn.body);
    expect((await svc.getNotificationTemplates('own')).customer_followup.smsBody).toBe('Thanks for dining with us at %salon_name%!');
  });

  it('one salon\'s stored text never reaches another (cross-tenant)', async () => {
    const svc = settings({
      a: { market: 'US', stored: { [NOTIFICATION_TEMPLATES_KEY]: { customer_followup: { smsBody: 'Salon A only' } } } },
      b: { market: 'US', stored: {} },
    });
    expect((await svc.getNotificationTemplates('b')).customer_followup.smsBody).toBe(def.smsBody);
    expect((await svc.getNotificationTemplates('a')).customer_followup.smsBody).toBe('Salon A only');
  });
});
