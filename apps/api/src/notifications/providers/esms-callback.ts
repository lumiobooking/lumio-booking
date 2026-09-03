/**
 * Reading what an eSMS delivery callback actually says.
 *
 * At send time eSMS answers CodeResult 100, which their docs are emphatic
 * means only "the request reached eSMS" — NOT that the customer received
 * anything. The truth arrives later: eSMS calls the CallbackUrl with an HTTPS
 * GET whose query string carries SendStatus plus SendSuccess/SendFailed
 * counters (retried up to 5 times on timeout, then never again — which is why
 * the endpoint that uses this must always answer 200).
 *
 * Kept pure — no database, no Nest — so the interpretation is pinned by tests
 * and cannot drift from what the controller does with it.
 */

export type EsmsOutcome = 'delivered' | 'failed' | 'pending';

export interface EsmsCallbackReading {
  /** eSMS's message id — matches the SMSID returned at send time. */
  smsId: string;
  /** Our RequestId, echoed back — we pass the notification row's own id. */
  requestId: string;
  outcome: EsmsOutcome;
  /** Operator-readable reason, present only when outcome is 'failed'. */
  reason?: string;
}

const TELCO: Record<string, string> = {
  '1': 'Viettel', '2': 'Mobifone', '3': 'Vinaphone', '4': 'Vietnamobile',
  '5': 'Gtel', '6': 'Itel', '7': 'Reddi',
};

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function num(v: unknown): number {
  const n = Number(str(v));
  return Number.isFinite(n) ? n : 0;
}

/** Case-tolerant field read: eSMS documents PascalCase but their examples mix
 *  lowercase (telcoid, phonenumber), so trusting exact casing is optimism. */
function pick(q: Record<string, unknown>, ...names: string[]): unknown {
  const lower = new Map(Object.keys(q ?? {}).map((k) => [k.toLowerCase(), q[k]]));
  for (const n of names) {
    const v = lower.get(n.toLowerCase());
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

export function readEsmsCallback(q: Record<string, unknown>): EsmsCallbackReading {
  const smsId = str(pick(q, 'SMSID', 'SmsId'));
  const requestId = str(pick(q, 'RequestId'));
  const status = str(pick(q, 'SendStatus'));
  const ok = num(pick(q, 'SendSuccess'));
  const failed = num(pick(q, 'SendFailed'));
  const telco = TELCO[str(pick(q, 'telcoid', 'TelcoId'))] ?? '';

  // SendStatus 4 = rejected in review. This message is never going anywhere.
  if (status === '4') {
    return { smsId, requestId, outcome: 'failed', reason: 'eSMS/nhà mạng từ chối duyệt tin (SendStatus 4)' };
  }

  // A CSKH send is one recipient, so the counters are 0 or 1 and "any success"
  // is the whole answer. Success wins over a nonzero failure counter because a
  // delivered message that also logged a retry is still a delivered message.
  if (ok > 0) return { smsId, requestId, outcome: 'delivered' };
  if (failed > 0) {
    return {
      smsId, requestId, outcome: 'failed',
      reason: `Không giao được tới máy khách${telco ? ` (${telco})` : ''} — callback eSMS`,
    };
  }

  // 1 (pending approval), 2 (queued), 7 (sent, awaiting carrier report), or a
  // 5 whose counters haven't settled: still moving. Say nothing yet.
  return { smsId, requestId, outcome: 'pending' };
}
