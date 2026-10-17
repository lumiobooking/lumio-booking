/**
 * Massage / spa paperwork on the web side: the shapes the API sends
 * (api/src/client-forms) and the few pure helpers the screens share —
 * reading an answer back as words, and the printable page.
 *
 * Pure (tested in client-forms.spec.ts).
 */

export type FormKind = 'intake' | 'cupping' | 'hot_stone' | 'soap';
export type FormLang = 'vi' | 'en';
export type FieldType = 'section' | 'note' | 'yesno' | 'choice' | 'multi' | 'text' | 'bodymap' | 'scale' | 'ack';

export interface ResolvedField {
  id: string; type: FieldType; label: string; required?: boolean;
  options?: { id: string; label: string }[];
  flags?: string[]; detail?: boolean; min?: number; max?: number;
  prefill?: 'name' | 'phone' | 'email' | 'birthDate'; short?: boolean;
}
export interface ResolvedTemplate {
  kind: FormKind; version: number; lang: FormLang; title: string; intro?: string;
  signer: 'client' | 'staff'; fields: ResolvedField[];
  areas: { id: string; label: string; side: 'front' | 'back' }[];
}
export type Answers = Record<string, unknown>;

export interface FormNeed { kind: FormKind; when: 'before' | 'after'; status: 'signed' | 'missing' | 'expired'; entryId: string | null; signedAt: string | null }
export interface RedFlag { kind: FormKind; fieldId: string; label: string; note?: string; for: string[] }

export interface VisitForms {
  enabled: boolean;
  access?: 'full' | 'tech' | 'desk';
  customer?: { id: string; name: string } | null;
  name?: string;
  hasPhone?: boolean;
  consentKinds?: string[];
  needs?: FormNeed[];
  flags?: RedFlag[];
  notes?: string[];
  canSoap?: boolean;
  soapId?: string | null;
}

export interface CustomerForms {
  enabled: boolean;
  access: 'full' | 'tech' | 'desk';
  customer: { id: string; name: string; hasPhone: boolean };
  needs: FormNeed[];
  flags: RedFlag[];
  entries: { id: string; kind: FormKind; signedAt: string; signerRole: string; signedName: string | null; staffName: string | null; title: string | null; addenda: number }[];
}

export interface FormEntry {
  id: string; kind: FormKind; signedAt: string; signerRole: string; signedName: string | null;
  signatureData: string | null; answers: Answers; snapshot: ResolvedTemplate | null;
  addenda: { at: string; by: string; text: string }[]; source?: string;
  customerName: string | null; staffName: string | null; salonName: string; canAmend: boolean;
}

export interface TemplatePair { kind: FormKind; vi: ResolvedTemplate; en: ResolvedTemplate }

export const KIND_LABEL: Record<FormKind, { vi: string; en: string }> = {
  intake: { vi: 'Phiếu thông tin', en: 'Intake' },
  cupping: { vi: 'Đồng ý giác hơi', en: 'Cupping consent' },
  hot_stone: { vi: 'Đồng ý đá nóng', en: 'Hot stone consent' },
  soap: { vi: 'Ghi chú SOAP', en: 'SOAP note' },
};
export const kindLabel = (k: string, vi: boolean) => (KIND_LABEL[k as FormKind] ? (vi ? KIND_LABEL[k as FormKind].vi : KIND_LABEL[k as FormKind].en) : k);

/** An answer as words, for the viewer and the printout. Empty string = not answered. */
export function answerText(f: ResolvedField, answers: Answers, areas: ResolvedTemplate['areas'], vi: boolean): string {
  const v = answers[f.id];
  const opt = (id: unknown) => f.options?.find((o) => o.id === id)?.label ?? String(id);
  const area = (id: unknown) => areas.find((a) => a.id === id)?.label ?? String(id);
  switch (f.type) {
    case 'yesno': {
      if (typeof v !== 'boolean') return '';
      const note = typeof answers[`${f.id}__note`] === 'string' ? ` — ${answers[`${f.id}__note`]}` : '';
      return (v ? (vi ? 'Có' : 'Yes') : (vi ? 'Không' : 'No')) + (v ? note : '');
    }
    case 'choice': return typeof v === 'string' ? opt(v) : '';
    case 'multi': return Array.isArray(v) ? v.map(opt).join(', ') : '';
    case 'bodymap': return Array.isArray(v) ? v.map(area).join(', ') : '';
    case 'scale': return typeof v === 'number' ? `${v} / ${f.max ?? 10}` : '';
    case 'ack': return v === true ? '✓' : '';
    case 'text': return typeof v === 'string' ? v : '';
    default: return '';
  }
}

