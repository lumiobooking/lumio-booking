import { toOpenAIMessages, toOpenAITools, fromOpenAI, worthFallingBack, chat, type ChatRequest, type ChatResult } from './llm';

const req: ChatRequest = {
  system: [{ type: 'text', text: 'You are the booking assistant.', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'It is Monday.' }],
  messages: [{ role: 'user', content: 'hi' }],
  tools: [{ name: 'get_services', description: 'List services', input_schema: { type: 'object', properties: {}, required: [] } }],
  max_tokens: 500,
};

describe('translating the conversation to OpenAI', () => {
  it('turns the system blocks into one system message', () => {
    const out = toOpenAIMessages(req.system, req.messages);
    expect(out[0]).toEqual({ role: 'system', content: 'You are the booking assistant.\nIt is Monday.' });
    expect(out[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('carries a tool round-trip: assistant call → tool result → next turn', () => {
    // The shape the messenger loop builds after an Anthropic tool_use turn.
    const out = toOpenAIMessages('sys', [
      { role: 'user', content: 'what services?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_services', input: { q: 'gel' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Gel manicure $35' }] },
    ]);
    expect(out[2]).toEqual({
      role: 'assistant', content: 'Let me check.',
      tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'get_services', arguments: '{"q":"gel"}' } }],
    });
    // The tool result is its OWN message, right after the call — OpenAI's rule.
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: 'Gel manicure $35' });
    expect(out).toHaveLength(4);
  });

  it('sends a customer photo as a data URL', () => {
    const out = toOpenAIMessages('sys', [
      { role: 'user', content: [{ type: 'text', text: 'like this?' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } }] },
    ]);
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'like this?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }],
    });
  });

  it('flattens a lone text block to a plain string', () => {
    const out = toOpenAIMessages('sys', [{ role: 'user', content: [{ type: 'text', text: 'only text' }] }]);
    expect(out[1]).toEqual({ role: 'user', content: 'only text' });
  });

  it('maps input_schema to parameters', () => {
    expect(toOpenAITools(req.tools)).toEqual([
      { type: 'function', function: { name: 'get_services', description: 'List services', parameters: { type: 'object', properties: {}, required: [] } } },
    ]);
    expect(toOpenAITools([])).toBeUndefined();
  });
});

describe('translating the reply back', () => {
  it('reads a plain answer as end_turn with one text block', () => {
    expect(fromOpenAI({ finish_reason: 'stop', message: { content: 'Dạ được ạ' } }))
      .toEqual({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Dạ được ạ' }] });
  });

  it('reads tool calls as tool_use blocks with PARSED input — the loop runs them unchanged', () => {
    const r = fromOpenAI({
      finish_reason: 'tool_calls',
      message: { content: null, tool_calls: [{ id: 'call_9', function: { name: 'create_booking', arguments: '{"name":"Anna","services":[{"id":"s1"}]}' } }] },
    });
    expect(r.stop_reason).toBe('tool_use');
    expect(r.content).toEqual([{ type: 'tool_use', id: 'call_9', name: 'create_booking', input: { name: 'Anna', services: [{ id: 's1' }] } }]);
  });

  it('survives malformed tool arguments rather than crashing the reply', () => {
    const r = fromOpenAI({ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{oops' } }] } });
    expect(r.content[0]).toEqual({ type: 'tool_use', id: 'c', name: 'x', input: {} });
  });

  it('reports a truncated answer as max_tokens', () => {
    expect(fromOpenAI({ finish_reason: 'length', message: { content: 'long…' } }).stop_reason).toBe('max_tokens');
  });
});

describe('when the second door opens', () => {
  const ok = (provider: 'anthropic' | 'openai'): ChatResult => ({ ok: true, reply: { stop_reason: 'end_turn', content: [{ type: 'text', text: provider }], provider } });
  const fail = (kind: Parameters<typeof worthFallingBack>[0], provider: 'anthropic' | 'openai' = 'anthropic'): ChatResult =>
    ({ ok: false, status: 400, body: kind, kind, provider, fellBack: provider === 'openai' });

  beforeEach(() => { process.env.OPENAI_API_KEY = 'test'; });
  afterEach(() => { delete process.env.OPENAI_API_KEY; });

  it('falls back on the outage that happened: out of credit', async () => {
    const r = await chat(req, { anthropic: async () => fail('credit'), openai: async () => ok('openai') });
    expect(r.ok && r.reply.provider).toBe('openai');
  });

  it('falls back on a revoked or missing key, a rate limit, an outage', () => {
    for (const k of ['auth', 'no-key', 'rate-limit', 'server', 'timeout', 'network', 'model'] as const) expect(worthFallingBack(k)).toBe(true);
  });

  it('does NOT fall back on a request we built wrong — OpenAI would refuse the same thing', async () => {
    expect(worthFallingBack('other')).toBe(false);
    let called = false;
    const r = await chat(req, { anthropic: async () => fail('other'), openai: async () => { called = true; return ok('openai'); } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('does nothing different with no OpenAI key — opt-in, decided on Render', async () => {
    delete process.env.OPENAI_API_KEY;
    let called = false;
    const r = await chat(req, { anthropic: async () => fail('credit'), openai: async () => { called = true; return ok('openai'); } });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('never touches OpenAI when Anthropic answered', async () => {
    let called = false;
    const r = await chat(req, { anthropic: async () => ok('anthropic'), openai: async () => { called = true; return ok('openai'); } });
    expect(r.ok && r.reply.provider).toBe('anthropic');
    expect(called).toBe(false);
  });

  it('reports ANTHROPIC\'s failure when both fail, marked as having tried the second door', async () => {
    const r = await chat(req, { anthropic: async () => fail('credit'), openai: async () => fail('rate-limit', 'openai') });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('credit');
      expect(r.provider).toBe('anthropic');
      expect(r.fellBack).toBe(true);
    }
  });
});
