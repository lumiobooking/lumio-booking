import { briefPrompt, briefTranscript, canBrief, parseBrief, type BriefTurn } from './handoff-brief';

const turns: BriefTurn[] = [
  { role: 'user', content: 'Mai mình làm gel tay được không?' },
  { role: 'assistant', content: 'Dạ mai còn 10:00, 11:30 và 14:00 ạ' },
  { role: 'assistant', content: 'Anh/chị còn cần em hỗ trợ không ạ?', nudge: true },
  { role: 'user', content: 'Lần trước làm bị bong sau 3 ngày, tiệm xử lý sao?' },
  { role: 'assistant', content: 'Dạ để em báo quản lý ạ', manual: true },
];

describe('handoff brief — three lines and a draft for the person taking over', () => {
  it('the transcript names who spoke and leaves the automatic nudge out', () => {
    const t = briefTranscript(turns);
    expect(t.split('\n')).toEqual([
      'CUSTOMER: Mai mình làm gel tay được không?',
      'AI: Dạ mai còn 10:00, 11:30 và 14:00 ạ',
      'CUSTOMER: Lần trước làm bị bong sau 3 ngày, tiệm xử lý sao?',
      'STAFF: Dạ để em báo quản lý ạ',
    ]);
  });

  it('only the end of a long thread is read', () => {
    const long: BriefTurn[] = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
    const lines = briefTranscript(long).split('\n');
    expect(lines).toHaveLength(24);
    expect(lines[23]).toBe('AI: m59');
  });

  it('nothing to brief when the customer never wrote', () => {
    expect(canBrief([{ role: 'assistant', content: 'Hi!' }])).toBe(false);
    expect(canBrief(turns)).toBe(true);
  });

  it('the prompt forbids inventing facts and keeps the salon voice in Vietnamese', () => {
    const p = briefPrompt({ business: 'Lumio Nails', vi: true, transcript: briefTranscript(turns), notes: 'Bảo hành gel 7 ngày' });
    expect(p.system).toContain('Never invent a price');
    expect(p.system).toContain('"[…]"');
    expect(p.system).toContain('speaks as "em"');
    expect(p.user).toContain('Bảo hành gel 7 ngày');
    expect(briefPrompt({ business: 'X', vi: false, transcript: 't' }).system).not.toContain('speaks as "em"');
  });

  it('reads the model’s JSON whether fenced or with a preamble; fills the gaps', () => {
    const b = parseBrief('Here you go:\n```json\n{"want":"Khách hỏi bảo hành gel bị bong","done":"Đã đưa 3 giờ trống ngày mai","reply":"Dạ em xin lỗi chị ạ. **Tiệm** bảo hành gel 7 ngày, chị ghé lúc nào tiện ạ?"}\n```');
    expect(b).toEqual({ want: 'Khách hỏi bảo hành gel bị bong', done: 'Đã đưa 3 giờ trống ngày mai', missing: '—', reply: 'Dạ em xin lỗi chị ạ. Tiệm bảo hành gel 7 ngày, chị ghé lúc nào tiện ạ?' });
  });

  it('unusable output is null, never a half-empty card', () => {
    expect(parseBrief('I cannot help with that')).toBeNull();
    expect(parseBrief('{"want":"","reply":""}')).toBeNull();
    expect(parseBrief('{broken')).toBeNull();
  });
});
