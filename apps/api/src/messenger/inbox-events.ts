/**
 * rt205 — one bus for "something in this salon's inbox changed".
 *
 * The inbox stream used to be nudged only where someone remembered to call
 * publish(): a staff reply, an AI answer, "Tôi nhận", a note, a read mark
 * often were not, and the screen caught up on its 30-second safety poll —
 * the delay the owner saw. Now every database write to the conversation
 * tables (see PrismaService) emits here, and InboxEventsService pushes it to
 * that salon's open screens, coalesced so one burst is one refresh.
 *
 * Carries only the salon id and a kind — never content (see inbox-events.service).
 */
import { EventEmitter } from 'events';

export const inboxBus = new EventEmitter();
inboxBus.setMaxListeners(0);

/** Tables whose rows a live inbox shows. */
export const INBOX_MODELS = new Set(['MessengerThread', 'MessengerNote', 'MessengerThreadLabel', 'ChatAssignmentLog', 'ChatAgentPresence']);
const WRITES = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']);

type Params = { model?: string; action?: string; args?: { where?: Record<string, unknown>; data?: Record<string, unknown> | Record<string, unknown>[]; create?: Record<string, unknown> } };

/** Does this write move an inbox screen? Settings rows count when they are a shift or the turn team. */
export function inboxWrite(params: Params): boolean {
  if (!params?.model || !WRITES.has(String(params.action))) return false;
  if (INBOX_MODELS.has(params.model)) return true;
  if (params.model === 'Setting') {
    const key = String((params.args?.where as { tenantId_key?: { key?: string } } | undefined)?.tenantId_key?.key ?? (params.args?.create as { key?: string } | undefined)?.key ?? '');
    return /^messenger\.turn_(shift|team)/.test(key);
  }
  return false;
}

/** The salon a write belongs to, when the write itself says so. */
export function tenantOf(params: Params, result: unknown): string | null {
  const r = (result && typeof result === 'object' && !Array.isArray(result) ? result : {}) as { tenantId?: unknown };
  const d = params.args?.data;
  const cands = [
    r.tenantId,
    params.args?.where?.tenantId,
    (params.args?.where as { tenantId_key?: { tenantId?: unknown }; tenantId_userId?: { tenantId?: unknown } } | undefined)?.tenantId_key?.tenantId,
    (params.args?.where as { tenantId_userId?: { tenantId?: unknown } } | undefined)?.tenantId_userId?.tenantId,
    Array.isArray(d) ? d[0]?.tenantId : d?.tenantId,
    params.args?.create?.tenantId,
  ];
  for (const c of cands) if (typeof c === 'string' && c) return c;
  return null;
}
