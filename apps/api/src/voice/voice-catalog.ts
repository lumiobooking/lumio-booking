/**
 * THE VOICES A SALON CAN PICK FOR ITS AI HOTLINE — pure.
 *
 * Owners asked to choose the assistant's voice themselves, "from a young
 * voice to an older one". Twilio's <Say> speaks with Amazon Polly and Google
 * voices; this is the short list that sounds natural on a phone call, with a
 * plain-language description and a rough age band (1 = young … 4 = older) so
 * the settings screen can order them young → older.
 *
 * A salon may pick one voice per language (an English voice and a Vietnamese
 * one for a bilingual line). They are stored together in VoiceLine.voice as a
 * comma-separated list — no migration — and `pickVoice` hands each turn the
 * one that speaks that turn's language, so an English voice never reads
 * Vietnamese (the "alice" noise bug).
 */

export type VoiceLang = 'en-US' | 'en-AU' | 'vi-VN';

export interface VoiceOption {
  /** The exact Twilio <Say voice="…"> name. */
  id: string;
  lang: VoiceLang;
  gender: 'female' | 'male';
  /** 1 young · 2 adult · 3 mature · 4 older. */
  age: 1 | 2 | 3 | 4;
  label: { vi: string; en: string };
  /** The voice the hotline uses when the salon has not chosen one. */
  isDefault?: boolean;
}

export const VOICE_CATALOG: VoiceOption[] = [
  // English (US) — Amazon Polly neural voices.
  { id: 'Polly.Kimberly-Neural', lang: 'en-US', gender: 'female', age: 1, label: { vi: 'Kimberly — nữ, trẻ trung, tươi', en: 'Kimberly — female, young and bright' } },
  { id: 'Polly.Salli-Neural', lang: 'en-US', gender: 'female', age: 1, label: { vi: 'Salli — nữ, trẻ, nhẹ nhàng', en: 'Salli — female, young and soft' } },
  { id: 'Polly.Joanna-Neural', lang: 'en-US', gender: 'female', age: 2, label: { vi: 'Joanna — nữ, ấm áp, chuyên nghiệp', en: 'Joanna — female, warm and professional' }, isDefault: true },
  { id: 'Polly.Danielle-Neural', lang: 'en-US', gender: 'female', age: 2, label: { vi: 'Danielle — nữ, tự nhiên, thân thiện', en: 'Danielle — female, natural and friendly' } },
  { id: 'Polly.Kendra-Neural', lang: 'en-US', gender: 'female', age: 3, label: { vi: 'Kendra — nữ, chững chạc', en: 'Kendra — female, mature' } },
  { id: 'Polly.Ruth-Neural', lang: 'en-US', gender: 'female', age: 4, label: { vi: 'Ruth — nữ, lớn tuổi hơn, điềm đạm', en: 'Ruth — female, older and calm' } },
  { id: 'Polly.Joey-Neural', lang: 'en-US', gender: 'male', age: 1, label: { vi: 'Joey — nam, trẻ', en: 'Joey — male, young' } },
  { id: 'Polly.Matthew-Neural', lang: 'en-US', gender: 'male', age: 2, label: { vi: 'Matthew — nam, trưởng thành', en: 'Matthew — male, adult' } },
  { id: 'Polly.Stephen-Neural', lang: 'en-US', gender: 'male', age: 3, label: { vi: 'Stephen — nam, chững chạc', en: 'Stephen — male, mature' } },
  { id: 'Polly.Gregory-Neural', lang: 'en-US', gender: 'male', age: 4, label: { vi: 'Gregory — nam, lớn tuổi hơn, trầm', en: 'Gregory — male, older and deep' } },
  // English (Australia).
  { id: 'Polly.Olivia-Neural', lang: 'en-AU', gender: 'female', age: 2, label: { vi: 'Olivia — nữ, giọng Úc, tự nhiên', en: 'Olivia — female, Australian, natural' }, isDefault: true },
  { id: 'Polly.Nicole', lang: 'en-AU', gender: 'female', age: 3, label: { vi: 'Nicole — nữ, giọng Úc, chững chạc', en: 'Nicole — female, Australian, mature' } },
  { id: 'Polly.Russell', lang: 'en-AU', gender: 'male', age: 3, label: { vi: 'Russell — nam, giọng Úc', en: 'Russell — male, Australian' } },
  // Vietnamese — Google WaveNet voices.
  { id: 'Google.vi-VN-Wavenet-A', lang: 'vi-VN', gender: 'female', age: 2, label: { vi: 'Nữ 1 — rõ, nhẹ nhàng', en: 'Female 1 — clear and gentle' }, isDefault: true },
  { id: 'Google.vi-VN-Wavenet-C', lang: 'vi-VN', gender: 'female', age: 3, label: { vi: 'Nữ 2 — trầm hơn, chững chạc', en: 'Female 2 — lower and mature' } },
  { id: 'Google.vi-VN-Wavenet-D', lang: 'vi-VN', gender: 'male', age: 2, label: { vi: 'Nam 1 — trẻ hơn', en: 'Male 1 — younger' } },
  { id: 'Google.vi-VN-Wavenet-B', lang: 'vi-VN', gender: 'male', age: 3, label: { vi: 'Nam 2 — trầm, chững chạc', en: 'Male 2 — deep and mature' } },
];

const BY_ID = new Map(VOICE_CATALOG.map((v) => [v.id.toLowerCase(), v]));

/** A voice from the list, or null for anything else (typos, retired names, injection). */
export function voiceOption(id: string | null | undefined): VoiceOption | null {
  return BY_ID.get(String(id ?? '').trim().toLowerCase()) ?? null;
}

/** The stored value → the chosen voices, at most one per language, unknown names dropped. */
export function parseVoices(stored: string | null | undefined): VoiceOption[] {
  const out: VoiceOption[] = [];
  for (const part of String(stored ?? '').split(',')) {
    const v = voiceOption(part);
    if (v && !out.some((x) => x.lang === v.lang)) out.push(v);
  }
  return out;
}

/**
 * What the owner picked → what is stored. Accepts a list or a comma string;
 * keeps one voice per language; '' / [] clears the choice (back to defaults).
 * Returns null when nothing valid is left.
 */
export function cleanVoiceSetting(input: string | string[] | null | undefined): string | null {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(',');
  const chosen = parseVoices(parts.join(','));
  return chosen.length ? chosen.map((v) => v.id).join(',') : null;
}

/**
 * The voice for one turn. The salon's pick for that language wins; an
 * Australian line may use a US voice and the other way round (both English);
 * Vietnamese is only ever read by a Vietnamese voice. Null = use the default.
 */
export function pickVoice(lang: string, stored: string | null | undefined): string | null {
  const chosen = parseVoices(stored);
  if (lang === 'vi-VN') return chosen.find((v) => v.lang === 'vi-VN')?.id ?? null;
  const same = chosen.find((v) => v.lang === lang);
  if (same) return same.id;
  return chosen.find((v) => v.lang === 'en-US' || v.lang === 'en-AU')?.id ?? null;
}
