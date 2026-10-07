/**
 * THE RECORD EACH LINE OF BUSINESS KEEPS ON A CUSTOMER.
 *
 * A nail salon, a dental clinic, a real-estate office and a restaurant all
 * keep "customers", but what they write down differs: allergies and treatment
 * history, a lead's stage and budget, dietary needs and the favourite table, a
 * lash map. One JSON column per customer (Customer.industryFields), and per
 * industry the list of fields below — the screen draws from it and the server
 * drops anything not on it, so one salon's form can never write fields that do
 * not belong to its trade. Pure.
 */

export type FieldType = 'text' | 'longtext' | 'select' | 'date' | 'number';
export interface FieldDef { key: string; type: FieldType; vi: string; en: string; options?: { value: string; vi: string; en: string }[]; warn?: boolean }
export interface FieldSet { title: { vi: string; en: string }; fields: FieldDef[]; pipeline?: string }

const opt = (value: string, vi: string, en: string) => ({ value, vi, en });

const BEAUTY_SENSITIVE: FieldDef = { key: 'allergies', type: 'text', vi: 'Dị ứng / da nhạy cảm', en: 'Allergies / sensitivities', warn: true };

export const INDUSTRY_FIELDS: Record<string, FieldSet> = {
  NAIL: { title: { vi: 'Hồ sơ móng', en: 'Nail record' }, fields: [
    BEAUTY_SENSITIVE,
    { key: 'nailShape', type: 'select', vi: 'Dáng móng hay làm', en: 'Usual shape', options: [opt('square', 'Vuông', 'Square'), opt('round', 'Tròn', 'Round'), opt('oval', 'Oval', 'Oval'), opt('almond', 'Hạnh nhân', 'Almond'), opt('coffin', 'Coffin', 'Coffin'), opt('stiletto', 'Nhọn', 'Stiletto')] },
    { key: 'colors', type: 'text', vi: 'Màu / mã sơn hay dùng', en: 'Favourite colours / codes' },
  ] },
  LASH: { title: { vi: 'Hồ sơ mi', en: 'Lash record' }, fields: [
    BEAUTY_SENSITIVE,
    { key: 'lashMap', type: 'text', vi: 'Kiểu mi (độ cong · độ dài · độ dày)', en: 'Lash map (curl · length · thickness)' },
    { key: 'glue', type: 'text', vi: 'Loại keo dùng', en: 'Adhesive used' },
    { key: 'lastPatchTest', type: 'date', vi: 'Ngày thử dị ứng gần nhất', en: 'Last patch test' },
  ] },
  HAIR: { title: { vi: 'Hồ sơ tóc', en: 'Hair record' }, fields: [
    BEAUTY_SENSITIVE,
    { key: 'colorFormula', type: 'longtext', vi: 'Công thức màu nhuộm', en: 'Colour formula' },
    { key: 'hairType', type: 'text', vi: 'Chất tóc', en: 'Hair type' },
  ] },
  SPA: { title: { vi: 'Hồ sơ spa', en: 'Spa record' }, fields: [
    BEAUTY_SENSITIVE,
    { key: 'health', type: 'longtext', vi: 'Lưu ý sức khoẻ (mang thai, huyết áp…)', en: 'Health notes (pregnancy, blood pressure…)', warn: true },
    { key: 'pressure', type: 'select', vi: 'Lực massage', en: 'Pressure', options: [opt('light', 'Nhẹ', 'Light'), opt('medium', 'Vừa', 'Medium'), opt('firm', 'Mạnh', 'Firm')] },
    { key: 'skinType', type: 'text', vi: 'Loại da', en: 'Skin type' },
  ] },
  MASSAGE: { title: { vi: 'Hồ sơ massage', en: 'Massage record' }, fields: [
    { key: 'health', type: 'longtext', vi: 'Lưu ý sức khoẻ (chấn thương, mang thai, huyết áp…)', en: 'Health notes (injuries, pregnancy, blood pressure…)', warn: true },
    { key: 'pressure', type: 'select', vi: 'Lực massage', en: 'Pressure', options: [opt('light', 'Nhẹ', 'Light'), opt('medium', 'Vừa', 'Medium'), opt('firm', 'Mạnh', 'Firm')] },
    { key: 'focus', type: 'text', vi: 'Vùng cần tập trung / tránh', en: 'Focus / avoid areas' },
  ] },
  DENTAL: { title: { vi: 'Hồ sơ bệnh nhân', en: 'Patient record' }, fields: [
    { key: 'allergies', type: 'text', vi: 'Dị ứng (thuốc, thuốc tê, latex…)', en: 'Allergies (drugs, anaesthetic, latex…)', warn: true },
    { key: 'medical', type: 'longtext', vi: 'Tiền sử bệnh / thuốc đang dùng', en: 'Medical history / current medication', warn: true },
    { key: 'insurance', type: 'text', vi: 'Bảo hiểm', en: 'Insurance' },
    { key: 'lastXray', type: 'date', vi: 'Ngày chụp X-quang gần nhất', en: 'Last X-ray' },
    { key: 'treatmentPlan', type: 'longtext', vi: 'Kế hoạch điều trị', en: 'Treatment plan' },
    { key: 'recallMonths', type: 'number', vi: 'Tái khám định kỳ (tháng)', en: 'Recall every (months)' },
  ] },
  RESTAURANT: { title: { vi: 'Ghi chú khách', en: 'Guest notes' }, fields: [
    { key: 'dietary', type: 'text', vi: 'Dị ứng / ăn kiêng', en: 'Allergies / dietary', warn: true },
    { key: 'seating', type: 'text', vi: 'Chỗ ngồi yêu thích', en: 'Seating preference' },
    { key: 'occasion', type: 'text', vi: 'Dịp đặc biệt (sinh nhật, kỷ niệm…)', en: 'Special occasion' },
    { key: 'usualParty', type: 'number', vi: 'Số người hay đi', en: 'Usual party size' },
  ] },
  REAL_ESTATE: { pipeline: 'stage', title: { vi: 'Khách tiềm năng', en: 'Lead' }, fields: [
    { key: 'stage', type: 'select', vi: 'Giai đoạn', en: 'Stage', options: [opt('new', 'Mới', 'New'), opt('contacted', 'Đã liên hệ', 'Contacted'), opt('viewing', 'Đang xem nhà', 'Viewing'), opt('negotiating', 'Đàm phán', 'Negotiating'), opt('won', 'Đã chốt', 'Closed — won'), opt('lost', 'Ngừng', 'Closed — lost')] },
    { key: 'intent', type: 'select', vi: 'Nhu cầu', en: 'Looking to', options: [opt('buy', 'Mua', 'Buy'), opt('sell', 'Bán', 'Sell'), opt('rent', 'Thuê', 'Rent'), opt('lease', 'Cho thuê', 'Lease out')] },
    { key: 'budget', type: 'text', vi: 'Ngân sách', en: 'Budget' },
    { key: 'area', type: 'text', vi: 'Khu vực quan tâm', en: 'Area of interest' },
    { key: 'propertyType', type: 'text', vi: 'Loại BĐS', en: 'Property type' },
    { key: 'timeline', type: 'text', vi: 'Thời gian dự kiến', en: 'Timeline' },
    { key: 'nextStep', type: 'date', vi: 'Hẹn liên hệ lại', en: 'Next follow-up' },
  ] },
  SERVICE: { title: { vi: 'Ghi chú khách', en: 'Client notes' }, fields: [
    { key: 'address', type: 'text', vi: 'Địa chỉ làm dịch vụ', en: 'Service address' },
    { key: 'details', type: 'longtext', vi: 'Thông tin cần nhớ', en: 'Things to remember' },
  ] },
};
INDUSTRY_FIELDS.FAST_FOOD = INDUSTRY_FIELDS.RESTAURANT;
INDUSTRY_FIELDS.CAFE = INDUSTRY_FIELDS.RESTAURANT;

