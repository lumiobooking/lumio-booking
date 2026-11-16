/**
 * Which Claude model the platform's AI runs on — the hotline (Call AI), the
 * chat assistant (Messenger / Instagram / SMS / web chat), review replies and
 * content tools all read it from here.
 *
 * 8 Nov 2026: moved from Haiku 4.5 to Haiku 5.5. ANTHROPIC_AGENT_MODEL on the
 * server still overrides it (set it back to claude-haiku-4-5-20251001 to roll
 * back without a deploy).
 *
 * Haiku 5.5 differs from 4.5 in ways that would break us silently:
 *  - it THINKS by default (effort "medium"): ~2–3 s of silence before the
 *    first word on a phone call, and thinking tokens eat max_tokens — a short
 *    reply could come back empty. We ask for effort "low" with thinking off,
 *    which answers as fast as 4.5 and keeps max_tokens meaning "reply length".
 *  - a request ending on an assistant message (prefill) is refused (400).
 *  - temperature / top_p / top_k are refused (we send none).
 * Haiku 4.5 rejects the effort setting, so it is only sent to 5.x models.
 */

export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';

/** The model for the assistants and tools (env override first). */
export function agentModel(): string {
  return (process.env.ANTHROPIC_AGENT_MODEL || '').trim() || DEFAULT_AI_MODEL;
}

/** Google review replies have their own override (ANTHROPIC_MODEL). */
export function reviewModel(): string {
  return (process.env.ANTHROPIC_MODEL || '').trim() || agentModel();
}

/** A Claude 5-generation model (effort + adaptive thinking, no prefill). */
export function isGen5(model: string): boolean {
  return /^claude-(haiku|sonnet|opus|fable|mythos)-5/i.test(String(model || '').trim());
}

type Msg = { role?: string; content?: unknown };

/**
 * HOW EACH MODEL WANTS "NO THINKING" SAID — learned from the API itself.
 *
 * Every 5-generation request here sends `thinking: { type: 'disabled' }`. The
 * everyday model accepts that. A stronger model (ANTHROPIC_HARD_MODEL) answered
 * 400: «To turn thinking off on this model, send "thinking": {"type":
 * "between_tools"} instead» — and every turn routed to it became the "system
 * is slow" line (Lumio Agency, 16/11/2026: four customers).
 *
 * The API names the value it wants, so it is taken from the API's own words,
 * remembered per model for the life of the process, and never guessed.
 */
const THINKING_OFF = new Map<string, string>();
const THINKING_TYPE = /^[a-z][a-z_]{2,30}$/;

/** The `thinking.type` that means "off" for this model ('disabled' unless the API said otherwise). */
export function thinkingOffFor(model: string): string {
  return THINKING_OFF.get(String(model || '').trim().toLowerCase()) ?? 'disabled';
}

/**
 * Read a 400 body. When it names the thinking type to send instead, remember
 * it for this model and return it (the caller retries once); otherwise null.
 */
export function learnThinkingOff(model: string, status: number | null, body: string): string | null {
  if (status !== 400) return null;
  const m = /thinking\\?"\s*:\s*\{\s*\\?"type\\?"\s*:\s*\\?"([a-z_]+)\\?"\s*\}\s*instead/i.exec(String(body ?? ''));
  const type = m?.[1]?.toLowerCase() ?? '';
  const key = String(model || '').trim().toLowerCase();
  if (!type || !key || !THINKING_TYPE.test(type) || type === thinkingOffFor(key)) return null;
  THINKING_OFF.set(key, type);
  return type;
}

/** Tests only. */
export function forgetThinkingOff(): void { THINKING_OFF.clear(); }

/**
 * The Messages API body, adjusted for the model it is sent to. Use it on
 * EVERY request: `JSON.stringify(forModel({ model, max_tokens, ... }))`.
 */
export function forModel<T extends { model: string; messages?: Msg[] } & Record<string, unknown>>(body: T): T {
  if (!isGen5(body.model)) return body;
  const out: Record<string, unknown> = {
    ...body,
    thinking: { type: thinkingOffFor(body.model) },
    output_config: { ...((body.output_config as Record<string, unknown>) || {}), effort: 'low' },
  };
  delete out.temperature; delete out.top_p; delete out.top_k;
  // No prefill on 5.x: a trailing assistant turn would be a 400.
  if (Array.isArray(body.messages)) {
    const msgs = [...body.messages];
    while (msgs.length > 1 && msgs[msgs.length - 1]?.role === 'assistant') msgs.pop();
    out.messages = msgs;
  }
  return out as T;
}
