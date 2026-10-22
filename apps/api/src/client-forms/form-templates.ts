/**
 * MASSAGE / SPA PAPERWORK — the forms themselves.
 *
 * Four built-in forms, written once in code so every salon starts with a
 * complete, sensible set and nobody has to design a form:
 *
 *   intake     — the client's health questionnaire, once a year (setting)
 *   cupping    — consent before cupping
 *   hot_stone  — consent before hot stone
 *   soap       — the therapist's note after the session (S/O/A/P)
 *
 * Almost everything is a tap: yes/no, chips, a body map, a 0–10 scale and
 * "I understand" ticks in place of the paper version's initials. Text boxes
 * are optional extras.
 *
 * Each form is bilingual and versioned. What the client actually saw is
 * frozen into the entry as a snapshot (resolveTemplate), so a signed form
 * reads the same years later even after the wording here changes.
 *
 * Pure: no database, no clock (tested in form-templates.spec.ts).
 */

export type FormKind = 'intake' | 'cupping' | 'hot_stone' | 'soap';
export type ConsentKind = 'cupping' | 'hot_stone';
export type FormLang = 'vi' | 'en';
/** What a "yes" is a caution for: any session ('massage' — the name predates nails), or one of the consent treatments. */
export type FlagTarget = 'massage' | ConsentKind;
/** Which intake the salon hands out: the massage one, the nail one, or a general one for any other service. */
export type IntakeStyle = 'massage' | 'nail' | 'general';
export const INTAKE_STYLES: IntakeStyle[] = ['massage', 'nail', 'general'];

export const FORM_KINDS: FormKind[] = ['intake', 'cupping', 'hot_stone', 'soap'];
export const CONSENT_KINDS: ConsentKind[] = ['cupping', 'hot_stone'];
export const CLIENT_KINDS: FormKind[] = ['intake', 'cupping', 'hot_stone'];

export const isFormKind = (k: unknown): k is FormKind => typeof k === 'string' && (FORM_KINDS as string[]).includes(k);
export const isConsentKind = (k: unknown): k is ConsentKind => typeof k === 'string' && (CONSENT_KINDS as string[]).includes(k);

export interface Tx { vi: string; en: string }
const t = (vi: string, en: string): Tx => ({ vi, en });

export type FieldType = 'section' | 'note' | 'yesno' | 'choice' | 'multi' | 'text' | 'bodymap' | 'scale' | 'ack';

export interface FormField {
  id: string;
  type: FieldType;
  label: Tx;
  required?: boolean;
  options?: { id: string; label: Tx }[];
  /** yes/no: a "yes" is a caution for these (red flag for the therapist). */
  flags?: FlagTarget[];
  /** yes/no: ask for a few words when the answer is yes. */
  detail?: boolean;
  min?: number;
  max?: number;
  /** text: filled from the client record. */
  prefill?: 'name' | 'phone' | 'email' | 'birthDate';
  short?: boolean;
}

export interface FormTemplate {
  kind: FormKind;
  version: number;
  title: Tx;
  intro?: Tx;
  /** Who signs: the client, or the therapist (SOAP). */
  signer: 'client' | 'staff';
  fields: FormField[];
}

/** One field as it was shown, in one language — the shape stored with every entry. */
export interface ResolvedField {
  id: string; type: FieldType; label: string; required?: boolean;
  options?: { id: string; label: string }[];
  flags?: FlagTarget[]; detail?: boolean; min?: number; max?: number;
  prefill?: FormField['prefill']; short?: boolean;
}
export interface ResolvedTemplate {
  kind: FormKind; version: number; lang: FormLang; title: string; intro?: string;
  signer: 'client' | 'staff'; fields: ResolvedField[];
  /** The body map's areas, so a viewer can name them without the code. */
  areas: { id: string; label: string; side: 'front' | 'back' }[];
}

// ---------------------------------------------------------------- body map

