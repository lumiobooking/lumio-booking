/**
 * THE LIVE AI, WITHOUT A CUSTOMER (./dry-run, MessengerService.dryRun).
 *
 * The checks that decide whether a new behaviour may reach every salon run
 * the REAL assistant on scripted conversations. That is only safe if a dry
 * run can never write, book, send or count anything — pinned here, tool by
 * tool, and against the service itself.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { readFileSync } from 'fs';
import { join } from 'path';
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';
import { READ_ONLY_TOOLS } from './burst';
import { dryToolResult, isDryCovered } from './dry-run';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const mocked = chat as unknown as jest.Mock;
const text = (t: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text: t }], usage: {} } });
const tool = (name: string, input: Row = {}) => ({ ok: true, reply: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu-${name}`, name, input }], usage: {} } });

describe('what a doing-tool says in a test run', () => {
  it('answers as the real tool would, and says plainly that nothing was written', () => {
    expect(dryToolResult('create_booking', { phone: '512-000-0000' })).toMatch(/^SUCCESS\. Appointment created/);
    expect(dryToolResult('create_booking', { phone: '512-000-0000' })).toContain('TEST RUN');
    expect(dryToolResult('create_booking', {})).toBe('ERROR: A phone number is required to book.'); // the real refusal, so the AI asks for it
    expect(dryToolResult('save_lead', {})).toMatch(/^ERROR/);
    expect(dryToolResult('save_lead', { name: 'An' })).toMatch(/^SUCCESS/);
    expect(dryToolResult('cancel_appointment', {})).toMatch(/^SUCCESS/);
    expect(dryToolResult('request_callback', {})).toMatch(/^NOTED/);
  });

  it('tools that only look run for real; so do the ones that touch nothing or guard themselves', () => {
    for (const t of READ_ONLY_TOOLS) expect(dryToolResult(t, {})).toBeNull();
    for (const t of ['offer_choices', 'send_package_card', 'send_price_cards', 'send_photos']) expect(dryToolResult(t, {})).toBeNull();
  });

  it('EVERY tool the assistant has is either read-only or covered — a new tool cannot slip a write into a test run', () => {
    const src = readFileSync(join(__dirname, 'messenger.service.ts'), 'utf8');
    const from = src.indexOf('private async runTool(');
    const body = src.slice(from, src.indexOf('\n  private ', from + 10));
    const names = [...new Set([...body.matchAll(/if \(name === '([a-z_]+)'/g)].map((m) => m[1]))];
    expect(names.length).toBeGreaterThanOrEqual(15);
    const uncovered = names.filter((n) => !READ_ONLY_TOOLS.has(n) && !isDryCovered(n));
    expect(uncovered).toEqual([]);
    // The three that guard themselves really do: their sends are behind the dry flag.
    expect(body).toContain('if (!dry) await this.sendCards(ctx.pageToken, ctx.senderId, els);');
    expect(body).toContain('if (!dry) await this.sendCards(ctx.pageToken, ctx.senderId, cards);');
    expect(body).toContain('dry ? { ok: true } : await this.sendImage(');
    expect(body.match(/this\.sendCards\(/g)).toHaveLength(2);
    expect(body.match(/this\.sendImage\(/g)).toHaveLength(1);
  });
});

describe('a dry run of the live assistant', () => {
  function build(o: { botMode?: string; instructions?: Row[] } = {}) {
    const asked: string[] = [];
    const seen = (where: Row | undefined) => { if (where?.tenantId) asked.push(String(where.tenantId)); if (where?.id) asked.push(String(where.id)); };
    const prisma = {
      messengerConnection: { findUnique: async (q: Row) => { seen(q.where); return { tenantId: q.where.tenantId, botMode: o.botMode ?? 'booking', aiInstruction: null, botFacts: [] }; } },
      tenant: { findUnique: async (q: Row) => { seen(q.where); return { name: 'Lumio Salon', timezone: 'America/Chicago', contactPhone: null, contactEmail: null, businessType: 'SALON', market: 'US' }; } },
      setting: { findFirst: async (q: Row) => { seen(q.where); return null; }, findUnique: async () => null },
      service: { findMany: async (q: Row) => { seen(q.where); return []; } },
    };
    const boom = (what: string) => () => { throw new Error(`a dry run must never ${what}`); };
    const bookings = { create: boom('create a booking'), createForCustomer: boom('create a booking'), cancel: boom('cancel'), reschedule: boom('reschedule') };
    const noteUse = jest.fn();
    const instructions = {
      forTurn: async (tenantId: string) => { asked.push(tenantId); return { all: o.instructions ?? [], block: '', matches: [], matched: '' }; },
      check: async () => ({ broken: [], applied: [], rewrite: '' }),
      allFor: async (tenantId: string) => { asked.push(tenantId); return o.instructions ?? []; },
      noteUse,
    };
    const push = { sendToTenant: boom('push to the staff') };
    const events = { publish: boom('publish to the inbox') };
    const s = new MessengerService(prisma as never, bookings as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, events as never, push as never,
      undefined, undefined, undefined, undefined, undefined, instructions as never);
    const svc = s as unknown as Row;
    svc.systemKnowledge = async () => '';
    svc.saveLead = boom('save a lead');
    svc.sendCards = boom('send cards');
    svc.sendImage = boom('send a picture');
    svc.sendText = boom('send a message');
    svc.appendTurns = boom('write to a conversation');
    return { s, asked, noteUse };
  }
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  const env = { ...process.env };
  beforeEach(() => {
    mocked.mockReset(); process.env.ANTHROPIC_API_KEY = 'test-placeholder'; delete process.env.ANTHROPIC_HARD_MODEL;
    fetchMock = jest.fn(async () => { throw new Error('a dry run must never call out'); });
    global.fetch = fetchMock as never;
  });
  afterEach(() => { global.fetch = realFetch; });
  afterAll(() => { process.env = env; });

  it('the customer says yes to the recap: the AI "books" — and nothing is booked, sent, saved or counted', async () => {
    mocked.mockResolvedValueOnce(tool('create_booking', { phone: '512-000-0000', localDateTime: '2026-11-20T15:00' })).mockResolvedValue(text('You are all set for Friday at 3:00 PM, Anna!'));
    const { s, noteUse } = build();
    const r = await s.dryRun('demo-salon', [
      { role: 'user', content: 'gel manicure friday 3pm, Anna 512-000-0000' },
      { role: 'assistant', content: 'Friday 3:00 PM, gel manicure for Anna, 512-000-0000 — shall I book it?' },
      { role: 'user', content: 'yes' },
    ]);
    expect(r.state).toBe('reply');
    expect(r.reply).toContain('all set');
    expect(r.tools).toEqual(['create_booking']);
    expect(r.steps.n).toBe(2);                       // two model calls …
    expect(typeof r.ms).toBe('number');
    expect(fetchMock).not.toHaveBeenCalled();        // … and not one call to Meta or anywhere else
    expect(noteUse).not.toHaveBeenCalled();          // the salon's "instruction used" counters are left alone
    // What the model was told the tool did, so its next line is the one a customer would read.
    const toolResult = JSON.stringify(mocked.mock.calls[1][0].messages.slice(-1)[0].content);
    expect(toolResult).toContain('SUCCESS. Appointment created');
  });

  it('a sales page sending a package card: the card is checked, and never sent', async () => {
    mocked.mockResolvedValueOnce(tool('send_package_card', { packages: [{ name: 'Gói Marketing', price: '4.500.000đ/tháng', points: ['Quản lý fanpage'] }] })).mockResolvedValue(text('Dạ em gửi anh/chị gói phù hợp ạ. Tiệm anh/chị ở khu nào ạ?'));
    const { s } = build({ botMode: 'sales' });
    const r = await s.dryRun('lumio-agency', [{ role: 'user', content: 'giá gói marketing' }]);
    expect(r.tools).toEqual(['send_package_card']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(['reply', 'held', 'silent']).toContain(r.state);
  });

  it('every read is for THIS salon only', async () => {
    mocked.mockResolvedValue(text('We open at 9:00 AM.'));
    const { s, asked } = build();
    await s.dryRun('demo-salon', [{ role: 'user', content: 'what time do you open?' }]);
    expect(asked.length).toBeGreaterThan(2);
    expect(new Set(asked)).toEqual(new Set(['demo-salon']));
  });

  it('the AI choosing silence, and a failing model, are reported as what they are — never as a reply', async () => {
    mocked.mockResolvedValue(text('[NO_REPLY]'));
    const quiet = await build().s.dryRun('demo-salon', [{ role: 'user', content: 'ok thanks bye' }]);
    expect(quiet).toMatchObject({ state: 'silent', reply: '' });
    mocked.mockReset();
    mocked.mockResolvedValue({ ok: false, status: 404, body: 'model: nope', kind: 'other', provider: 'anthropic', fellBack: false });
    const failed = await build().s.dryRun('demo-salon', [{ role: 'user', content: 'hello' }]);
    expect(failed.state).toBe('error');
    expect(failed.reply).toBe('');
    expect(failed.error).toContain('anthropic 404');
  });

  it('needs a customer message to answer', async () => {
    const { s } = build();
    expect((await s.dryRun('demo-salon', [])).state).toBe('error');
    expect((await s.dryRun('demo-salon', [{ role: 'assistant', content: 'Hello!' }])).state).toBe('error');
    expect(mocked).not.toHaveBeenCalled();
  });
});
