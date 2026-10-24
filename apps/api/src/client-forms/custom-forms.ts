/**
 * A SALON'S OWN FORMS — built by the owner, next to the built-in ones.
 *
 * The built-in forms (intake, cupping, hot stone, SOAP) fit a massage studio.
 * A nail salon wants a gel / acrylic release and a record of the shape and the
 * colour; a lash studio a lash health form and a map of curl, length and glue;
 * a waxing room the retinol questions. So each salon can add its own forms:
 * from a starter (one per trade, below) or from a blank page, and edit every
 * question.
 *
 * A form is written in ONE language — the language of the salon's own region
 * (a Vietnamese salon writes Vietnamese, an American one English). The client
 * sees exactly what the owner wrote, so there is no translation to go stale.
 *
 * Who fills it in:
 *   client — signs it before the visit (link, desk iPad, kiosk), like the intake
 *   staff  — the technician's record after the visit, like the SOAP note
 *
 * Editing a form never touches what was signed: every entry keeps a snapshot of
 * the form as it was shown, and the form's version goes up whenever its
 * questions change.
 *
 * Stored inside the salon's own `client_forms` setting (one row per tenant),
 * so a form can never be seen by, or reach, another salon.
 *
 * Pure: no database, no clock (tested in custom-forms.spec.ts).
 */
import type { CustomKind, FieldType, FormField, FormLang, FormTemplate, Tx } from './form-templates';

export type { CustomKind };
export const CUSTOM_KIND_RE = /^c_[a-z0-9]{6,16}$/;
export const isCustomKind = (k: unknown): k is CustomKind => typeof k === 'string' && CUSTOM_KIND_RE.test(k);

export interface CustomOption { id: string; label: string }
export interface CustomField {
  id: string;
  type: FieldType;
  label: string;
  required?: boolean;
  options?: CustomOption[];
  /** yes/no: a "yes" is shown to the technician as a caution before they start. */
  flag?: boolean;
  /** yes/no: ask for a few words when the answer is yes. */
  detail?: boolean;
  min?: number;
  max?: number;
  /** text: filled from the client record. */
  prefill?: 'name' | 'phone' | 'email' | 'birthDate';
  short?: boolean;
}

export interface CustomForm {
  kind: CustomKind;
  name: string;
  intro: string;
  signer: 'client' | 'staff';
  active: boolean;
  /** The one language it is written in — the salon's region when it was made. */
  lang: FormLang;
  /** Goes up every time the questions change; each signed entry keeps its own. */
  version: number;
  /** Which visits need it: every visit, or only these services / categories. */
  appliesTo: { all: boolean; serviceIds: string[]; categoryIds: string[] };
  /** Client forms: how long a signature lasts, in months (0 = every visit). Staff records: every visit. */
  validMonths: number;
  fields: CustomField[];
  /** The starter it came from, if any (for the record only). */
  starter?: string;
}

export const CUSTOM_LIMITS = { forms: 30, fields: 80, options: 30, label: 300, longLabel: 800, name: 120, intro: 800 };
const FIELD_TYPES: FieldType[] = ['section', 'note', 'yesno', 'choice', 'multi', 'text', 'bodymap', 'scale', 'ack'];
const PREFILLS = ['name', 'phone', 'email', 'birthDate'] as const;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};
const idList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 300) : []);
const slug = (v: unknown) => (typeof v === 'string' ? v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) : '');

