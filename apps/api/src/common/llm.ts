/**
 * ONE DOOR TO THE MODEL, WITH A SECOND PROVIDER BEHIND IT.
 *
 * WHY
 *
 * Every conversation on the platform ran through a single Anthropic account,
 * and when that account ran out of credit every bot on every channel went
 * quiet for hours. The fix for the money is auto-reload; the fix for the
 * dependency is this file. When the first provider refuses for a reason that
 * a second provider would not share — no credit, a revoked key, an outage,
 * a rate limit — the same request goes to OpenAI instead, and the customer
 * gets an answer rather than a holding line.
 *
 * WHAT IT IS NOT
 *
 * Not an abstraction over "AI". The callers speak Anthropic's message shape
 * (system, messages with content blocks, tools with input_schema, tool_use
 * and tool_result blocks) and keep speaking it. This file translates that
 * shape to OpenAI's chat-completions shape on the way out and translates the
 * reply back, so the callers' loops, gates and tool runners do not change.
 * Translation is pure and tested on its own; the network is one function.
 *
 * OPT-IN
 *
 * With no OPENAI_API_KEY set, nothing here behaves differently from a plain
 * fetch to Anthropic. The second provider exists only once somebody puts a
 * key on the instance — and that decision, like every key, is made on Render,
 * never in code.
 */

import { classifyAiFailure, type AiFailureKind } from '../messenger/ai-health';

// ---- the shape the callers already use (Anthropic's) ----------------------

export interface TextBlock { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
export interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string | { type: 'text'; text: string }[]; is_error?: boolean }
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

export interface ChatMessage { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export interface ToolDef { name: string; description?: string; input_schema: Record<string, unknown> }

export interface ChatRequest {
  /** A string, or blocks (the cacheable form). Either works on both providers. */
  system: string | TextBlock[];
  messages: ChatMessage[];
  tools?: ToolDef[];
  max_tokens: number;
  /** Anthropic model. The OpenAI side has its own env-configured model. */
  model?: string;
  timeoutMs?: number;
}

/** What the provider says the call consumed. Absent when it did not say. */
export interface ChatUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** The model that actually answered, as the provider named it. */
  model: string;
}

export interface ChatReply {
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  content: (TextBlock | ToolUseBlock)[];
  provider: 'anthropic' | 'openai';
  /**
   * The token counts, passed through so the caller can bill them to a salon
   * and a feature (see common/ai-usage). Reading them here rather than
   * guessing from string lengths is the difference between a report and a
   * rumour.
   */
  usage?: ChatUsage;
  /**
   * Present when OpenAI answered because Anthropic could not. The customer
   * was served, but the account that failed still needs fixing — the caller
   * counts this as an Anthropic failure so the alarm keeps ringing.
   */
  firstFailure?: { kind: AiFailureKind; status: number | null; body: string };
}

export type ChatResult =
  | { ok: true; reply: ChatReply }
  | { ok: false; status: number | null; body: string; kind: AiFailureKind; provider: 'anthropic' | 'openai'; fellBack: boolean };

// ---- which failures are worth a second opinion ------------------------------

/**
 * A failure that says something about the ACCOUNT or the SERVICE, not about
 * the request. Those are the ones another provider would not repeat. A 400
 * that is not "out of credit" means we built a bad request, and sending the
 * same bad request somewhere else only spends more money on the same answer.
 */
export function worthFallingBack(kind: AiFailureKind): boolean {
  return kind === 'credit' || kind === 'auth' || kind === 'no-key' || kind === 'rate-limit'
    || kind === 'server' || kind === 'timeout' || kind === 'network' || kind === 'model';
}

export function openAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ---- translation, Anthropic → OpenAI -----------------------------------------

type OaiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type OaiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OaiPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const systemText = (s: string | TextBlock[]): string => (typeof s === 'string' ? s : s.map((b) => b.text).join('\n'));

const resultText = (c: ToolResultBlock['content']): string =>
  typeof c === 'string' ? c : c.map((b) => b.text).join('\n');

/**
 * OpenAI's rules that differ from Anthropic's, each handled here:
 *  - the system prompt is a message, not a field;
 *  - a tool result is its own message with role "tool", not a block inside a
 *    user turn — and it must directly follow the assistant turn that called;
 *  - a tool call's input travels as a JSON STRING;
 *  - images are data: URLs inside a user turn.
 */
export function toOpenAIMessages(system: string | TextBlock[], messages: ChatMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: systemText(system) }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content } as OaiMessage);
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      const calls = m.content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => ({
        id: b.id, type: 'function' as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // user turn: tool results become their own messages, the rest one user message
    const results = m.content.filter((b): b is ToolResultBlock => b.type === 'tool_result');
    for (const r of results) out.push({ role: 'tool', tool_call_id: r.tool_use_id, content: resultText(r.content) });
    const parts: OaiPart[] = [];
    for (const b of m.content) {
      if (b.type === 'text') parts.push({ type: 'text', text: b.text });
      else if (b.type === 'image') {
        const url = b.source.type === 'url' ? b.source.url : `data:${b.source.media_type};base64,${b.source.data}`;
        parts.push({ type: 'image_url', image_url: { url } });
      }
    }
    if (parts.length) out.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts });
  }
  return out;
}

export function toOpenAITools(tools: ToolDef[] | undefined) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
  }));
}

// ---- translation, OpenAI → Anthropic ---------------------------------------

export interface OaiChoice {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] | null;
  } | null;
}

