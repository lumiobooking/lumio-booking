/**
 * WHERE ONE AI REPLY'S WORKING TIME WENT.
 *
 * Since 17/11/2026 each reply records how long the customer waited before the
 * AI started (w), how long the AI worked (t) and how long the channel took
 * (s). "The AI worked for 3.5 seconds" does not say what to make faster: that
 * time is reading the conversation and the salon's knowledge, one or more
 * calls to the model, the check against the owner's instructions, and — when
 * a draft is blocked — a second writing and a second check.
 *
 * So the working time is split, per reply:
 *   p  preparing — everything before the first call to the model;
 *   m  the model writing (all its calls added up);
 *   j  checking the draft (the owner's instructions, the second reader);
 *   k  tools (looking in the book, booking, sending a card);
 *   n  how many times the model was called;
 *   r  how many drafts were sent back to be written again.
 *
 * Numbers only, for the platform's speed report — never shown to a customer
 * and never used to decide anything about a reply.
 */

export type StepKind = 'model' | 'check' | 'tools';
export interface StepTimes { p: number; m: number; j: number; k: number; n: number; r: number }

const cap = (n: number) => Math.max(0, Math.min(600_000, Math.round(n)));

export class TurnClock {
  private readonly startedAt: number;
  private firstModelAt: number | null = null;
  private readonly spent: Record<StepKind, number> = { model: 0, check: 0, tools: 0 };
  private calls = 0;
  private drafts = 0;

  constructor(private readonly now: () => number = Date.now) { this.startedAt = now(); }

  /** Run one step and add its time to its kind. The step's own result or error passes through untouched. */
  async time<T>(kind: StepKind, fn: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    if (kind === 'model') { this.calls += 1; if (this.firstModelAt === null) this.firstModelAt = t0; }
    try { return await fn(); } finally { this.spent[kind] += Math.max(0, this.now() - t0); }
  }

  /** The model answered with words (not a tool call): one draft. Every draft after the first is a rewrite. */
  draft(): void { this.drafts += 1; }

  steps(): StepTimes {
    return {
      p: cap((this.firstModelAt ?? this.now()) - this.startedAt),
      m: cap(this.spent.model), j: cap(this.spent.check), k: cap(this.spent.tools),
      n: this.calls, r: Math.max(0, this.drafts - 1),
    };
  }
}

/** Stored step times, read defensively (older replies carry none). */
export function stepsOf(ms: unknown): StepTimes | null {
  const o = (ms && typeof ms === 'object' ? ms : null) as Record<string, unknown> | null;
  if (!o) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const p = num(o.p); const m = num(o.m); const j = num(o.j); const k = num(o.k); const n = num(o.n); const r = num(o.r);
  if (p === null || m === null || j === null || k === null || n === null || r === null) return null;
  return { p, m, j, k, n, r };
}