/** One field made safe; null when it cannot be a field at all (no label, a list with no choices). */
function cleanField(raw: unknown, usedIds: Set<string>, index: number): CustomField | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const type = FIELD_TYPES.includes(r.type as FieldType) ? (r.type as FieldType) : null;
  if (!type) return null;
  const long = type === 'section' || type === 'note' || type === 'ack';
  const label = str(r.label, long ? CUSTOM_LIMITS.longLabel : CUSTOM_LIMITS.label);
  if (!label) return null;
  let id = slug(r.id);
  // "x__note" is where a yes/no keeps its few words — no field may be called that.
  if (!id || usedIds.has(id) || id.endsWith('__note') || /^[0-9]/.test(id)) {
    let n = index + 1;
    do { id = `q${n}`; n += 1; } while (usedIds.has(id));
  }
  usedIds.add(id);
  const f: CustomField = { id, type, label };
  if (type !== 'section' && type !== 'note' && bool(r.required, type === 'ack' || type === 'yesno')) f.required = true;
  if (type === 'choice' || type === 'multi') {
    const seen = new Set<string>();
    const options: CustomOption[] = [];
    for (const o of Array.isArray(r.options) ? r.options.slice(0, CUSTOM_LIMITS.options) : []) {
      const oo = (o && typeof o === 'object' ? o : { label: o }) as Record<string, unknown>;
      const olabel = str(oo.label, 120);
      if (!olabel) continue;
      let oid = slug(oo.id);
      if (!oid || seen.has(oid)) { let n = options.length + 1; do { oid = `o${n}`; n += 1; } while (seen.has(oid)); }
      seen.add(oid);
      options.push({ id: oid, label: olabel });
    }
    if (!options.length) return null;
    f.options = options;
  }
  if (type === 'yesno') {
    if (bool(r.flag, false)) f.flag = true;
    if (bool(r.detail, false)) f.detail = true;
  }
  if (type === 'scale') {
    const min = int(r.min, 0, 0, 99);
    const max = int(r.max, 10, 1, 100);
    f.min = Math.min(min, max - 1);
    f.max = Math.max(max, f.min + 1);
  }
  if (type === 'text') {
    if (PREFILLS.includes(r.prefill as typeof PREFILLS[number])) f.prefill = r.prefill as CustomField['prefill'];
    if (bool(r.short, false)) f.short = true;
  }
  return f;
}

/** What makes a new version: the words and questions, not where the form applies. */
function contentKey(f: Pick<CustomForm, 'name' | 'intro' | 'signer' | 'fields'>): string {
  return JSON.stringify([f.name, f.intro, f.signer, f.fields]);
}

/**
 * A form as the owner sent it, made safe. `prev` is the stored form being
 * edited (its kind, language and version carry over); without it this is a
 * new form in `lang`. Throws nothing: an unusable field is dropped, an empty
 * name becomes a default.
 */
export function sanitizeCustomForm(raw: unknown, prev: CustomForm | null, kind: CustomKind, lang: FormLang): CustomForm {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const usedIds = new Set<string>();
  const fields: CustomField[] = [];
  for (const [i, f] of (Array.isArray(r.fields) ? r.fields.slice(0, CUSTOM_LIMITS.fields) : []).entries()) {
    const c = cleanField(f, usedIds, i);
    if (c) fields.push(c);
  }
  const signer: CustomForm['signer'] = r.signer === 'staff' || r.signer === 'client' ? r.signer : prev?.signer ?? 'client';
  const formLang = prev?.lang ?? lang;
  const name = str(r.name, CUSTOM_LIMITS.name) || prev?.name || (formLang === 'vi' ? 'Biểu mẫu mới' : 'New form');
  const intro = typeof r.intro === 'string' ? str(r.intro, CUSTOM_LIMITS.intro) : prev?.intro ?? '';
  const appliesRaw = r.appliesTo && typeof r.appliesTo === 'object' ? (r.appliesTo as Record<string, unknown>) : null;
  const appliesTo = appliesRaw
    ? { all: bool(appliesRaw.all, true), serviceIds: idList(appliesRaw.serviceIds), categoryIds: idList(appliesRaw.categoryIds) }
    : prev?.appliesTo ?? { all: true, serviceIds: [], categoryIds: [] };
  const next: CustomForm = {
    kind: prev?.kind ?? kind,
    name, intro, signer,
    active: bool(r.active, prev?.active ?? true),
    lang: formLang,
    version: 1,
    appliesTo,
    validMonths: signer === 'staff' ? 0 : int(r.validMonths, prev?.validMonths ?? 12, 0, 60),
    fields,
    ...(typeof r.starter === 'string' && r.starter ? { starter: str(r.starter, 40) } : prev?.starter ? { starter: prev.starter } : {}),
  };
  next.version = prev ? (contentKey(prev) === contentKey(next) ? prev.version : prev.version + 1) : 1;
  return next;
}

