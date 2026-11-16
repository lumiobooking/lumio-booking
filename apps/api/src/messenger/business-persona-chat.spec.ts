/**
 * The chat bot speaks in the voice of the tenant's own trade
 * (common/business-persona): a nail salon's prompt is unchanged, every other
 * trade is told its words — and the trade is read from THIS tenant's own data.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mocked = chat as unknown as jest.Mock;
const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });

const TENANTS: Record<string, Row> = {
  nail: { name: 'Zb Nails', businessType: 'SALON', menu: ['Gel Manicure', 'Deluxe Pedicure', 'Acrylic Full Set'] },
  pho: { name: 'Nẫu Chill', businessType: 'RESTAURANT', menu: ['Phở bò', 'Bún chả'] },
  hair: { name: 'Mây Hair', businessType: 'SALON', menu: ['Women haircut', 'Men haircut', 'Balayage', 'Blow dry'] },
  clinic: { name: 'Smile Dental', businessType: 'SERVICE', industry: 'DENTAL', menu: ['Check-up', 'Cleaning'] },
};

function build() {
  const asked: Row[] = [];
  const prisma = {
    tenant: { findUnique: async ({ where }: Row) => ({ timezone: 'America/Chicago', contactPhone: null, contactEmail: null, market: 'US', ...TENANTS[where.id] }) },
    setting: { findFirst: async ({ where }: Row) => (where.key === 'industry' && TENANTS[where.tenantId]?.industry ? { value: { key: TENANTS[where.tenantId].industry } } : null) },
    service: { findMany: async (q: Row) => { asked.push(q.where); return (TENANTS[q.where.tenantId]?.menu ?? []).map((name: string) => ({ name })); } },
  };
  const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never);
  (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
  return { svc: s as unknown as { runAgent: (...a: unknown[]) => Promise<string> }, asked };
}
async function systemFor(tenantId: string, mode: 'booking' | 'sales' = 'booking') {
  mocked.mockReset();
  mocked.mockResolvedValue(reply('Hello! How can I help?'));
  const { svc, asked } = build();
  await svc.runAgent(tenantId, '', [{ role: 'user', content: 'hi' }], 'hi', { mode, leadEmail: null, channel: 'messenger' });
  const system = (mocked.mock.calls[0][0].system as { text: string }[]).map((b) => b.text).join('\n');
  return { system, asked };
}

describe('the chat bot speaks its own trade', () => {
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });

  it('a nail salon: no trade rule, still "a nail salon"', async () => {
    const { system } = await systemFor('nail');
    expect(system).toContain('"Zb Nails", a nail salon');
    expect(system).not.toContain('NOT A NAIL SALON');
  });

  it('a restaurant is told a booking is a table and that the nail examples are not its own', async () => {
    const { system } = await systemFor('pho');
    expect(system).toContain('"Nẫu Chill", a restaurant');
    expect(system).toContain('THIS BUSINESS IS RESTAURANT — NOT A NAIL SALON');
    expect(system).toContain('A booking here is a TABLE');
    expect(system).toContain('Never repeat them, never mention a nail service');
  });

  it('a SALON whose own menu is haircuts is a hair salon, with stylists', async () => {
    const { system } = await systemFor('hair');
    expect(system).toContain('"Mây Hair", a hair salon');
    expect(system).toContain('understand "stylist"');
  });

  it('a clinic has patients and never diagnoses', async () => {
    const { system } = await systemFor('clinic');
    expect(system).toContain('a dental clinic');
    expect(system).toContain('Never diagnose');
  });

  it('the menu it reads is this tenant\'s only', async () => {
    const { asked } = await systemFor('hair');
    expect(asked.length).toBeGreaterThan(0);
    for (const w of asked) expect(w.tenantId).toBe('hair');
  });

  it('a sales page is not given a booking trade rule', async () => {
    const { system } = await systemFor('pho', 'sales');
    expect(system).not.toContain('NOT A NAIL SALON');
  });
});