export function fieldsFor(industry: string | null | undefined): FieldSet {
  return INDUSTRY_FIELDS[String(industry ?? '').toUpperCase()] ?? INDUSTRY_FIELDS.NAIL;
}

/**
 * Merge an edit into the stored record. Only the industry's own keys; text
 * trimmed and capped; a select must be one of its options; a date YYYY-MM-DD;
 * a number 0–999. An empty value clears that key. Keys of OTHER industries
 * already stored are kept — switching the salon's industry loses nothing.
 */
export function cleanIndustryFields(industry: string, patch: unknown, current: unknown): Record<string, string | number> {
  const cur = (current && typeof current === 'object' && !Array.isArray(current) ? current : {}) as Record<string, string | number>;
  const out: Record<string, string | number> = { ...cur };
  const p = (patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) as Record<string, unknown>;
  for (const f of fieldsFor(industry).fields) {
    if (!(f.key in p)) continue;
    const raw = p[f.key];
    if (raw === null || raw === undefined || String(raw).trim() === '') { delete out[f.key]; continue; }
    if (f.type === 'number') {
      const n = Math.round(Number(raw));
      if (Number.isFinite(n) && n >= 0 && n <= 999) out[f.key] = n;
      continue;
    }
    const v = String(raw).trim();
    if (f.type === 'select') { if (f.options?.some((o) => o.value === v)) out[f.key] = v; continue; }
    if (f.type === 'date') { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) out[f.key] = v; continue; }
    out[f.key] = v.slice(0, f.type === 'longtext' ? 2000 : 300);
  }
  return out;
}

/** The fields to flag on screen (allergies, health) that have something written. */
export function warnings(industry: string, values: unknown): { label: { vi: string; en: string }; value: string }[] {
  const v = (values && typeof values === 'object' ? values : {}) as Record<string, unknown>;
  return fieldsFor(industry).fields.filter((f) => f.warn && String(v[f.key] ?? '').trim()).map((f) => ({ label: { vi: f.vi, en: f.en }, value: String(v[f.key]) }));
}