/** The stored list made safe (unknown kinds and duplicates dropped, at most 30). */
export function sanitizeCustomForms(raw: unknown, lang: FormLang): CustomForm[] {
  const out: CustomForm[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(raw) ? raw : []) {
    if (!f || typeof f !== 'object') continue;
    const kind = (f as Record<string, unknown>).kind;
    if (!isCustomKind(kind) || seen.has(kind)) continue;
    seen.add(kind);
    const stored = f as CustomForm;
    // Re-cleaned on read, but its version is the stored one — reading must never bump it.
    const clean = sanitizeCustomForm(stored, null, kind, stored.lang === 'vi' || stored.lang === 'en' ? stored.lang : lang);
    clean.version = int(stored.version, 1, 1, 100000);
    out.push(clean);
    if (out.length >= CUSTOM_LIMITS.forms) break;
  }
  return out;
}

/** The custom form as a template the signing, the viewer and the snapshot already understand. */
export function customTemplate(cf: CustomForm): FormTemplate {
  const both = (s: string): Tx => ({ vi: s, en: s });
  return {
    kind: cf.kind,
    version: cf.version,
    title: both(cf.name),
    ...(cf.intro ? { intro: both(cf.intro) } : {}),
    signer: cf.signer,
    fields: cf.fields.map((f): FormField => {
      const out: FormField = { id: f.id, type: f.type, label: both(f.label) };
      if (f.required) out.required = true;
      if (f.options) out.options = f.options.map((o) => ({ id: o.id, label: both(o.label) }));
      if (f.type === 'yesno') { out.flags = f.flag ? ['massage'] : []; if (f.detail) out.detail = true; }
      if (f.min != null) out.min = f.min;
      if (f.max != null) out.max = f.max;
      if (f.prefill) out.prefill = f.prefill;
      if (f.short) out.short = true;
      return out;
    }),
  };
}

/** Does this visit need the form? Every visit, or one of its services / categories. */
export function customApplies(cf: CustomForm, services: { id: string | null; categoryId?: string | null }[]): boolean {
  if (!cf.active) return false;
  if (cf.appliesTo.all) return true;
  return services.some((s) => (!!s.id && cf.appliesTo.serviceIds.includes(s.id)) || (!!s.categoryId && cf.appliesTo.categoryIds.includes(s.categoryId)));
}

/** A fresh, unguessable-enough kind for a new form (unique within the salon). */
export function newCustomKind(taken: Iterable<string>, rand: () => string): CustomKind {
  const used = new Set(taken);
  for (let i = 0; i < 20; i += 1) {
    const k = `c_${rand().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}`;
    if (isCustomKind(k) && !used.has(k)) return k as CustomKind;
  }
  return `c_${Date.now().toString(36)}` as CustomKind;
}

// ---------------------------------------------------------------- starters

type SField = { id: string; type: FieldType; label: Tx; required?: boolean; options?: { id: string; label: Tx }[]; flag?: boolean; detail?: boolean; min?: number; max?: number; prefill?: CustomField['prefill']; short?: boolean };
interface Starter { key: string; trades: string[]; signer: 'client' | 'staff'; name: Tx; intro: Tx; validMonths: number; fields: SField[] }

