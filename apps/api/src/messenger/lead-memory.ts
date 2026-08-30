/**
 * What the bot must never forget — and why it kept forgetting.
 *
 * A real consultation was lost to this: the customer had given their shop
 * name, their phone and their city, the bot had SAVED all of it as a sales
 * lead… and then asked for it again three messages later. Four faults, one
 * symptom:
 *
 *  1. The lead row was WRITE-ONLY. record_lead wrote name/phone/shop/city to
 *     the database and nothing ever read it back into the prompt. The most
 *     reliable memory in the system — structured, exact, no AI involved — was
 *     invisible to the very agent that wrote it.
 *  2. Long-term memory depended on the SAME Anthropic key the bot thinks with.
 *     When that key ran dry, distillation returned early and the turns falling
 *     out of the short window were lost forever — silently, with no retry.
 *  3. The distiller trusted a summary captured BEFORE it ran. Two messages in
 *     quick succession (people type in bursts) meant the second distillation
 *     overwrote the first with a stale base.
 *  4. Twelve turns of short-term memory is six exchanges — a sales chat about
 *     packages passes that before anyone says a price.
 *
 * This module holds the two pure decisions: how a lead becomes prompt text,
 * and how memory survives when the AI distiller cannot run.
 */

export interface LeadFacts {
  name?: string | null;
  phone?: string | null;
  salonName?: string | null;
  city?: string | null;
  interest?: string | null;
  note?: string | null;
  createdAt?: Date | string | null;
}

/**
 * The customer's own words, already banked, rendered as an unmissable block.
 *
 * Deterministic on purpose: this is a database row, not a model's recollection,
 * so it works even when the AI's memory pipeline is broken or unpaid.
 */
export function leadDossier(lead: LeadFacts | null | undefined): string {
  if (!lead) return '';
  const rows: string[] = [];
  const add = (label: string, v: string | null | undefined) => {
    const s = String(v ?? '').trim();
    if (s) rows.push(`- ${label}: ${s}`);
  };
  add('Tên khách', lead.name);
  add('Số điện thoại', lead.phone);
  add('Tên tiệm / doanh nghiệp', lead.salonName);
  add('Thành phố / khu vực', lead.city);
  add('Đang quan tâm', lead.interest);
  add('Ghi chú', lead.note);
  if (!rows.length) return '';
  return '\nTHÔNG TIN KHÁCH ĐÃ CUNG CẤP (đã lưu trong hệ thống — ĐÂY LÀ SỰ THẬT, không được hỏi lại bất kỳ mục nào dưới đây; dùng thẳng khi cần):\n'
    + rows.join('\n')
    + '\nNếu khách đưa thông tin MỚI khác với trên, thông tin mới thắng — cập nhật im lặng, không hỏi khách cái nào đúng.';
}

/** Does the dossier already answer this question? Used to pin the rule in tests. */
export function dossierHas(lead: LeadFacts | null | undefined, field: keyof LeadFacts): boolean {
  return Boolean(lead && String(lead[field] ?? '').trim());
}

/**
 * Memory that cannot be lost, even with no AI available.
 *
 * When the distiller cannot run (no key, no credit, API down), the turns about
 * to fall out of the window are folded into the profile RAW — trimmed, tagged,
 * capped. Ugly prose in the profile is infinitely better than a bot that asks
 * a customer for their phone number twice.
 */
export function rawMemoryFallback(prev: string | null | undefined, dropped: { role: string; content: unknown }[], cap = 2000): string {
  const lines = (dropped ?? [])
    .map((t) => {
      const who = t.role === 'user' ? 'KHÁCH' : 'SHOP';
      const body = String(t.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      return body ? `- ${who}: ${body}` : '';
    })
    .filter(Boolean);
  if (!lines.length) return String(prev ?? '');
  const head = String(prev ?? '').trim();
  const merged = [head, '(ghi thô — chưa chưng cất)', ...lines].filter(Boolean).join('\n');
  // Keep the TAIL when trimming: the newest facts are the ones a live
  // conversation needs, and the oldest were already summarised once.
  return merged.length <= cap ? merged : merged.slice(merged.length - cap);
}
