/**
 * THE GOLDEN RUN'S HARD FAULTS (common/ai-golden) — decided by rule, not by a
 * grader's opinion. Each is something a customer was really sent in the week
 * of 10–17/11/2026:
 *
 *   error    the AI could not answer at all;
 *   apology  "our system is a little slow right now" (the AI failed and said so);
 *   held     the reply was held back for a person (nothing compliant was left);
 *   leak     the reply talks about its instructions or a correction, not to the customer;
 *   wall     one long block of text where the approved look is two short messages.
 *
 * Pure.
 */
import type { HardFault } from '../common/ai-golden';
import { isFallbackLine } from './agent-fallback';
import { leaksCorrection } from './correction-guard';

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** More than the approved look allows by a wide margin: 130 words in all, or 75 in one paragraph that is not a list. */
export const WALL_TOTAL_WORDS = 130;
export const WALL_PARAGRAPH_WORDS = 75;

export function isWall(reply: string): boolean {
  const t = String(reply ?? '').trim();
  if (!t) return false;
  if (words(t) > WALL_TOTAL_WORDS) return true;
  return t.split(/\n\s*\n/).some((p) => !/^\s*▸/m.test(p) && words(p) > WALL_PARAGRAPH_WORDS);
}

export function hardFaults(o: { state: 'reply' | 'silent' | 'held' | 'error'; reply: string }): HardFault[] {
  const out: HardFault[] = [];
  if (o.state === 'error') out.push('error');
  if (o.state === 'held') out.push('held');
  const reply = String(o.reply ?? '');
  if (isFallbackLine(reply)) out.push('apology');
  if (leaksCorrection(reply)) out.push('leak');
  if (isWall(reply)) out.push('wall');
  return out;
}
