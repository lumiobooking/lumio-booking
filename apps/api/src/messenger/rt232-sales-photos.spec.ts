import { MessengerService } from './messenger.service';

/** runTool on a fake service: only what the send_photos sales guard touches. */
function fake(quotePolicy: string | null) {
  const asked: unknown[] = [];
  const self: Record<string, unknown> = {
    logger: { warn: jest.fn(), log: jest.fn() },
    prisma: { messengerConnection: { findUnique: jest.fn(async (a: unknown) => { asked.push(a); return quotePolicy ? { quotePolicy } : null; }) } },
    release: { isOn: () => false },
  };
  self.salesMayQuote = (MessengerService.prototype as unknown as { salesMayQuote: (...a: unknown[]) => unknown }).salesMayQuote.bind(self);
  const run = (tenantId: string, input: Record<string, unknown>) => (MessengerService.prototype as unknown as { runTool: (...a: unknown[]) => Promise<string> }).runTool.call(
    self, tenantId, 'America/Chicago', 'send_photos', input,
    { mode: 'sales', leadEmail: null, senderId: 'psid', pageToken: 'tok', channel: 'messenger', threadId: 't1' },
  );
  return { run, asked };
}

describe('rt232 — the agency page shows its work, never a price sheet it may not quote', () => {
  it('a page that does not name prices refuses the price sheet picture', async () => {
    const f = fake(null);
    const out = await f.run('A', { kind: 'price_list' });
    expect(out).toMatch(/^NONE — prices are given by the team/);
  });

  it('a storefront picture is not a thing on a sales page', async () => {
    const f = fake('facts');
    expect(await f.run('A', { kind: 'storefront' })).toMatch(/^NONE/);
  });

  it('the price rule is read from the calling salon only', async () => {
    const f = fake(null);
    await f.run('A', { kind: 'price_list' });
    expect(JSON.stringify(f.asked)).toContain('"tenantId":"A"');
    expect(JSON.stringify(f.asked)).not.toContain('"tenantId":"B"');
  });
});