export const BODY_AREAS: { id: string; label: Tx; side: 'front' | 'back' }[] = [
  { id: 'head', label: t('Đầu / mặt', 'Head / face'), side: 'front' },
  { id: 'neck_front', label: t('Cổ (trước)', 'Neck (front)'), side: 'front' },
  { id: 'chest', label: t('Ngực', 'Chest'), side: 'front' },
  { id: 'abdomen', label: t('Bụng', 'Abdomen'), side: 'front' },
  { id: 'arm_l', label: t('Tay trái', 'Left arm'), side: 'front' },
  { id: 'arm_r', label: t('Tay phải', 'Right arm'), side: 'front' },
  { id: 'hand_l', label: t('Bàn tay trái', 'Left hand'), side: 'front' },
  { id: 'hand_r', label: t('Bàn tay phải', 'Right hand'), side: 'front' },
  { id: 'hip_front', label: t('Hông (trước)', 'Hips (front)'), side: 'front' },
  { id: 'thigh_l', label: t('Đùi trái (trước)', 'Left thigh (front)'), side: 'front' },
  { id: 'thigh_r', label: t('Đùi phải (trước)', 'Right thigh (front)'), side: 'front' },
  { id: 'knee_l', label: t('Gối trái', 'Left knee'), side: 'front' },
  { id: 'knee_r', label: t('Gối phải', 'Right knee'), side: 'front' },
  { id: 'shin_l', label: t('Cẳng chân trái', 'Left shin'), side: 'front' },
  { id: 'shin_r', label: t('Cẳng chân phải', 'Right shin'), side: 'front' },
  { id: 'foot_l', label: t('Bàn chân trái', 'Left foot'), side: 'front' },
  { id: 'foot_r', label: t('Bàn chân phải', 'Right foot'), side: 'front' },
  { id: 'neck', label: t('Cổ / gáy', 'Neck'), side: 'back' },
  { id: 'shoulder_l', label: t('Vai trái', 'Left shoulder'), side: 'back' },
  { id: 'shoulder_r', label: t('Vai phải', 'Right shoulder'), side: 'back' },
  { id: 'upper_back', label: t('Lưng trên', 'Upper back'), side: 'back' },
  { id: 'mid_back', label: t('Lưng giữa', 'Mid back'), side: 'back' },
  { id: 'lower_back', label: t('Lưng dưới', 'Lower back'), side: 'back' },
  { id: 'glutes', label: t('Mông', 'Glutes'), side: 'back' },
  { id: 'hamstring_l', label: t('Đùi sau trái', 'Left hamstring'), side: 'back' },
  { id: 'hamstring_r', label: t('Đùi sau phải', 'Right hamstring'), side: 'back' },
  { id: 'calf_l', label: t('Bắp chân trái', 'Left calf'), side: 'back' },
  { id: 'calf_r', label: t('Bắp chân phải', 'Right calf'), side: 'back' },
];
const AREA_IDS = new Set(BODY_AREAS.map((a) => a.id));

// ---------------------------------------------------------------- the forms

const opt = (id: string, vi: string, en: string) => ({ id, label: t(vi, en) });
const yn = (id: string, vi: string, en: string, flags: FlagTarget[] = [], detail = false): FormField => ({ id, type: 'yesno', label: t(vi, en), flags, detail, required: true });
const ack = (id: string, vi: string, en: string): FormField => ({ id, type: 'ack', label: t(vi, en), required: true });
const section = (id: string, vi: string, en: string): FormField => ({ id, type: 'section', label: t(vi, en) });

const PRESSURE = [opt('light', 'Nhẹ', 'Light'), opt('medium', 'Vừa', 'Medium'), opt('firm', 'Mạnh', 'Firm')];