const t = (vi: string, en: string): Tx => ({ vi, en });
const sec = (id: string, vi: string, en: string): SField => ({ id, type: 'section', label: t(vi, en) });
const yes = (id: string, vi: string, en: string, flag = true, detail = false): SField => ({ id, type: 'yesno', label: t(vi, en), required: true, flag, detail });
const agree = (id: string, vi: string, en: string): SField => ({ id, type: 'ack', label: t(vi, en), required: true });
const o = (id: string, vi: string, en: string) => ({ id, label: t(vi, en) });
const one = (id: string, vi: string, en: string, options: ReturnType<typeof o>[], required = false): SField => ({ id, type: 'choice', label: t(vi, en), options, required });
const many = (id: string, vi: string, en: string, options: ReturnType<typeof o>[], required = false): SField => ({ id, type: 'multi', label: t(vi, en), options, required });
const txt = (id: string, vi: string, en: string, short = true): SField => ({ id, type: 'text', label: t(vi, en), short });
const NAME: SField = { id: 'name', type: 'text', label: t('Họ tên', 'Full name'), required: true, prefill: 'name', short: true };
const PHONE: SField = { id: 'phone', type: 'text', label: t('Số điện thoại', 'Phone'), prefill: 'phone', short: true };
const COMMON_ACKS = [
  agree('ack_true', 'Thông tin trên là đúng và đầy đủ.', 'The information above is true and complete.'),
  agree('ack_stop', 'Tôi có thể yêu cầu dừng bất cứ lúc nào.', 'I can ask to stop at any time.'),
  agree('ack_release', 'Tôi tự nguyện sử dụng dịch vụ và miễn trách nhiệm cho tiệm với phản ứng do tình trạng tôi không khai.', 'I choose to receive the service and release the salon from liability for reactions caused by conditions I did not disclose.'),
];

