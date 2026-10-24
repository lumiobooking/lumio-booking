/**
 * The salon's own form, as the editor on /salon/forms handles it.
 *
 * Mirrors the API's custom-forms.ts (which has the last word: it cleans and
 * versions every save). This side only builds the draft the owner is editing,
 * draws a preview of it, and says in plain words what still needs fixing
 * before saving — so nothing the owner typed disappears silently on the server.
 *
 * A form is written in one language: the salon's own region's.
 *
 * Pure (tested in form-editor.spec.ts).
 */
import type { FieldType, ResolvedTemplate } from './client-forms';

export interface EditOption { id: string; label: string }
export interface EditField {
  id: string; type: FieldType; label: string; required?: boolean;
  options?: EditOption[]; flag?: boolean; detail?: boolean; min?: number; max?: number;
  prefill?: 'name' | 'phone' | 'email' | 'birthDate'; short?: boolean;
}
export interface EditForm {
  kind: string; name: string; intro: string; signer: 'client' | 'staff'; active: boolean;
  lang: 'vi' | 'en'; version: number;
  appliesTo: { all: boolean; serviceIds: string[]; categoryIds: string[] };
  validMonths: number; fields: EditField[]; starter?: string;
}
export interface Starter { key: string; name: string; intro: string; signer: 'client' | 'staff'; suggested: boolean }

/** The kinds of question, in the order the "add a question" menu shows them. */
export const FIELD_TYPES: { type: FieldType; vi: string; en: string; hintVi: string; hintEn: string }[] = [
  { type: 'yesno', vi: 'Có / Không', en: 'Yes / No', hintVi: 'Khách chạm Có hoặc Không', hintEn: 'Tap yes or no' },
  { type: 'choice', vi: 'Chọn 1', en: 'Pick one', hintVi: 'Một lựa chọn trong danh sách', hintEn: 'One option from a list' },
  { type: 'multi', vi: 'Chọn nhiều', en: 'Pick several', hintVi: 'Nhiều lựa chọn', hintEn: 'Several options' },
  { type: 'text', vi: 'Chữ', en: 'Text', hintVi: 'Gõ vài chữ', hintEn: 'A few words' },
  { type: 'scale', vi: 'Thang điểm', en: 'Scale', hintVi: 'Ví dụ 0–10', hintEn: 'e.g. 0–10' },
  { type: 'ack', vi: 'Tích đồng ý', en: 'Agree tick', hintVi: '“Tôi hiểu và đồng ý…”', hintEn: '“I understand and agree…”' },
  { type: 'bodymap', vi: 'Sơ đồ cơ thể', en: 'Body map', hintVi: 'Chạm vùng trên cơ thể', hintEn: 'Tap areas of the body' },
  { type: 'section', vi: 'Tiêu đề nhóm', en: 'Heading', hintVi: 'Chia form thành từng phần', hintEn: 'Splits the form into parts' },
  { type: 'note', vi: 'Đoạn ghi chú', en: 'Paragraph', hintVi: 'Chữ để đọc, không cần trả lời', hintEn: 'Text to read, nothing to answer' },
];
export const typeLabel = (t: FieldType, vi: boolean) => {
  const x = FIELD_TYPES.find((f) => f.type === t);
  return x ? (vi ? x.vi : x.en) : t;
};

const answers = (t: FieldType) => t !== 'section' && t !== 'note';

