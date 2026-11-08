import { agentModel, reviewModel, forModel, isGen5, DEFAULT_AI_MODEL } from './ai-model';
import { priceOf } from './ai-usage';

describe('the AI runs on Haiku 5.5, safely', () => {
  const saved = { a: process.env.ANTHROPIC_AGENT_MODEL, r: process.env.ANTHROPIC_MODEL };
  afterEach(() => { process.env.ANTHROPIC_AGENT_MODEL = saved.a; process.env.ANTHROPIC_MODEL = saved.r; });

  it('defaults to Haiku 5.5; the server variable still overrides (rollback)', () => {
    delete process.env.ANTHROPIC_AGENT_MODEL; delete process.env.ANTHROPIC_MODEL;
    expect(DEFAULT_AI_MODEL).toBe('claude-haiku-5-5');
    expect(agentModel()).toBe('claude-haiku-5-5');
    expect(reviewModel()).toBe('claude-haiku-5-5');
    process.env.ANTHROPIC_AGENT_MODEL = 'claude-haiku-4-5-20251001';
    expect(agentModel()).toBe('claude-haiku-4-5-20251001');
  });

  it('5.x: fast answers (low effort, no thinking), no prefill, no sampling knobs', () => {
    const b: Record<string, unknown> = forModel({ model: 'claude-haiku-5-5', max_tokens: 300, temperature: 0.2, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Sure' }] });
    expect(b.thinking).toEqual({ type: 'disabled' });
    expect(b.output_config).toEqual({ effort: 'low' });
    expect('temperature' in b).toBe(false);
    expect(b.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(b.max_tokens).toBe(300);
  });

  it('a tool loop ending on the tool result is left alone', () => {
    const msgs = [{ role: 'user', content: 'book' }, { role: 'assistant', content: [{ type: 'tool_use' }] }, { role: 'user', content: [{ type: 'tool_result' }] }];
    expect(forModel({ model: 'claude-haiku-5-5', max_tokens: 700, messages: msgs }).messages).toEqual(msgs);
  });

  it('Haiku 4.5 (rollback) gets the body unchanged — it refuses the effort setting', () => {
    const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: 'hi' }] };
    expect(forModel(body)).toBe(body);
    expect(isGen5('claude-haiku-4-5')).toBe(false);
    expect(isGen5('claude-sonnet-5-5')).toBe(true);
  });

  it('usage reports price Haiku 5.5 at its own rate, not the fallback', () => {
    expect(priceOf('claude-haiku-5-5')).toEqual({ price: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 }, known: true });
    expect(priceOf('claude-haiku-4-5-20251001').price.input).toBe(1);
  });
});
