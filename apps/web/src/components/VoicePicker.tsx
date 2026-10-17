'use client';

// The AI hotline's voice, chosen by the salon: one voice per language the line
// speaks, ordered young → older. The list comes from the API (VOICE_CATALOG),
// so the screen never offers a name Twilio would not speak.

export interface VoiceOpt {
  id: string;
  lang: 'en-US' | 'en-AU' | 'vi-VN';
  gender: 'female' | 'male';
  age: 1 | 2 | 3 | 4;
  label: { vi: string; en: string };
  isDefault?: boolean;
}

const AGE = {
  vi: ['', 'Trẻ', 'Trưởng thành', 'Chững chạc', 'Lớn tuổi'],
  en: ['', 'Young', 'Adult', 'Mature', 'Older'],
};
const LANG_NAME: Record<VoiceOpt['lang'], { vi: string; en: string }> = {
  'en-US': { vi: 'Giọng tiếng Anh (Mỹ)', en: 'English voice (US)' },
  'en-AU': { vi: 'Giọng tiếng Anh (Úc)', en: 'English voice (Australia)' },
  'vi-VN': { vi: 'Giọng tiếng Việt', en: 'Vietnamese voice' },
};

/** Which voice groups a line needs, by its language setting. */
export function voiceLangsFor(lineLanguage: string): VoiceOpt['lang'][] {
  if (lineLanguage === 'vi-VN') return ['vi-VN'];
  if (lineLanguage === 'bilingual') return ['en-US', 'vi-VN'];
  if (lineLanguage === 'en-AU') return ['en-AU', 'en-US'];
  return ['en-US'];
}

export function VoicePicker({ vi, language, voices, value, onChange }: {
  vi: boolean;
  language: string;
  voices: VoiceOpt[];
  /** Stored picks, comma-separated ('' = defaults). */
  value: string;
  onChange: (next: string) => void;
}) {
  const L = vi ? 'vi' : 'en';
  const picked = value.split(',').map((s) => s.trim()).filter(Boolean);
  const langs = voiceLangsFor(language);
  // An English line: one English pick covers en-US and en-AU, so the AU line shows both groups as one choice.
  const english = (l: VoiceOpt['lang']) => l === 'en-US' || l === 'en-AU';

  const choose = (v: VoiceOpt) => {
    const others = picked.filter((id) => {
      const o = voices.find((x) => x.id === id);
      if (!o) return false;
      return english(v.lang) ? !english(o.lang) : o.lang !== v.lang;
    });
    onChange([...others, v.id].join(','));
  };
  const reset = () => onChange('');

  return (
    <div style={{ marginBottom: 14 }}>
      {langs.map((lg) => {
        const list = voices.filter((v) => v.lang === lg).sort((a, b) => a.age - b.age || a.gender.localeCompare(b.gender));
        if (!list.length) return null;
        const chosenHere = picked.find((id) => voices.some((v) => v.id === id && (english(lg) ? english(v.lang) : v.lang === lg)));
        return (
          <div key={lg} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--c94a3b8)', marginBottom: 6 }}>{LANG_NAME[lg][L]}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 8 }}>
              {list.map((v) => {
                // Nothing picked for this language yet: the default shows as chosen (in the first English group only).
                const on = chosenHere ? chosenHere === v.id : Boolean(v.isDefault) && (lg === 'vi-VN' || lg === langs.find(english));
                return (
                  <button key={v.id} type="button" onClick={() => choose(v)}
                    style={{
                      textAlign: 'left', padding: '9px 11px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1.5px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--wash-blue)' : 'transparent',
                    }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 15 }}>{v.gender === 'female' ? '👩' : '👨'}</span>
                      <span style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 7px', borderRadius: 999, background: on ? '#6366f1' : 'var(--raised)', color: on ? '#fff' : 'var(--c94a3b8)' }}>{AGE[L][v.age]}</span>
                      {v.isDefault && <span style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{vi ? 'mặc định' : 'default'}</span>}
                      {on && <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-good)' }}>✓</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ce2e8f0)', lineHeight: 1.35 }}>{v.label[L]}</div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--c94a3b8)' }}>
        <span>{vi ? 'Bấm Lưu, rồi gọi vào số Lumio của tiệm để nghe thử giọng mới.' : 'Save, then call your Lumio number to hear the new voice.'}</span>
        {picked.length > 0 && <button type="button" onClick={reset} style={{ border: 0, background: 'transparent', color: 'var(--ink-link)', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' }}>{vi ? 'Dùng giọng mặc định' : 'Use the default voice'}</button>}
      </div>
    </div>
  );
}