/** A fresh id not used by any other question in the form. */
export function freshId(fields: { id: string }[], prefix = 'q'): string {
  const used = new Set(fields.map((f) => f.id));
  let n = fields.length + 1;
  while (used.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/** A new question of a type, ready to type the words into. */
export function newField(type: FieldType, fields: EditField[], vi: boolean): EditField {
  const f: EditField = { id: freshId(fields), type, label: '' };
  if (type === 'yesno') { f.required = true; f.flag = true; }
  if (type === 'ack') f.required = true;
  if (type === 'choice' || type === 'multi') f.options = [{ id: 'o1', label: vi ? 'Lựa chọn 1' : 'Option 1' }, { id: 'o2', label: vi ? 'Lựa chọn 2' : 'Option 2' }];
  if (type === 'scale') { f.min = 0; f.max = 10; }
  return f;
}

/** Move a question up (-1) or down (+1); out of range does nothing. */
export function moveField<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** A copy of a question placed right under it, with its own id. */
export function duplicateField(fields: EditField[], index: number): EditField[] {
  const f = fields[index];
  if (!f) return fields;
  const copy: EditField = { ...f, id: freshId(fields), options: f.options?.map((o) => ({ ...o })) };
  return [...fields.slice(0, index + 1), copy, ...fields.slice(index + 1)];
}

/** Add a choice to a list question, with an id of its own. */
export function addOption(f: EditField, label: string): EditField {
  const opts = f.options ?? [];
  const used = new Set(opts.map((o) => o.id));
  let n = opts.length + 1;
  while (used.has(`o${n}`)) n += 1;
  return { ...f, options: [...opts, { id: `o${n}`, label }] };
}

/**
 * What would stop or spoil a save, in the owner's words. The server drops a
 * question with no words or a list with no choices; saying so here first
 * means nothing the owner typed vanishes without a reason.
 */
export function formProblems(f: EditForm, vi: boolean): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push(vi ? 'Đặt tên cho biểu mẫu' : 'Give the form a name');
  if (!f.fields.some((x) => answers(x.type))) out.push(vi ? 'Thêm ít nhất một câu hỏi' : 'Add at least one question');
  f.fields.forEach((x, i) => {
    const n = i + 1;
    if (!x.label.trim()) out.push(vi ? `Câu ${n}: chưa có nội dung` : `Question ${n}: no words yet`);
    if ((x.type === 'choice' || x.type === 'multi') && !(x.options ?? []).some((o) => o.label.trim())) out.push(vi ? `Câu ${n}: cần ít nhất một lựa chọn` : `Question ${n}: needs at least one option`);
    if (x.type === 'scale' && (x.min ?? 0) >= (x.max ?? 10)) out.push(vi ? `Câu ${n}: số nhỏ nhất phải nhỏ hơn số lớn nhất` : `Question ${n}: the lowest number must be below the highest`);
  });
  if (!f.appliesTo.all && !f.appliesTo.serviceIds.length && !f.appliesTo.categoryIds.length) {
    out.push(vi ? 'Chọn dịch vụ cần biểu mẫu này, hoặc chọn “Mọi lượt khách”' : 'Pick the services that need this form, or “Every visit”');
  }
  return out;
}

/** The draft as a template the form renderer draws — the live preview. */
export function previewOf(f: EditForm): ResolvedTemplate {
  return {
    kind: f.kind as ResolvedTemplate['kind'], version: f.version, lang: f.lang, title: f.name, intro: f.intro || undefined, signer: f.signer,
    fields: f.fields.map((x) => ({
      id: x.id, type: x.type, label: x.label || '…', required: x.required,
      options: x.options?.map((o) => ({ id: o.id, label: o.label || '…' })),
      flags: x.type === 'yesno' && x.flag ? ['massage'] : undefined,
      detail: x.detail, min: x.min, max: x.max, prefill: x.prefill, short: x.short,
    })),
    areas: [],
  };
}

/** "Every visit", "Valid 12 months"… — the line under a form's name in the list. */
export function ruleText(f: EditForm, serviceNames: Map<string, string>, vi: boolean): string {
  const who = f.signer === 'staff' ? (vi ? 'Thợ ghi sau buổi làm' : 'Technician fills it after') : (vi ? 'Khách ký trước khi làm' : 'Client signs before');
  const when = f.signer === 'staff'
    ? ''
    : f.validMonths === 0 ? (vi ? ' · mỗi lần đến' : ' · every visit') : (vi ? ` · ký lại sau ${f.validMonths} tháng` : ` · sign again after ${f.validMonths} months`);
  const names = f.appliesTo.serviceIds.map((id) => serviceNames.get(id)).filter(Boolean) as string[];
  const where = f.appliesTo.all
    ? (vi ? ' · mọi lượt khách' : ' · every visit')
    : names.length
      ? ` · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
      : f.appliesTo.categoryIds.length ? (vi ? ' · theo nhóm dịch vụ' : ' · by service group') : (vi ? ' · chưa chọn dịch vụ' : ' · no service picked');
  return who + when + where;
}
