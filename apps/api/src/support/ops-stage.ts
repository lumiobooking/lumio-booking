/**
 * Where a salon is in the team's work, as the team says it is.
 *
 * NOT THE SAME THING AS Tenant.status
 *
 * `Tenant.status` is an access switch. PENDING and SUSPENDED stop the salon's
 * own staff signing in, CANCELLED soft-deletes it, and Stripe rewrites it on
 * every payment that succeeds or fails. It is the platform's business, it is
 * changed on Super Admin, and a support employee must never be one click from
 * locking a paying customer out mid-shift.
 *
 * The team still needs to say, for every shop, "we have not set this one up
 * yet", "it is live", "the owner asked us to pause", "they left". That is a
 * statement about the WORK, it changes often, and anyone on the team should be
 * able to make it. So it lives here, in the salon's own settings, and nothing
 * reads it except the screens that display it. Changing it cannot lock anyone
 * out and cannot touch a bill.
 *
 * A salon nobody has labelled yet gets a label from its access status, so the
 * list is not blank on the first day: PENDING reads as "not set up yet",
 * SUSPENDED as "paused", CANCELLED as "stopped", anything else as "running".
 */

export const OPS_STAGE_KEY = 'ops_stage';

export type OpsStage = 'setup' | 'running' | 'paused' | 'stopped';

export const OPS_STAGES: readonly OpsStage[] = ['setup', 'running', 'paused', 'stopped'];

export function isOpsStage(v: unknown): v is OpsStage {
  return typeof v === 'string' && (OPS_STAGES as readonly string[]).includes(v);
}

/** The label a salon gets before anybody has set one. */
export function defaultStage(status: string | null | undefined): OpsStage {
  if (status === 'PENDING') return 'setup';
  if (status === 'SUSPENDED') return 'paused';
  if (status === 'CANCELLED') return 'stopped';
  return 'running';
}

/**
 * The stage to show. `stored` is the raw Setting value — `{ stage }` as this
 * module writes it — and anything unreadable falls back to the default rather
 * than to a blank pill.
 */
export function opsStageOf(stored: unknown, status: string | null | undefined): OpsStage {
  const s = stored && typeof stored === 'object' ? (stored as { stage?: unknown }).stage : stored;
  return isOpsStage(s) ? s : defaultStage(status);
}
