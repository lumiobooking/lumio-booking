/**
 * "Gói Growth Map $279/tháng (tính AUD)" reached a lead who had not named
 * their shop. Under the default 'sales' quote policy the sales bot never
 * states a price: the price tools are gone from its hands, the prompt says a
 * person quotes, and a price that slips through is caught — once for a
 * rewrite, twice for our own line asking for the shop and the phone.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
jest.mock('../common/llm', () => ({ ...jest.requireActual('../common/llm'), chat: jest.fn() }));
import { chat } from '../common/llm';
import { MessengerService } from './messenger.service';
import { noQuoteLine, statesPrice } from './quote-guards';

describe('statesPrice — a price in any of the ways the bot writes one', () => {
  it.each([
    'Gói Growth Map $279/tháng (tính AUD) sẽ tối ưu Maps.',
    'Phần mềm từ US$49/month ạ.',
    'Gói cơ bản 2.500.000đ một tháng.',
    'Chỉ 500k/tháng thôi ạ.',
    'Khoảng 3 triệu ạ.',
    'The Starter plan is 49 USD monthly.',
    'Price is 1,200 for the website.',
    'A$ 279 per month.',
  ])('catches: %s', (s) => expect(statesPrice(s)).toBe(true));
  it.each([
    'Dạ giá bên em tuỳ theo tiệm và khu vực nên team sẽ gửi báo giá chính xác cho anh/chị ạ.',
    'Anh/chị cho em xin tên tiệm và số điện thoại nhé?',
    'Bên em nhận 1 tiệm trong bán kính 10 dặm thôi ạ.',
    'The audit takes 24–48 hours and is free.',
    'Tiệm mở cửa 9h sáng ạ.',
    '',
  ])('lets through: %s', (s) => expect(statesPrice(s)).toBe(false));
  it('the fallback line asks for what is still missing', () => {
    expect(noQuoteLine('vi', false)).toMatch(/tên tiệm/);
    expect(noQuoteLine('vi', true)).not.toMatch(/tên tiệm/);
    expect(noQuoteLine('en', false)).toMatch(/shop name/);
  });
});

describe('inside the sales agent', () => {
  const mocked = chat as unknown as jest.Mock;
  const reply = (text: string) => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: {} } });
  let prevKey: string | undefined;
  beforeAll(() => { prevKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-placeholder'; });
  afterAll(() => { if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prevKey; });
  beforeEach(() => mocked.mockReset());

  function svc() {
    const prisma = {
      tenant: { findUnique: async () => ({ name: 'Lumio', timezone: 'Asia/Ho_Chi_Minh', contactPhone: null, contactEmail: null, businessType: 'agency', market: 'VN' }) },
      setting: { findFirst: async () => null },
    };
    const s = new MessengerService(prisma as never, {} as never, { getAiNotes: async () => ({ text: '' }) } as never, {} as never, {} as never, {} as never);
    (s as unknown as { systemKnowledge: unknown }).systemKnowledge = async () => '';
    return s as unknown as { runAgent: (...a: unknown[]) => Promise<string> };
  }
  const hist = [
    { role: 'user', content: 'Tiệm đang có lượng khách ổn định nhưng muốn tăng doanh thu' },
  ];
  const text = 'Tiệm đang có lượng khách ổn định nhưng muốn tăng doanh thu';
  const call = (i: number) => mocked.mock.calls[i][0] as { system: { text: string }[]; tools: { name: string }[]; messages: { content: unknown }[] };

  it('default policy: no price tools, the no-quote rule in the prompt, a priced reply is rewritten', async () => {
    mocked
      .mockResolvedValueOnce(reply('Dạ hiểu ạ. Gói Growth Map $279/tháng (tính AUD) sẽ tối ưu Maps để khách gọi thẳng từ đó.'))
      .mockResolvedValueOnce(reply('Dạ hiểu ạ — giữ khách quay lại đều là cách nhanh nhất. Anh/chị cho em xin tên tiệm và số điện thoại để team gửi báo giá phù hợp nhé?'));
    const out = await svc().runAgent('t1', 'Gói Growth Map: $195/tháng', hist, text, { mode: 'sales', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/tên tiệm/);
    expect(out).not.toMatch(/\$/);
    const first = call(0);
    expect(first.tools.map((t) => t.name)).toEqual(expect.not.arrayContaining(['quote_price', 'get_software_plans', 'send_price_cards']));
    const system = first.system.map((b) => b.text).join('\n');
    expect(system).toContain('PRICES — YOU NEVER STATE ONE');
    expect(system).not.toContain('call send_price_cards IMMEDIATELY');
    expect(system).not.toContain('call quote_price');
    expect(JSON.stringify(call(1).messages[call(1).messages.length - 1].content)).toContain('because it names a price');
  });

  it('a price twice becomes our own line — the shop and the phone, never the number', async () => {
    mocked
      .mockResolvedValueOnce(reply('Gói Growth Map $279/tháng ạ.'))
      .mockResolvedValueOnce(reply('Dạ chỉ 195 USD/tháng thôi ạ.'));
    const out = await svc().runAgent('t1', '', hist, text, { mode: 'sales', leadEmail: null, channel: 'messenger' });
    expect(out).toBe(noQuoteLine('vi', false));
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("the 'facts' policy keeps the price tools and lets a quoted price through", async () => {
    mocked.mockResolvedValueOnce(reply('Dạ gói Growth Map là $195/tháng ạ. Anh/chị cho em xin tên tiệm nhé?'));
    const out = await svc().runAgent('t1', 'Gói Growth Map: $195/tháng', hist, text, { mode: 'sales', quotePolicy: 'facts', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/\$195/);
    expect(call(0).tools.map((t) => t.name)).toEqual(expect.arrayContaining(['quote_price', 'send_price_cards']));
    expect(call(0).system.map((b) => b.text).join('\n')).toContain('call quote_price');
  });

  it('the booking bot still quotes its menu prices', async () => {
    mocked.mockResolvedValueOnce(reply('Gel manicure is $35 💅 What day would you like to come in?'));
    const out = await svc().runAgent('t1', '', [{ role: 'user', content: 'how much is a gel manicure?' }], 'how much is a gel manicure?', { mode: 'booking', leadEmail: null, channel: 'messenger' });
    expect(out).toMatch(/\$35/);
  });
});