/** The reply, in the blocks the caller's loop already reads. */
export function fromOpenAI(choice: OaiChoice | undefined): Omit<ChatReply, 'provider'> {
  const msg = choice?.message ?? null;
  const content: (TextBlock | ToolUseBlock)[] = [];
  const text = (msg?.content ?? '').trim();
  if (text) content.push({ type: 'text', text });
  for (const c of msg?.tool_calls ?? []) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(c.function?.arguments || '{}') as Record<string, unknown>; } catch { input = {}; }
    content.push({ type: 'tool_use', id: c.id || `call_${content.length}`, name: c.function?.name ?? '', input });
  }
  const finish = choice?.finish_reason ?? 'stop';
  const stop_reason: ChatReply['stop_reason'] =
    finish === 'tool_calls' || (msg?.tool_calls?.length ?? 0) > 0 ? 'tool_use'
      : finish === 'length' ? 'max_tokens'
        : 'end_turn';
  return { stop_reason, content };
}

// ---- the network -------------------------------------------------------------

export const ANTHROPIC_DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
/**
 * The OpenAI model used ONLY when Anthropic could not answer. Cheapest
 * current chat model with tools and vision as of Sept 2026; override with
 * OPENAI_FALLBACK_MODEL if OpenAI renames it — a retired model id would turn
 * the fallback into a second failure.
 */
export const OPENAI_DEFAULT_MODEL = 'gpt-5.6-luna';

/** Anthropic's four counters, normalised. Missing numbers read as zero, never as NaN. */
export function anthropicUsage(
  u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined,
  model: string,
): ChatUsage {
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
  };
  return {
    input: n(u?.input_tokens),
    output: n(u?.output_tokens),
    cacheRead: n(u?.cache_read_input_tokens),
    cacheWrite: n(u?.cache_creation_input_tokens),
    model,
  };
}

async function callAnthropic(req: ChatRequest): Promise<ChatResult> {
  const key = process.env.ANTHROPIC_API_KEY || '';
  if (!key) return { ok: false, status: null, body: 'ANTHROPIC_API_KEY is not set', kind: 'no-key', provider: 'anthropic', fellBack: false };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: req.model || process.env.ANTHROPIC_AGENT_MODEL || ANTHROPIC_DEFAULT_MODEL,
        max_tokens: req.max_tokens,
        system: req.system,
        ...(req.tools?.length ? { tools: req.tools } : {}),
        messages: req.messages,
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, body, kind: classifyAiFailure(res.status, body), provider: 'anthropic', fellBack: false };
    }
    const data = await res.json() as {
      stop_reason?: ChatReply['stop_reason'];
      content?: (TextBlock | ToolUseBlock)[];
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    return {
      ok: true,
      reply: {
        stop_reason: data.stop_reason ?? 'end_turn',
        content: data.content ?? [],
        provider: 'anthropic',
        usage: anthropicUsage(data.usage, data.model || req.model || process.env.ANTHROPIC_AGENT_MODEL || ANTHROPIC_DEFAULT_MODEL),
      },
    };
  } catch (e) {
    const body = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, body, kind: classifyAiFailure(null, body), provider: 'anthropic', fellBack: false };
  }
}

async function callOpenAI(req: ChatRequest): Promise<ChatResult> {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) return { ok: false, status: null, body: 'OPENAI_API_KEY is not set', kind: 'no-key', provider: 'openai', fellBack: true };
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_FALLBACK_MODEL || OPENAI_DEFAULT_MODEL,
        max_tokens: req.max_tokens,
        messages: toOpenAIMessages(req.system, req.messages),
        ...(req.tools?.length ? { tools: toOpenAITools(req.tools) } : {}),
      }),
      signal: AbortSignal.timeout(req.timeoutMs ?? 30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, body, kind: classifyAiFailure(res.status, body), provider: 'openai', fellBack: true };
    }
    const data = await res.json() as {
      choices?: OaiChoice[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const model = data.model || process.env.OPENAI_FALLBACK_MODEL || OPENAI_DEFAULT_MODEL;
    const cached = Math.max(0, Number(data.usage?.prompt_tokens_details?.cached_tokens ?? 0));
    return {
      ok: true,
      reply: {
        ...fromOpenAI(data.choices?.[0]),
        provider: 'openai',
        usage: {
          // OpenAI counts cached tokens INSIDE prompt_tokens; Anthropic counts
          // them beside its input. Subtracted here so one number means one
          // thing on both sides of the report.
          input: Math.max(0, Number(data.usage?.prompt_tokens ?? 0) - cached),
          output: Math.max(0, Number(data.usage?.completion_tokens ?? 0)),
          cacheRead: cached,
          cacheWrite: 0,
          model,
        },
      },
    };
  } catch (e) {
    const body = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, body, kind: classifyAiFailure(null, body), provider: 'openai', fellBack: true };
  }
}

/**
 * Anthropic first; OpenAI when Anthropic fails for a reason OpenAI would not
 * share and a key for it exists. The failure reported when BOTH fail is
 * Anthropic's — that is the account to fix first — with `fellBack: true` so
 * the log says the second door was tried.
 */
export async function chat(req: ChatRequest, deps: { anthropic?: typeof callAnthropic; openai?: typeof callOpenAI } = {}): Promise<ChatResult> {
  const first = await (deps.anthropic ?? callAnthropic)(req);
  if (first.ok) return first;
  if (!openAiEnabled() || !worthFallingBack(first.kind)) return first;
  const second = await (deps.openai ?? callOpenAI)(req);
  if (second.ok) return { ok: true, reply: { ...second.reply, firstFailure: { kind: first.kind, status: first.status, body: first.body } } };
  return { ...first, fellBack: true };
}
