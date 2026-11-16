/**
 * "No thinking" is said the way each model asks for it — learned from the
 * API's own 400, never guessed (Lumio Agency, 16/11/2026: the stronger model
 * refused `thinking: disabled` and four customers got the "system is slow" line).
 */
import { forModel, forgetThinkingOff, learnThinkingOff, thinkingOffFor } from './ai-model';
import { chat } from './llm';

const BODY = '{"type":"error","error":{"type":"invalid_request_error","message":"To turn thinking off on this model, send \\"thinking\\": {\\"type\\": \\"between_tools\\"} instead of \\"disabled\\"."},"request_id":"req_1"}';

describe('how a model wants "no thinking" said', () => {
  beforeEach(() => forgetThinkingOff());

  it('defaults to disabled, for every 5-generation model', () => {
    expect((forModel({ model: 'claude-haiku-5-5', messages: [] }) as { thinking?: { type: string } }).thinking).toEqual({ type: 'disabled' });
    expect(thinkingOffFor('claude-sonnet-5-5')).toBe('disabled');
  });

  it('learns the value the API names, for that model only', () => {
    expect(learnThinkingOff('claude-sonnet-5-5', 400, BODY)).toBe('between_tools');
    expect((forModel({ model: 'claude-sonnet-5-5', messages: [] }) as { thinking?: { type: string } }).thinking).toEqual({ type: 'between_tools' });
    expect((forModel({ model: 'claude-haiku-5-5', messages: [] }) as { thinking?: { type: string } }).thinking).toEqual({ type: 'disabled' });
    // already known → nothing new to learn, so no endless retry
    expect(learnThinkingOff('claude-sonnet-5-5', 400, BODY)).toBeNull();
  });

  it('learns nothing from other errors or from text that is not the API\'s sentence', () => {
    expect(learnThinkingOff('claude-sonnet-5-5', 529, BODY)).toBeNull();
    expect(learnThinkingOff('claude-sonnet-5-5', 400, '{"error":{"message":"prompt is too long"}}')).toBeNull();
    expect(learnThinkingOff('claude-sonnet-5-5', 400, 'send "thinking": {"type": "DROP TABLE"} instead')).toBeNull();
    expect(thinkingOffFor('claude-sonnet-5-5')).toBe('disabled');
  });

  it('the call is asked again once, the right way, and succeeds', async () => {
    const prev = { key: process.env.ANTHROPIC_API_KEY, f: global.fetch };
    process.env.ANTHROPIC_API_KEY = 'test-placeholder';
    const sent: string[] = [];
    global.fetch = (async (_url: string, init: { body: string }) => {
      const b = JSON.parse(init.body) as { thinking?: { type: string } };
      sent.push(b.thinking?.type ?? '');
      if (b.thinking?.type === 'disabled') return { ok: false, status: 400, text: async () => BODY };
      return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Dạ gói Social Care…' }], model: 'claude-sonnet-5-5', usage: {} }) };
    }) as never;
    try {
      const out = await chat({ system: 'x', messages: [{ role: 'user', content: 'giá gói marketing' }], max_tokens: 50, model: 'claude-sonnet-5-5' });
      expect(out.ok).toBe(true);
      expect(sent).toEqual(['disabled', 'between_tools']);
      // the next call does not pay for the lesson again
      await chat({ system: 'x', messages: [{ role: 'user', content: 'hi' }], max_tokens: 50, model: 'claude-sonnet-5-5' });
      expect(sent).toEqual(['disabled', 'between_tools', 'between_tools']);
    } finally {
      global.fetch = prev.f;
      if (prev.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = prev.key;
    }
  });
});