const INTAKE: FormTemplate = {
  kind: 'intake',
  version: 1,
  title: t('Phiếu thông tin khách hàng', 'Client intake form'),
  intro: t(
    'Giúp kỹ thuật viên chăm sóc bạn an toàn. Chỉ cần chạm để chọn — mất khoảng 1 phút.',
    'Helps your therapist care for you safely. Just tap to answer — about a minute.',
  ),
  signer: 'client',
  fields: [
    section('s_contact', 'Thông tin liên hệ', 'Contact'),
    { id: 'name', type: 'text', label: t('Họ tên', 'Full name'), required: true, prefill: 'name', short: true },
    { id: 'phone', type: 'text', label: t('Số điện thoại', 'Phone'), prefill: 'phone', short: true },
    { id: 'email', type: 'text', label: t('Email', 'Email'), prefill: 'email', short: true },
    { id: 'birth_date', type: 'text', label: t('Ngày sinh', 'Date of birth'), prefill: 'birthDate', short: true },
    { id: 'emergency', type: 'text', label: t('Người liên hệ khẩn cấp (tên, SĐT)', 'Emergency contact (name, phone)'), short: true },

    section('s_health', 'Bạn đang có hoặc từng có tình trạng nào sau đây?', 'Do you have, or have you had, any of the following?'),
    yn('high_bp', 'Huyết áp cao / thấp', 'High or low blood pressure', ['cupping', 'hot_stone']),
    yn('heart', 'Bệnh tim, máy tạo nhịp', 'Heart condition or pacemaker', ['massage', 'cupping', 'hot_stone'], true),
    yn('diabetes', 'Tiểu đường', 'Diabetes', ['cupping', 'hot_stone']),
    yn('blood_thinners', 'Đang dùng thuốc chống đông máu', 'Taking blood thinners', ['massage', 'cupping']),
    yn('bleeding', 'Rối loạn đông máu, dễ bầm tím', 'Bleeding disorder or bruise easily', ['cupping']),
    yn('varicose', 'Giãn tĩnh mạch, huyết khối (cục máu đông)', 'Varicose veins or blood clots', ['massage', 'cupping', 'hot_stone'], true),
    yn('skin', 'Da trầy xước, phát ban, cháy nắng, nhiễm trùng da', 'Broken skin, rash, sunburn or skin infection', ['massage', 'cupping', 'hot_stone'], true),
    yn('recent_surgery', 'Phẫu thuật trong 6 tháng gần đây', 'Surgery in the last 6 months', ['massage'], true),
    yn('joint_replacement', 'Thay khớp, nẹp vít, cấy ghép', 'Joint replacement, pins or implants', ['massage'], true),
    yn('recent_injury', 'Chấn thương gần đây (bong gân, căng cơ, gãy xương)', 'Recent injury (sprain, strain, fracture)', ['massage'], true),
    yn('cancer', 'Ung thư / đang điều trị', 'Cancer or current treatment', ['massage'], true),
    yn('pregnant', 'Đang mang thai', 'Pregnant', ['massage', 'cupping', 'hot_stone'], true),
    yn('epilepsy', 'Động kinh, co giật', 'Epilepsy or seizures', ['massage']),
    yn('numbness', 'Tê bì, giảm cảm giác', 'Numbness or reduced sensation', ['massage', 'hot_stone'], true),
    yn('osteoporosis', 'Loãng xương', 'Osteoporosis', ['massage']),
    yn('arthritis', 'Viêm khớp', 'Arthritis', []),
    yn('headaches', 'Đau đầu thường xuyên, đau nửa đầu', 'Frequent headaches or migraines', []),
    yn('contagious', 'Đang sốt, cảm cúm, bệnh truyền nhiễm', 'Fever, cold, flu or anything contagious', ['massage']),
    yn('medications', 'Đang dùng thuốc', 'Taking any medication', [], true),
    yn('allergies', 'Dị ứng (dầu, kem, hạt, mùi hương…)', 'Allergies (oils, lotions, nuts, scents…)', ['massage'], true),

    section('s_visit', 'Buổi massage hôm nay', 'Today\'s massage'),
    yn('prior_massage', 'Bạn từng massage chuyên nghiệp chưa?', 'Have you had a professional massage before?'),
    {
      id: 'reason', type: 'multi', label: t('Bạn đến vì', 'Why are you here?'),
      options: [
        opt('relax', 'Thư giãn', 'Relaxation'), opt('pain', 'Giảm đau', 'Pain relief'), opt('stress', 'Giảm căng thẳng', 'Stress'),
        opt('injury', 'Phục hồi chấn thương', 'Injury recovery'), opt('sports', 'Thể thao', 'Sports'), opt('posture', 'Tư thế / ngồi nhiều', 'Posture / desk work'),
      ],
    },
    { id: 'focus', type: 'bodymap', label: t('Vùng muốn tập trung', 'Areas to focus on') },
    { id: 'avoid', type: 'bodymap', label: t('Vùng cần tránh', 'Areas to avoid') },
    { id: 'pressure', type: 'choice', label: t('Lực massage mong muốn', 'Preferred pressure'), options: PRESSURE },

    section('s_ack', 'Xác nhận', 'Acknowledgement'),
    ack('ack_true', 'Thông tin trên là đúng và đầy đủ.', 'The information above is true and complete.'),
    ack('ack_update', 'Tôi sẽ báo cho tiệm khi sức khoẻ của tôi thay đổi.', 'I will tell the salon if my health changes.'),
    ack('ack_medical', 'Massage không thay thế chẩn đoán hay điều trị y khoa.', 'Massage is not a substitute for medical diagnosis or treatment.'),
    ack('ack_stop', 'Tôi có thể yêu cầu dừng hoặc đổi lực bất cứ lúc nào.', 'I can ask to stop or change pressure at any time.'),
    ack('ack_conduct', 'Buổi massage hoàn toàn mang tính chuyên nghiệp, trị liệu.', 'The session is strictly professional and therapeutic.'),
  ],
};