/** Is everything the form requires answered? The ids still missing. */
export function missingFields(tpl: ResolvedTemplate, answers: Answers): string[] {
  return tpl.fields.filter((f) => f.required && f.type !== 'section' && f.type !== 'note').filter((f) => {
    const v = answers[f.id];
    if (f.type === 'yesno') return typeof v !== 'boolean';
    if (f.type === 'ack') return v !== true;
    if (f.type === 'multi' || f.type === 'bodymap') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'scale') return typeof v !== 'number';
    return typeof v !== 'string' || !v.trim();
  }).map((f) => f.id);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * The signed form as a printable page — what the client saw, what they
 * answered, the signature, and any corrections added after. Every value is
 * escaped; the only image is the signature, and only a PNG data URL.
 */
export function printHtml(e: FormEntry, vi: boolean): string {
  const tpl = e.snapshot;
  const when = (iso: string) => { try { return new Date(iso).toLocaleString(vi ? 'vi-VN' : 'en-US'); } catch { return iso; } };
  const rows: string[] = [];
  for (const f of tpl?.fields ?? []) {
    if (f.type === 'section') { rows.push(`<h3>${esc(f.label)}</h3>`); continue; }
    if (f.type === 'note') { rows.push(`<p class="n">${esc(f.label)}</p>`); continue; }
    const a = answerText(f, e.answers, tpl?.areas ?? [], vi);
    const flag = f.type === 'yesno' && e.answers[f.id] === true && (f.flags?.length ?? 0) > 0;
    rows.push(`<div class="r${flag ? ' f' : ''}"><span>${esc(f.label)}</span><b>${esc(a || '—')}</b></div>`);
  }
  const sig = e.signatureData && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(e.signatureData) ? `<img class="sig" alt="" src="${e.signatureData}">` : '';
  const add = e.addenda.length
    ? `<h3>${vi ? 'Bổ sung sau khi ký' : 'Added after signing'}</h3>${e.addenda.map((x) => `<div class="r"><span>${esc(when(x.at))} · ${esc(x.by || '')}</span><b>${esc(x.text)}</b></div>`).join('')}`
    : '';
  const who = e.signerRole === 'staff'
    ? `${vi ? 'Kỹ thuật viên' : 'Therapist'}: ${esc(e.signedName || e.staffName || '')}`
    : `${vi ? 'Khách hàng' : 'Client'}: ${esc(e.signedName || e.customerName || '')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(tpl?.title ?? '')}</title><style>
body{font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px;max-width:760px}
h1{font-size:20px;margin:0}h2{font-size:13px;font-weight:600;color:#555;margin:4px 0 16px}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#444;border-bottom:1px solid #ddd;padding-bottom:4px;margin:18px 0 6px}
.r{display:flex;gap:16px;justify-content:space-between;padding:4px 0;border-bottom:1px dotted #e5e5e5}.r span{color:#333}.r b{text-align:right;font-weight:600;max-width:55%}
.r.f b{color:#b91c1c}.n{color:#555}.sig{display:block;max-width:320px;max-height:120px;border-bottom:1px solid #999;margin-top:6px}
.foot{margin-top:22px}@media print{body{margin:12mm}}
</style></head><body><h1>${esc(tpl?.title ?? '')}</h1><h2>${esc(e.salonName)}${e.customerName ? ` · ${esc(e.customerName)}` : ''}</h2>
${rows.join('\n')}
<div class="foot">${who}<br>${vi ? 'Ký lúc' : 'Signed'}: ${esc(when(e.signedAt))}${sig}</div>${add}
</body></html>`;
}

/** A return path the sign page may send the iPad back to: this app's own pages only. */
export function safeReturn(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /^\/[a-z]+:/i.test(raw)) return null;
  return raw.length <= 300 ? raw : null;
}
