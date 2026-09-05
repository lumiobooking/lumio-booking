import { sanitizeDays, keepOrReplace, MAX_JOB_TEXT, MAX_JOBS_PER_DAY } from './week-edit';
import type { DayPlan } from './weekly-plan';

const base: DayPlan[] = [
  {
    weekday: 6,
    label: { vi: 'Thứ 7', en: 'Sat' },
    jobs: [
      { kind: 'film', text: { vi: 'Quay 3 clip', en: 'Film 3 clips' }, why: { vi: 'ngày vắng', en: 'quiet day' }, when: '14:00' },
      { kind: 'engage', text: { vi: 'Trả lời bình luận', en: 'Answer comments' }, why: { vi: 'khách chờ', en: 'people waiting' } },
    ],
  },
  {
    weekday: 0,
    label: { vi: 'Chủ nhật', en: 'Sun' },
    jobs: [{ kind: 'post', text: { vi: 'Đăng clip 1', en: 'Post clip 1' }, why: { vi: 'giờ vàng', en: 'peak hour' }, when: '18:30' }],
  },
  { weekday: 1, label: { vi: 'Thứ 2', en: 'Mon' }, jobs: [{ kind: 'rest', text: { vi: 'Nghỉ', en: 'Rest' }, why: '' }] },
];

const sameShape = (d: DayPlan[]) => d.map((x) => [x.weekday, JSON.stringify(x.label)]);

describe('rebuilding a week somebody rewrote by hand', () => {
  it('keeps the server’s own skeleton — days cannot be invented or renamed', () => {
    const out = sanitizeDays(
      [
        { weekday: 99, label: 'Ngày bịa', jobs: [{ text: 'x', from: '0:0' }] },
        { jobs: [{ text: 'y', from: '1:0' }] },
        { jobs: [{ text: 'z' }] },
        { weekday: 5, label: 'Thứ 6 thừa', jobs: [{ text: 'thừa' }] },
      ],
      base,
    );
    expect(out).toHaveLength(3);
    expect(sameShape(out)).toEqual(sameShape(base));
  });

  it('keeps the English side of a phrase the editor did not touch', () => {
    // Opening the plan in Vietnamese and pressing save must not delete every
    // English phrase in the week.
    const out = sanitizeDays(
      [{ jobs: [{ kind: 'film', text: 'Quay 3 clip', why: 'ngày vắng', when: '14:00', from: '0:0' }] }],
      base,
      'vi',
    );
    expect(out[0].jobs[0].text).toEqual({ vi: 'Quay 3 clip', en: 'Film 3 clips' });
  });

  it('replaces only the side that was edited', () => {
    const out = sanitizeDays(
      [{ jobs: [{ kind: 'film', text: 'Quay 5 clip', why: 'ngày vắng', from: '0:0' }] }],
      base,
      'vi',
    );
    expect(out[0].jobs[0].text).toEqual({ vi: 'Quay 5 clip', en: 'Film 3 clips' });
  });

  it('a job written from scratch is stored as one language, not machine-translated', () => {
    const out = sanitizeDays([{ jobs: [{ kind: 'offer', text: 'Gọi 5 khách cũ', why: 'tuần vắng' }] }], base, 'vi');
    expect(out[0].jobs[0].text).toBe('Gọi 5 khách cũ');
  });

  it('carries a job’s phrases with it when it moves to another day', () => {
    // Saturday's filming job, dragged to Sunday. It was moved, not rewritten,
    // so both languages must survive the move.
    const out = sanitizeDays(
      [
        { jobs: [{ kind: 'engage', text: 'Trả lời bình luận', from: '0:1' }] },
        { jobs: [{ kind: 'film', text: 'Quay 3 clip', why: 'ngày vắng', from: '0:0' }] },
      ],
      base,
      'vi',
    );
    expect(out[1].jobs[0].text).toEqual({ vi: 'Quay 3 clip', en: 'Film 3 clips' });
  });

  it('drops a job with no instruction, and keeps the rest of the day', () => {
    const out = sanitizeDays([{ jobs: [{ text: '   ' }, { text: 'Việc thật' }] }], base);
    expect(out[0].jobs).toHaveLength(1);
    expect(out[0].jobs[0].text).toBe('Việc thật');
  });

  it('an emptied day becomes a rest day rather than a hole', () => {
    const out = sanitizeDays([{ jobs: [] }], base);
    expect(out[0].jobs).toHaveLength(1);
    expect(out[0].jobs[0].kind).toBe('rest');
  });

  it('A DAY THE BROWSER DID NOT SEND BACK IS LEFT ALONE', () => {
    // A truncated or partial request must not delete Thursday. The one that
    // matters: this is a whole-week overwrite, so silence has to mean "keep".
    const out = sanitizeDays([{ jobs: [{ text: 'chỉ sửa ngày đầu' }] }], base);
    expect(out[1]).toEqual(base[1]);
    expect(out[2]).toEqual(base[2]);
  });

  it('refuses an unknown job kind rather than storing it', () => {
    const out = sanitizeDays([{ jobs: [{ kind: 'delete-everything', text: 'x' }] }], base);
    expect(out[0].jobs[0].kind).toBe('post');
  });

  it('caps how long one instruction can be, and how many a day can hold', () => {
    const long = 'x'.repeat(400);
    const many = Array.from({ length: 40 }, (_, i) => ({ text: `việc ${i}` }));
    const out = sanitizeDays([{ jobs: [{ text: long }] }, { jobs: many }], base);
    expect((out[0].jobs[0].text as string).length).toBe(MAX_JOB_TEXT);
    expect(out[1].jobs).toHaveLength(MAX_JOBS_PER_DAY);
  });

  it('survives rubbish where a week should be', () => {
    expect(sanitizeDays(null, base)).toEqual(base);
    expect(sanitizeDays('nope', base)).toEqual(base);
    expect(sanitizeDays([null, undefined, 7], base)).toEqual(base);
  });
});

describe('one field at a time', () => {
  it('empty means "no value", not "empty string"', () => {
    expect(keepOrReplace('  ', { vi: 'a', en: 'b' }, 'vi', 50)).toBeUndefined();
  });

  it('collapses the whitespace a textarea leaves behind', () => {
    expect(keepOrReplace('  hai   dòng\n\ngộp  ', undefined, 'vi', 50)).toBe('hai dòng gộp');
  });
});