const NAIL_INTAKE: FormTemplate = {
  kind: 'intake',
  version: 1,
  title: t('Phiếu sức khoẻ & cam kết làm móng', 'Nail service health form & release'),
  intro: t(
    'Giúp thợ làm móng an toàn cho bạn. Chỉ cần chạm để chọn — khoảng 1 phút.',
    'Helps your technician work safely. Just tap to answer — about a minute.',
  ),
  signer: 'client',
  fields: [
    section('s_contact', 'Thông tin liên hệ', 'Contact'),
    { id: 'name', type: 'text', label: t('Họ tên', 'Full name'), required: true, prefill: 'name', short: true },
    { id: 'phone', type: 'text', label: t('Số điện thoại', 'Phone'), prefill: 'phone', short: true },
    { id: 'email', type: 'text', label: t('Email', 'Email'), prefill: 'email', short: true },

    section('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
    yn('n_diabetes', 'Tiểu đường', 'Diabetes', ['massage']),
    yn('n_circulation', 'Rối loạn tuần hoàn, dễ bầm, đang dùng thuốc chống đông', 'Poor circulation, bruise easily, or taking blood thinners', ['massage'], true),
    yn('n_neuropathy', 'Tê bì tay chân, giảm cảm giác', 'Numbness or reduced feeling in hands or feet', ['massage']),
    yn('n_fungus', 'Nấm móng, móng nhiễm trùng, sưng đỏ quanh móng', 'Nail fungus, infected nails, or redness/swelling around a nail', ['massage'], true),
    yn('n_wounds', 'Vết thương hở, trầy xước, mụn nước ở tay hoặc chân', 'Open cuts, scrapes or blisters on hands or feet', ['massage'], true),
    yn('n_skin', 'Bệnh da ở tay chân (chàm, vảy nến, viêm da)', 'Skin condition on hands or feet (eczema, psoriasis, dermatitis)', ['massage'], true),
    yn('n_allergy_products', 'Dị ứng gel, acrylic, keo dán móng, latex hoặc nước tẩy (acetone)', 'Allergic to gel, acrylic, nail glue, latex or remover (acetone)', ['massage'], true),
    yn('n_allergy_other', 'Dị ứng khác (kem, tinh dầu, hạt, mùi hương…)', 'Other allergies (lotions, oils, nuts, scents…)', ['massage'], true),
    yn('n_pregnant', 'Đang mang thai', 'Pregnant', ['massage']),
    yn('n_shaved', 'Mới cạo lông chân trong 24 giờ (khi làm chân)', 'Shaved your legs in the last 24 hours (for pedicures)', []),
    yn('n_medications', 'Đang dùng thuốc (kháng sinh, thuốc bôi da…)', 'Taking any medication (antibiotics, skin creams…)', [], true),
    yn('n_contagious', 'Đang sốt, cảm cúm hoặc bệnh truyền nhiễm', 'Fever, cold, flu or anything contagious', ['massage']),

    section('s_visit', 'Tuỳ chọn của bạn', 'Your preferences'),
    {
      id: 'cuticle', type: 'choice', label: t('Da quanh móng (biểu bì)', 'Cuticles'),
      options: [opt('cut', 'Cắt da', 'Trim them'), opt('push', 'Chỉ đẩy da', 'Push back only'), opt('none', 'Không đụng tới', 'Leave them')],
    },

    section('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
    ack('ack_true', 'Thông tin trên là đúng và đầy đủ.', 'The information above is true and complete.'),
    ack('ack_update', 'Tôi sẽ báo cho tiệm khi sức khoẻ của tôi thay đổi.', 'I will tell the salon if my health changes.'),
    ack('ack_risk', 'Làm móng có thể gây đỏ, rát, dị ứng hoặc nhiễm trùng nhẹ, nhất là khi da hoặc móng đang có vấn đề.', 'Nail services can cause redness, stinging, allergic reactions or minor infection, especially on skin or nails that already have a problem.'),
    ack('ack_enhance', 'Móng gel / acrylic cần tháo đúng cách; tự cạy gỡ có thể làm hỏng móng thật.', 'Gel or acrylic must be removed properly; picking it off can damage the natural nail.'),
    ack('ack_stop', 'Tôi có thể yêu cầu dừng hoặc đổi cách làm bất cứ lúc nào.', 'I can ask to stop or change anything at any time.'),
    ack('ack_release', 'Tôi tự nguyện sử dụng dịch vụ và miễn trách nhiệm cho tiệm với phản ứng do tình trạng tôi không khai.', 'I choose to receive the service and release the salon from liability for reactions caused by conditions I did not disclose.'),
  ],
};

const GENERAL_INTAKE: FormTemplate = {
  kind: 'intake',
  version: 1,
  title: t('Phiếu sức khoẻ & cam kết sử dụng dịch vụ', 'Health form & service release'),
  intro: t(
    'Giúp tiệm phục vụ bạn an toàn. Chỉ cần chạm để chọn — khoảng 1 phút.',
    'Helps us serve you safely. Just tap to answer — about a minute.',
  ),
  signer: 'client',
  fields: [
    section('s_contact', 'Thông tin liên hệ', 'Contact'),
    { id: 'name', type: 'text', label: t('Họ tên', 'Full name'), required: true, prefill: 'name', short: true },
    { id: 'phone', type: 'text', label: t('Số điện thoại', 'Phone'), prefill: 'phone', short: true },
    { id: 'email', type: 'text', label: t('Email', 'Email'), prefill: 'email', short: true },
    { id: 'birth_date', type: 'text', label: t('Ngày sinh', 'Date of birth'), prefill: 'birthDate', short: true },

    section('s_health', 'Bạn có tình trạng nào sau đây không?', 'Does any of this apply to you?'),
    yn('g_allergies', 'Dị ứng (thuốc, hoá chất, mỹ phẩm, latex, hạt…)', 'Allergies (medicine, chemicals, cosmetics, latex, nuts…)', ['massage'], true),
    yn('g_skin', 'Da nhạy cảm, vết thương hở, phát ban hoặc bệnh da', 'Sensitive skin, open wounds, rash or a skin condition', ['massage'], true),
    yn('g_recent_procedure', 'Mới điều trị / thẩm mỹ trong 4 tuần (laser, peel, tiêm, phẫu thuật)', 'A treatment or procedure in the last 4 weeks (laser, peel, injections, surgery)', ['massage'], true),
    yn('g_pregnant', 'Đang mang thai', 'Pregnant', ['massage']),
    yn('g_conditions', 'Bệnh mãn tính (tim mạch, tiểu đường, huyết áp, động kinh…)', 'A long-term condition (heart, diabetes, blood pressure, epilepsy…)', ['massage'], true),
    yn('g_medications', 'Đang dùng thuốc', 'Taking any medication', [], true),
    yn('g_contagious', 'Đang sốt, cảm cúm hoặc bệnh truyền nhiễm', 'Fever, cold, flu or anything contagious', ['massage']),

    section('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
    ack('ack_true', 'Thông tin trên là đúng và đầy đủ.', 'The information above is true and complete.'),
    ack('ack_update', 'Tôi sẽ báo cho tiệm khi sức khoẻ của tôi thay đổi.', 'I will tell the business if my health changes.'),
    ack('ack_risk', 'Tôi đã được giải thích dịch vụ và các rủi ro có thể có.', 'The service and its possible risks were explained to me.'),
    ack('ack_stop', 'Tôi có thể yêu cầu dừng bất cứ lúc nào.', 'I can ask to stop at any time.'),
    ack('ack_release', 'Tôi tự nguyện sử dụng dịch vụ và miễn trách nhiệm cho tiệm với phản ứng do tình trạng tôi không khai.', 'I choose to receive the service and release the business from liability for reactions caused by conditions I did not disclose.'),
  ],
};

const CUPPING: FormTemplate = {
  kind: 'cupping',
  version: 1,
  title: t('Cam kết đồng ý giác hơi', 'Cupping consent & release'),
  intro: t(
    'Giác hơi dùng cốc hút trên da để kéo mô lên và tăng tuần hoàn máu.',
    'Cupping uses suction cups on the skin to lift tissue and increase circulation.',
  ),
  signer: 'client',
  fields: [
    section('s_today', 'Hôm nay bạn có tình trạng nào sau đây không?', 'Does any of this apply to you today?'),
    yn('c_pregnant', 'Đang mang thai', 'Pregnant', ['cupping']),
    yn('c_thinners', 'Dùng thuốc chống đông máu', 'Taking blood thinners', ['cupping']),
    yn('c_bleeding', 'Rối loạn đông máu, dễ bầm', 'Bleeding disorder or bruise easily', ['cupping']),
    yn('c_skin', 'Da trầy, phát ban, cháy nắng, giãn tĩnh mạch ở vùng giác', 'Broken skin, rash, sunburn or varicose veins where cups go', ['cupping'], true),
    yn('c_surgery', 'Mới phẫu thuật', 'Recent surgery', ['cupping'], true),
    yn('c_fever', 'Đang sốt, ốm', 'Fever or feeling unwell', ['cupping']),
    yn('c_heart', 'Bệnh tim, máy tạo nhịp', 'Heart condition or pacemaker', ['cupping']),
    yn('c_diabetes', 'Tiểu đường', 'Diabetes', ['cupping']),

    section('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
    ack('c_marks', 'Giác hơi có thể để lại vết tròn đỏ/tím, thường mất sau vài ngày đến khoảng 2 tuần.', 'Cupping may leave round red or purple marks that usually fade in a few days to about 2 weeks.'),
    ack('c_feel', 'Có thể thấy căng, ấm hoặc hơi đau; hiếm khi bầm hoặc phồng rộp.', 'I may feel tightness, warmth or mild soreness; rarely bruising or blistering.'),
    ack('c_explained', 'Tôi đã được giải thích cách làm, lợi ích, rủi ro và được hỏi lại.', 'The procedure, benefits and risks were explained and I could ask questions.'),
    ack('c_disclosed', 'Tôi đã khai đủ tình trạng sức khoẻ và thuốc đang dùng.', 'I have told my therapist about all my health conditions and medication.'),
    ack('c_stop', 'Tôi có thể yêu cầu dừng bất cứ lúc nào.', 'I can ask the therapist to stop at any time.'),
    ack('c_aftercare', 'Tôi sẽ uống nhiều nước, giữ ấm, tránh tắm nóng/xông hơi, tập nặng vài giờ sau.', 'I will drink water, keep warm and avoid hot baths, sauna or hard exercise for a few hours.'),
    ack('c_release', 'Tôi tự nguyện đồng ý giác hơi và miễn trách nhiệm cho tiệm với phản ứng do tình trạng tôi không khai.', 'I consent to cupping and release the salon from liability for reactions due to conditions I did not disclose.'),
  ],
};

const HOT_STONE: FormTemplate = {
  kind: 'hot_stone',
  version: 1,
  title: t('Cam kết đồng ý massage đá nóng', 'Hot stone consent & release'),
  intro: t(
    'Đá được làm nóng đặt lên và dưới cơ thể để làm ấm, thả lỏng cơ.',
    'Heated stones are placed on and under the body to warm and relax the muscles.',
  ),
  signer: 'client',
  fields: [
    section('s_today', 'Hôm nay bạn có tình trạng nào sau đây không?', 'Does any of this apply to you today?'),
    yn('h_sensation', 'Tiểu đường, tê bì hoặc giảm cảm giác nóng', 'Diabetes, numbness or reduced feeling of heat', ['hot_stone'], true),
    yn('h_bp', 'Huyết áp cao', 'High blood pressure', ['hot_stone']),
    yn('h_heart', 'Bệnh tim', 'Heart condition', ['hot_stone']),
    yn('h_pregnant', 'Đang mang thai', 'Pregnant', ['hot_stone']),
    yn('h_varicose', 'Giãn tĩnh mạch', 'Varicose veins', ['hot_stone']),
    yn('h_skin', 'Da nhạy cảm, cháy nắng, mới tẩy lông / peel', 'Sensitive skin, sunburn, recent waxing or peel', ['hot_stone'], true),
    yn('h_injury', 'Chấn thương, sưng viêm mới', 'Recent injury or inflammation', ['hot_stone'], true),
    yn('h_thinners', 'Dùng thuốc chống đông máu', 'Taking blood thinners', ['hot_stone']),

    section('s_ack', 'Tôi hiểu và đồng ý', 'I understand and agree'),
    ack('h_heat', 'Đá được làm nóng và có thể rất ấm.', 'The stones are heated and may feel very warm.'),
    ack('h_tell', 'Tôi sẽ báo ngay nếu đá quá nóng hoặc khó chịu.', 'I will tell my therapist at once if a stone feels too hot or uncomfortable.'),
    ack('h_risk', 'Có thể đỏ da, hiếm khi bỏng, nhất là da nhạy cảm.', 'Redness or, rarely, a burn can happen, especially on sensitive skin.'),
    ack('h_disclosed', 'Tôi đã khai đủ tình trạng sức khoẻ và thuốc đang dùng.', 'I have told my therapist about all my health conditions and medication.'),
    ack('h_stop', 'Tôi có thể yêu cầu dừng bất cứ lúc nào.', 'I can ask the therapist to stop at any time.'),
    ack('h_release', 'Tôi tự nguyện đồng ý và miễn trách nhiệm cho tiệm với phản ứng do tình trạng tôi không khai.', 'I consent and release the salon from liability for reactions due to conditions I did not disclose.'),
  ],
};

const SOAP: FormTemplate = {
  kind: 'soap',
  version: 1,
  title: t('Ghi chú SOAP', 'SOAP note'),
  intro: t('Kỹ thuật viên ghi sau buổi làm — chạm để chọn.', 'Filled in by the therapist after the session — tap to pick.'),
  signer: 'staff',
  fields: [
    section('s_s', 'S — Khách kể', 'S — Subjective'),
    { id: 's_areas', type: 'bodymap', label: t('Vùng khách than phiền', 'Where the client feels it') },
    {
      id: 's_symptoms', type: 'multi', label: t('Triệu chứng', 'Symptoms'),
      options: [
        opt('tight', 'Căng cứng', 'Tight'), opt('sore', 'Đau mỏi', 'Sore'), opt('stiff', 'Khó cử động', 'Stiff'),
        opt('sharp', 'Đau nhói', 'Sharp pain'), opt('numb', 'Tê', 'Numb / tingling'), opt('headache', 'Đau đầu', 'Headache'),
        opt('stress', 'Căng thẳng', 'Stress'), opt('tired', 'Mệt mỏi', 'Fatigue'),
      ],
    },
    { id: 's_pain', type: 'scale', label: t('Mức đau trước buổi (0–10)', 'Pain before (0–10)'), min: 0, max: 10 },

    section('s_o', 'O — Kỹ thuật viên ghi nhận', 'O — Objective'),
    { id: 'o_areas', type: 'bodymap', label: t('Vùng phát hiện', 'Areas found') },
    {
      id: 'o_findings', type: 'multi', label: t('Ghi nhận', 'Findings'),
      options: [
        opt('hypertonic', 'Cơ co cứng', 'Hypertonic muscle'), opt('trigger', 'Điểm đau (trigger point)', 'Trigger points'),
        opt('adhesion', 'Dính mô', 'Adhesions'), opt('spasm', 'Co thắt', 'Spasm'), opt('rom', 'Hạn chế vận động', 'Limited range of motion'),
        opt('swelling', 'Sưng', 'Swelling'), opt('tender', 'Đau khi chạm', 'Tender to touch'), opt('posture', 'Lệch tư thế', 'Postural imbalance'),
      ],
    },

    section('s_a', 'A — Kết quả', 'A — Assessment'),
    {
      id: 'a_results', type: 'multi', label: t('Sau buổi làm', 'After the session'),
      options: [
        opt('less_tension', 'Giảm căng cơ', 'Less tension'), opt('better_rom', 'Cử động tốt hơn', 'Better range of motion'),
        opt('less_pain', 'Giảm đau', 'Less pain'), opt('relaxed', 'Khách thư giãn', 'Client relaxed'),
        opt('no_change', 'Chưa thay đổi', 'No change'), opt('sore_expected', 'Có thể ê ẩm 1–2 ngày', 'Soreness expected 1–2 days'),
      ],
    },
    { id: 'a_pain', type: 'scale', label: t('Mức đau sau buổi (0–10)', 'Pain after (0–10)'), min: 0, max: 10 },

    section('s_p', 'P — Kế hoạch', 'P — Plan'),
    {
      id: 'p_advice', type: 'multi', label: t('Dặn khách', 'Advice given'),
      options: [
        opt('water', 'Uống nhiều nước', 'Drink water'), opt('stretch', 'Giãn cơ tại nhà', 'Stretch at home'), opt('heat', 'Chườm nóng', 'Heat'),
        opt('ice', 'Chườm lạnh', 'Ice'), opt('rest', 'Nghỉ ngơi', 'Rest'), opt('posture', 'Chỉnh tư thế', 'Posture'), opt('doctor', 'Đi khám bác sĩ', 'See a doctor'),
      ],
    },
    {
      id: 'p_return', type: 'choice', label: t('Hẹn lại', 'Come back in'),
      options: [opt('1w', '1 tuần', '1 week'), opt('2w', '2 tuần', '2 weeks'), opt('1m', '1 tháng', '1 month'), opt('asneeded', 'Khi cần', 'As needed')],
    },

    section('s_tx', 'Đã làm', 'Treatment'),
    {
      id: 'techniques', type: 'multi', label: t('Kỹ thuật', 'Techniques'), required: true,
      options: [
        opt('swedish', 'Thụy Điển', 'Swedish'), opt('deep', 'Mô sâu', 'Deep tissue'), opt('trigger', 'Điểm đau', 'Trigger point'),
        opt('myofascial', 'Cân cơ', 'Myofascial'), opt('sports', 'Thể thao', 'Sports'), opt('cupping', 'Giác hơi', 'Cupping'),
        opt('hot_stone', 'Đá nóng', 'Hot stone'), opt('reflexology', 'Bấm huyệt chân', 'Reflexology'), opt('stretch', 'Kéo giãn', 'Stretching'),
        opt('prenatal', 'Bầu', 'Prenatal'), opt('aroma', 'Tinh dầu', 'Aromatherapy'),
      ],
    },
    { id: 'pressure_used', type: 'choice', label: t('Lực đã dùng', 'Pressure used'), options: [...PRESSURE, opt('deep', 'Rất mạnh', 'Deep')] },
    { id: 'note', type: 'text', label: t('Ghi chú thêm (không bắt buộc)', 'Extra note (optional)') },
  ],
};

export const TEMPLATES: Record<FormKind, FormTemplate> = { intake: INTAKE, cupping: CUPPING, hot_stone: HOT_STONE, soap: SOAP };
/** The intake in each style; a signed entry keeps the snapshot of the one it was. */
export const INTAKES: Record<IntakeStyle, FormTemplate> = { massage: INTAKE, nail: NAIL_INTAKE, general: GENERAL_INTAKE };

/** A salon's own extra yes/no question on the intake. */
export interface ExtraQuestion { id: string; vi: string; en: string; flag: boolean }

/** The built-in form, plus the salon's own intake questions at the end of the health list. */
export function templateFor(kind: FormKind, extra: ExtraQuestion[] = [], style: IntakeStyle = 'massage'): FormTemplate {
  const base = kind === 'intake' ? INTAKES[style] ?? INTAKE : TEMPLATES[kind];
  if (kind !== 'intake' || !extra.length) return base;
  const at = base.fields.findIndex((f) => f.id === 's_visit' || f.id === 's_ack');
  const mine: FormField[] = extra.map((q) => ({
    id: `x_${q.id}`, type: 'yesno', required: true, detail: true,
    label: t(q.vi || q.en, q.en || q.vi), flags: q.flag ? ['massage'] : [],
  }));
  const fields = [...base.fields];
  fields.splice(at < 0 ? fields.length : at, 0, ...mine);
  return { ...base, fields };
}

/** The form in one language — what the client sees, and the snapshot stored with the signature. */
export function resolveTemplate(tpl: FormTemplate, lang: FormLang): ResolvedTemplate {
  const pick = (x: Tx) => (lang === 'vi' ? x.vi : x.en) || x.en || x.vi;
  return {
    kind: tpl.kind, version: tpl.version, lang, title: pick(tpl.title), intro: tpl.intro ? pick(tpl.intro) : undefined,
    signer: tpl.signer,
    fields: tpl.fields.map((f) => {
      const out: ResolvedField = { id: f.id, type: f.type, label: pick(f.label) };
      if (f.required) out.required = true;
      if (f.options) out.options = f.options.map((o) => ({ id: o.id, label: pick(o.label) }));
      if (f.flags?.length) out.flags = f.flags;
      if (f.detail) out.detail = true;
      if (f.min != null) out.min = f.min;
      if (f.max != null) out.max = f.max;
      if (f.prefill) out.prefill = f.prefill;
      if (f.short) out.short = true;
      return out;
    }),
    areas: BODY_AREAS.map((a) => ({ id: a.id, label: pick(a.label), side: a.side })),
  };
}

// ---------------------------------------------------------------- answers

export type Answers = Record<string, unknown>;
const TEXT_MAX = 500;

const cleanText = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, TEXT_MAX) : '');

/**
 * Only what the form asks, in the shape each field takes; anything else is
 * dropped. `missing` lists the required fields left unanswered — the form is
 * refused until it is empty.
 *
 *   yesno   → true | false   (+ "<id>__note" text when the field asks for detail)
 *   choice  → one option id
 *   multi   → option ids
 *   text    → string
 *   bodymap → area ids
 *   scale   → integer in [min, max]
 *   ack     → true
 */
export function validateAnswers(tpl: FormTemplate | ResolvedTemplate, raw: unknown): { answers: Answers; missing: string[] } {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Answers) : {};
  const answers: Answers = {};
  const missing: string[] = [];
  for (const f of tpl.fields) {
    const v = src[f.id];
    const optionIds = new Set((f.options ?? []).map((o) => o.id));
    let has = false;
    switch (f.type) {
      case 'yesno':
        if (typeof v === 'boolean') {
          answers[f.id] = v; has = true;
          const note = cleanText(src[`${f.id}__note`]);
          if (v && f.detail && note) answers[`${f.id}__note`] = note;
        }
        break;
      case 'choice':
        if (typeof v === 'string' && optionIds.has(v)) { answers[f.id] = v; has = true; }
        break;
      case 'multi': {
        const list = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && optionIds.has(x)))] : [];
        if (list.length) { answers[f.id] = list; has = true; }
        break;
      }
      case 'bodymap': {
        const list = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && AREA_IDS.has(x)))] : [];
        if (list.length) { answers[f.id] = list; has = true; }
        break;
      }
      case 'text': {
        const s = cleanText(v);
        if (s) { answers[f.id] = s; has = true; }
        break;
      }
      case 'scale': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
        const lo = f.min ?? 0, hi = f.max ?? 10;
        if (Number.isFinite(n) && n >= lo && n <= hi) { answers[f.id] = Math.round(n); has = true; }
        break;
      }
      case 'ack':
        if (v === true) { answers[f.id] = true; has = true; }
        break;
      default:
        has = true; // section / note: nothing to answer
    }
    if (f.required && !has) missing.push(f.id);
  }
  return { answers, missing };
}

