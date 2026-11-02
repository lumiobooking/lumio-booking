/**
 * GỠ KHỎI TRANG — which networks a published post is still up on, and when it
 * counts as taken down everywhere (api: SocialPublishService.takeDown).
 */
/** One network's outcome of a publish, and of a take-down ("Gỡ khỏi trang"). */
export interface PostResult { channel: string; id?: string | null; url?: string | null; error?: string | null; removedAt?: string | null; removedBy?: string | null; removeError?: string | null }

/** Published, and taken down again from every network it reached. */
export function takenDown(p: { status: string; results?: PostResult[] }): boolean {
  if (p.status !== 'posted') return false;
  const live = (p.results ?? []).filter((r) => r && r.id && !r.error);
  return live.length > 0 && live.every((r) => !!r.removedAt);
}
/** The networks this post is still up on (and can be taken down from). */
export function stillUp(p: { status: string; results?: PostResult[] }): PostResult[] {
  if (p.status !== 'posted') return [];
  return (p.results ?? []).filter((r) => r && r.id && !r.error && !r.removedAt);
}