export const STARTERS: Starter[] = [
  {
    key: 'nail_enhancement', trades: ['NAIL'], signer: 'client', validMonths: 12,
    name: t('Cam kết làm móng bột / gel / dip', 'Acrylic, gel & dip consent'),
    intro: t('Dành cho khách đắp bột, gel, dip, móng úp. Chỉ cần chạm để chọn.', 'For acrylic, gel, dip and extension services. Just tap to answer.'),
    fields: [
      NAME, PHONE,
      sec('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
      yes('allergy', 'Từng dị ứng với gel, bột acrylic, keo dán hoặc đèn UV', 'Ever reacted to gel, acrylic, nail glue or UV lamps', true, true),
      yes('fungus', 'Đang bị nấm móng, móng nhiễm trùng hoặc sưng đỏ quanh móng', 'Nail fungus, an infected nail or redness around a nail', true, true),
      yes('thin', 'Móng thật đang mỏng, yếu, hoặc vừa bị hỏng do tháo sai cách', 'Natural nails thin, weak or damaged by a bad removal', true),
      yes('diabetes', 'Tiểu đường hoặc rối loạn tuần hoàn', 'Diabetes or poor circulation', true),
      yes('pregnant', 'Đang mang thai', 'Pregnant', false),
      sec('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
      agree('ack_lift', 'Móng có thể bị bong, gãy hoặc hở nếu va đập, ngâm nước nhiều hoặc không dặm đúng hẹn.', 'Enhancements can lift, break or crack with knocks, long soaking or missed fills.'),
      agree('ack_removal', 'Tôi sẽ không tự cạy gỡ; tháo đúng cách tại tiệm để bảo vệ móng thật.', 'I will not pick them off; I will have them removed properly to protect my natural nails.'),
      agree('ack_reaction', 'Nếu bị ngứa, đỏ, sưng quanh móng, tôi sẽ báo tiệm và tháo ngay.', 'If I notice itching, redness or swelling around the nail I will tell the salon and have them removed.'),
      ...COMMON_ACKS,
    ],
  },
  {
    key: 'nail_record', trades: ['NAIL'], signer: 'staff', validMonths: 0,
    name: t('Phiếu kỹ thuật làm móng', 'Nail service record'),
    intro: t('Thợ ghi sau buổi làm — lần sau mở lại là làm y như cũ.', 'Filled in by the technician after the visit — so next time can match it.'),
    fields: [
      many('service', 'Đã làm', 'Done today', [o('acrylic', 'Bột (acrylic)', 'Acrylic'), o('gel', 'Gel', 'Gel'), o('dip', 'Dip', 'Dip powder'), o('gelx', 'Gel X / móng úp', 'Gel-X / soft gel tips'), o('builder', 'Builder gel', 'Builder gel'), o('polish', 'Sơn thường', 'Regular polish'), o('pedicure', 'Làm chân', 'Pedicure')], true),
      one('shape', 'Dáng móng', 'Shape', [o('square', 'Vuông', 'Square'), o('squoval', 'Vuông bo', 'Squoval'), o('round', 'Tròn', 'Round'), o('oval', 'Oval', 'Oval'), o('almond', 'Hạnh nhân', 'Almond'), o('coffin', 'Coffin / ballerina', 'Coffin'), o('stiletto', 'Nhọn', 'Stiletto')]),
      one('length', 'Độ dài', 'Length', [o('short', 'Ngắn', 'Short'), o('medium', 'Vừa', 'Medium'), o('long', 'Dài', 'Long'), o('xl', 'Rất dài', 'Extra long')]),
      txt('color', 'Mã màu / hãng', 'Colour code & brand'),
      txt('design', 'Hoạ tiết / đính đá', 'Design / art'),
      yes('reaction', 'Khách có dấu hiệu kích ứng hôm nay', 'Any sign of a reaction today', true, true),
      { id: 'note', type: 'text', label: t('Ghi chú thêm', 'Extra note') },
    ],
  },
  {
    key: 'lash_consent', trades: ['LASH'], signer: 'client', validMonths: 12,
    name: t('Phiếu sức khoẻ & cam kết nối mi', 'Lash extension health form & consent'),
    intro: t('Giúp kỹ thuật viên nối mi an toàn cho mắt bạn. Chỉ cần chạm để chọn.', 'Helps your lash artist keep your eyes safe. Just tap to answer.'),
    fields: [
      NAME, PHONE,
      sec('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
      yes('eye_surgery', 'Phẫu thuật mắt (mổ cận, LASIK…) trong 6 tháng qua', 'Eye surgery (LASIK etc.) in the last 6 months', true, true),
      yes('eye_condition', 'Bệnh về mắt: viêm kết mạc, khô mắt, chắp lẹo, tăng nhãn áp', 'An eye condition: pink eye, dry eye, styes, glaucoma', true, true),
      yes('contacts', 'Đeo kính áp tròng (vui lòng tháo ra trước khi làm)', 'Wear contact lenses (please take them out first)', false),
      yes('glue_allergy', 'Dị ứng keo nối mi (cyanoacrylate), latex, băng dính y tế hoặc formaldehyde', 'Allergic to lash glue (cyanoacrylate), latex, medical tape or formaldehyde', true, true),
      yes('past_reaction', 'Từng bị sưng, đỏ, ngứa mắt sau khi nối hoặc uốn mi', 'Ever had swelling, redness or itching after lashes or a lift', true, true),
      yes('sensitive', 'Mắt nhạy cảm, dễ chảy nước mắt hoặc hay dụi mắt', 'Sensitive or watery eyes, or rub your eyes often', true),
      yes('chemo', 'Đang hoá trị hoặc dùng thuốc làm rụng / yếu mi', 'Chemotherapy or medicine that thins your lashes', true, true),
      yes('pregnant', 'Đang mang thai', 'Pregnant', false),
      sec('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
      agree('ack_patch', 'Tôi được đề nghị thử keo (patch test) trước khi làm và tự quyết định có thử hay không.', 'I was offered a patch test before the service and made my own choice about it.'),
      agree('ack_eyes', 'Tôi sẽ nhắm mắt suốt buổi làm và báo ngay nếu thấy cay, rát.', 'I will keep my eyes closed throughout and say at once if they sting or burn.'),
      agree('ack_aftercare', 'Tránh nước, hơi nóng, xông hơi 24–48 giờ đầu; không dùng mỹ phẩm có dầu và không dụi, kéo mi.', 'I will avoid water, steam and sauna for 24–48 hours, avoid oil-based products, and not rub or pull my lashes.'),
      agree('ack_shed', 'Mi nối rụng theo mi thật; cần dặm lại sau 2–3 tuần. Tháo mi phải do kỹ thuật viên làm.', 'Extensions shed with my natural lashes and need a fill every 2–3 weeks. Removal must be done by a professional.'),
      agree('ack_reaction', 'Nếu mắt sưng, đỏ, ngứa sau khi làm, tôi sẽ báo tiệm và đi khám khi cần.', 'If my eyes swell, redden or itch afterwards I will tell the salon and see a doctor if needed.'),
      ...COMMON_ACKS,
    ],
  },
  {
    key: 'lash_record', trades: ['LASH'], signer: 'staff', validMonths: 0,
    name: t('Phiếu kỹ thuật nối mi', 'Lash map & record'),
    intro: t('Kỹ thuật viên ghi sau buổi làm — lần dặm sau làm đúng như cũ.', 'Filled in by the lash artist — so the next fill matches.'),
    fields: [
      one('set', 'Kiểu', 'Set', [o('classic', 'Classic', 'Classic'), o('hybrid', 'Hybrid', 'Hybrid'), o('volume', 'Volume', 'Volume'), o('mega', 'Mega volume', 'Mega volume'), o('wet', 'Wet look', 'Wet look'), o('fill', 'Dặm mi', 'Fill'), o('removal', 'Tháo mi', 'Removal')], true),
      many('curl', 'Độ cong', 'Curl', ['J', 'B', 'C', 'CC', 'D', 'DD', 'L', 'M'].map((x) => ({ id: x.toLowerCase(), label: t(x, x) }))),
      many('thickness', 'Độ dày (mm)', 'Thickness (mm)', ['0.03', '0.05', '0.07', '0.10', '0.12', '0.15', '0.20'].map((x) => ({ id: `t${x.replace('.', '')}`, label: t(x, x) }))),
      txt('lengths', 'Độ dài / bản đồ mi (vd 9-10-11-12-11)', 'Lengths / map (e.g. 9-10-11-12-11)'),
      txt('glue', 'Keo đã dùng', 'Adhesive used'),
      one('retention', 'Mi còn lại khi dặm', 'Retention at fill', [o('r80', 'Trên 80%', 'Over 80%'), o('r60', '60–80%', '60–80%'), o('r40', '40–60%', '40–60%'), o('r0', 'Dưới 40%', 'Under 40%')]),
      yes('reaction', 'Khách có dấu hiệu kích ứng hôm nay', 'Any sign of a reaction today', true, true),
      { id: 'note', type: 'text', label: t('Ghi chú thêm', 'Extra note') },
    ],
  },
  {
    key: 'lift_tint', trades: ['LASH', 'SPA'], signer: 'client', validMonths: 12,
    name: t('Cam kết uốn mi / nhuộm mi, mày', 'Lash lift, brow & tint consent'),
    intro: t('Dành cho uốn mi, ép mày (lamination) và nhuộm. Chỉ cần chạm để chọn.', 'For lash lifts, brow lamination and tinting. Just tap to answer.'),
    fields: [
      NAME, PHONE,
      sec('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
      yes('retinoid', 'Đang dùng Retinol, Retin-A hoặc Accutane (isotretinoin) trong 6 tháng', 'Using retinol, Retin-A or Accutane (isotretinoin) in the last 6 months', true, true),
      yes('dye_allergy', 'Dị ứng thuốc nhuộm (PPD), thuốc uốn hoặc từng phản ứng khi nhuộm tóc', 'Allergic to tint (PPD) or perm solution, or reacted to hair dye before', true, true),
      yes('eye_condition', 'Bệnh về mắt hoặc vừa phẫu thuật mắt', 'An eye condition or recent eye surgery', true, true),
      yes('skin', 'Da vùng mắt / mày đang trầy, viêm, chàm', 'Broken skin, irritation or eczema around the eyes or brows', true, true),
      yes('pregnant', 'Đang mang thai', 'Pregnant', false),
      sec('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
      agree('ack_result', 'Kết quả tuỳ vào mi / mày thật; độ cong và màu có thể khác nhau ở mỗi người.', 'Results depend on my natural hairs; curl and colour vary from person to person.'),
      agree('ack_aftercare', 'Tránh nước, hơi nóng và trang điểm vùng làm trong 24 giờ.', 'I will keep the area dry and avoid heat and make-up for 24 hours.'),
      ...COMMON_ACKS,
    ],
  },
  {
    key: 'waxing', trades: ['SPA', 'LASH', 'NAIL', 'SERVICE'], signer: 'client', validMonths: 12,
    name: t('Phiếu sức khoẻ & cam kết waxing', 'Waxing health form & consent'),
    intro: t('Giúp tiệm wax an toàn cho da bạn. Chỉ cần chạm để chọn.', 'Helps us wax safely for your skin. Just tap to answer.'),
    fields: [
      NAME, PHONE,
      sec('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
      yes('retinoid', 'Dùng Retinol, Retin-A, Accutane hoặc thuốc trị mụn trong 6 tháng', 'Retinol, Retin-A, Accutane or acne medication in the last 6 months', true, true),
      yes('procedure', 'Mới peel da, laser, chiếu sáng hoặc cháy nắng vùng cần wax', 'A recent peel, laser, IPL or sunburn on the area', true, true),
      yes('antibiotic', 'Đang dùng kháng sinh hoặc thuốc chống đông', 'Taking antibiotics or blood thinners', true, true),
      yes('skin', 'Da vùng wax có vết thương, mụn viêm, giãn tĩnh mạch, chàm', 'Cuts, inflamed spots, varicose veins or eczema on the area', true, true),
      yes('diabetes', 'Tiểu đường', 'Diabetes', true),
      yes('pregnant', 'Đang mang thai', 'Pregnant', false),
      sec('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
      agree('ack_effects', 'Da có thể đỏ, nổi mẩn hoặc lông mọc ngược sau khi wax; thường hết sau vài ngày.', 'Redness, bumps or ingrown hairs can follow waxing and usually settle in a few days.'),
      agree('ack_aftercare', 'Tránh nắng, xông hơi, bể bơi và chà xát vùng wax trong 24–48 giờ.', 'I will avoid sun, sauna, pools and scrubbing the area for 24–48 hours.'),
      ...COMMON_ACKS,
    ],
  },
  {
    key: 'facial', trades: ['SPA'], signer: 'client', validMonths: 12,
    name: t('Phiếu tư vấn da mặt', 'Facial consultation form'),
    intro: t('Giúp chuyên viên chọn đúng liệu trình cho da bạn.', 'Helps your esthetician choose the right treatment for your skin.'),
    fields: [
      NAME, PHONE,
      one('skin_type', 'Loại da của bạn', 'Your skin type', [o('dry', 'Khô', 'Dry'), o('oily', 'Dầu', 'Oily'), o('combo', 'Hỗn hợp', 'Combination'), o('normal', 'Thường', 'Normal'), o('sensitive', 'Nhạy cảm', 'Sensitive'), o('unsure', 'Không rõ', 'Not sure')]),
      many('concerns', 'Bạn muốn cải thiện', 'What you want to improve', [o('acne', 'Mụn', 'Acne'), o('pigment', 'Nám, thâm', 'Dark spots'), o('aging', 'Nếp nhăn', 'Fine lines'), o('pores', 'Lỗ chân lông', 'Pores'), o('dull', 'Da xỉn màu', 'Dullness'), o('dry', 'Thiếu ẩm', 'Dryness'), o('relax', 'Thư giãn', 'Relaxation')]),
      sec('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
      yes('retinoid', 'Đang dùng Retinol, Retin-A hoặc Accutane', 'Using retinol, Retin-A or Accutane', true, true),
      yes('procedure', 'Tiêm botox / filler, laser hoặc peel trong 4 tuần', 'Botox, filler, laser or a peel in the last 4 weeks', true, true),
      yes('allergy', 'Dị ứng mỹ phẩm, tinh dầu, hạt hoặc latex', 'Allergic to skincare, essential oils, nuts or latex', true, true),
      yes('sunburn', 'Da đang cháy nắng hoặc kích ứng', 'Sunburn or irritated skin right now', true),
      yes('pregnant', 'Đang mang thai hoặc cho con bú', 'Pregnant or breastfeeding', true),
      sec('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
      agree('ack_effects', 'Da có thể hơi đỏ hoặc châm chích sau liệu trình.', 'My skin may be slightly red or tingle after the treatment.'),
      ...COMMON_ACKS,
    ],
  },
  {
    key: 'visit_record', trades: ['NAIL', 'LASH', 'SPA', 'MASSAGE', 'HAIR', 'SERVICE'], signer: 'staff', validMonths: 0,
    name: t('Ghi chú buổi làm', 'Visit record'),
    intro: t('Thợ ghi nhanh sau buổi làm.', 'A quick note by the technician after the visit.'),
    fields: [
      txt('done', 'Đã làm gì', 'What was done', false),
      txt('products', 'Sản phẩm / màu đã dùng', 'Products or colours used'),
      yes('reaction', 'Khách có dấu hiệu kích ứng', 'Any sign of a reaction', true, true),
      txt('advice', 'Dặn khách', 'Advice given', false),
      one('next', 'Hẹn lại', 'Come back in', [o('1w', '1 tuần', '1 week'), o('2w', '2 tuần', '2 weeks'), o('3w', '3 tuần', '3 weeks'), o('1m', '1 tháng', '1 month'), o('asneeded', 'Khi cần', 'As needed')]),
    ],
  },
];

const pick = (x: Tx, lang: FormLang) => (lang === 'vi' ? x.vi : x.en) || x.en || x.vi;

/** The starters, named in the salon's language, the ones for its own trade first. */
export function starterList(lang: FormLang, industry?: string | null): { key: string; name: string; intro: string; signer: 'client' | 'staff'; suggested: boolean }[] {
  const trade = String(industry ?? '').toUpperCase();
  return STARTERS
    .map((s) => ({ key: s.key, name: pick(s.name, lang), intro: pick(s.intro, lang), signer: s.signer, suggested: s.trades.includes(trade) }))
    .sort((a, b) => Number(b.suggested) - Number(a.suggested));
}

/** A new form from a starter (or a blank one), written in the salon's language. */
export function starterForm(key: string | null | undefined, kind: CustomKind, lang: FormLang): CustomForm {
  const s = STARTERS.find((x) => x.key === key);
  if (!s) {
    return sanitizeCustomForm({
      name: lang === 'vi' ? 'Biểu mẫu mới' : 'New form', intro: '', signer: 'client', validMonths: 12,
      fields: [{ id: 'name', type: 'text', label: lang === 'vi' ? 'Họ tên' : 'Full name', required: true, prefill: 'name', short: true }],
    }, null, kind, lang);
  }
  return sanitizeCustomForm({
    name: pick(s.name, lang), intro: pick(s.intro, lang), signer: s.signer, validMonths: s.validMonths, starter: s.key,
    fields: s.fields.map((f) => ({ ...f, label: pick(f.label, lang), options: f.options?.map((x) => ({ id: x.id, label: pick(x.label, lang) })) })),
  }, null, kind, lang);
}