// ---------------------------------------------------------------- red flags

export interface RedFlag {
  /** The form it came from and the question. */
  kind: FormKind;
  fieldId: string;
  label: string;
  note?: string;
  /** What this "yes" is a caution for. */
  for: FlagTarget[];
}

/**
 * The "yes" answers the therapist must see before starting, from the client's
 * own signed forms. Only cautions that matter for THIS visit: any-massage
 * cautions always, a cupping caution only when the visit includes cupping.
 * Labels come from the snapshot the client signed, so they read exactly as
 * the client saw them. Duplicates (the same question on two forms) collapse.
 */
export function redFlags(
  entries: { kind: FormKind; answers: Answers; snapshot?: ResolvedTemplate | null }[],
  visitKinds: ConsentKind[],
  lang: FormLang,
): RedFlag[] {
  const wanted = new Set<FlagTarget>(['massage', ...visitKinds]);
  const out: RedFlag[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.kind === 'soap') continue;
    const fields: (ResolvedField | FormField)[] = e.snapshot?.fields?.length ? e.snapshot.fields : TEMPLATES[e.kind]?.fields ?? [];
    for (const f of fields) {
      if (f.type !== 'yesno' || e.answers?.[f.id] !== true) continue;
      const targets = (f.flags ?? []).filter((x) => wanted.has(x));
      if (!targets.length) continue;
      const label = typeof f.label === 'string' ? f.label : (lang === 'vi' ? f.label.vi : f.label.en);
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const note = typeof e.answers[`${f.id}__note`] === 'string' ? String(e.answers[`${f.id}__note`]) : undefined;
      out.push({ kind: e.kind, fieldId: f.id, label, ...(note ? { note } : {}), for: targets });
    }
  }
  return out;
}

/** Plain notes for the therapist from the intake: pressure, areas to focus on and to avoid. */
export function visitNotes(intake: Answers | null | undefined, lang: FormLang): string[] {
  if (!intake) return [];
  const tpl = resolveTemplate(TEMPLATES.intake, lang);
  const area = new Map(tpl.areas.map((a) => [a.id, a.label]));
  const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => area.get(String(x))).filter(Boolean).join(', ') : '');
  const out: string[] = [];
  const p = tpl.fields.find((f) => f.id === 'pressure')?.options?.find((o) => o.id === intake.pressure)?.label;
  if (p) out.push(`${lang === 'vi' ? 'Lực' : 'Pressure'}: ${p}`);
  const focus = names(intake.focus);
  if (focus) out.push(`${lang === 'vi' ? 'Tập trung' : 'Focus'}: ${focus}`);
  const avoid = names(intake.avoid);
  if (avoid) out.push(`${lang === 'vi' ? 'TRÁNH' : 'AVOID'}: ${avoid}`);
  return out;
}

// ---------------------------------------------------------------- signature

/** A drawn signature: a PNG data URL of a sane size, nothing else. */
export function cleanSignature(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s.length < 200 || s.length > 400_000) return null;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(s) ? s : null;
}
