import {
  clientWeek, clientSuggestion, mediaOf, suggestionStatus, leaksAnything,
  flattenForClient, SHOP_JOB_KINDS, NEVER_TO_CLIENT,
} from './client-view';
import { buildWeekPlan } from './weekly-plan';
import { viOf } from './i18n';

const plan = buildWeekPlan({
  today: new Date('2026-09-05T12:00:00Z'), todayWeekday: 6, industry: 'SALON', week: 0,
});

describe('what a salon sees of its own week', () => {
  const cw = clientWeek(plan)!;

  it('GIVES THE SHOP ONLY THE WORK IT DOES WITH ITS OWN HANDS', () => {
    // Filming, photographing, asking at the counter. Publishing is the team's
    // job and the team's method.
    expect(cw.jobs.length).toBeGreaterThan(0);
    for (const j of cw.jobs) expect(SHOP_JOB_KINDS).toContain(j.kind);
    expect(cw.jobs.some((j) => j.kind === 'post')).toBe(false);
    expect(cw.jobs.some((j) => j.kind === 'story')).toBe(false);
    expect(cw.jobs.some((j) => j.kind === 'gbp')).toBe(false);
  });

  it('LEAKS NOTHING ABOUT HOW THE WEEK WAS DECIDED', () => {
    // The one that matters. Every field on this list is method: which day is
    // quiet, when that shop's customers decide, the five-stage path, the feeds
    // read every morning. A competitor holding the owner's password learns
    // none of it.
    expect(leaksAnything(cw)).toBeNull();
  });

  it('keeps the focus line, because a list of chores with no aim gets ignored', () => {
    expect(viOf(cw.focus).length).toBeGreaterThan(5);
  });

  it('carries the shot list so the shop knows what to point the camera at', () => {
    const photo = cw.jobs.find((j) => j.kind === 'photo');
    expect(photo).toBeTruthy();
    expect(viOf(photo!.text)).toMatch(/Chụp/);
  });

  it('says which day, because a shoot has to be scheduled — and nothing about publishing', () => {
    for (const j of cw.jobs) {
      expect(typeof j.dayIndex).toBe('number');
      expect(Object.keys(j).sort()).toEqual(['day', 'dayIndex', 'kind', 'text']);
    }
  });

  it('is rebuilt, not filtered — a new field on the plan does not appear here', () => {
    // The property the whole file exists for: leaks come from defaults.
    const sneaky = { ...plan, secretMethod: 'we read the booking book' } as never;
    expect(JSON.stringify(clientWeek(sneaky))).not.toMatch(/secretMethod|booking book/);
  });

  it('returns nothing rather than an empty shell when there is no plan', () => {
    expect(clientWeek(null)).toBeNull();
    expect(clientWeek({ days: [] } as never)).toBeNull();
  });
});

describe('what a salon sees of a suggestion', () => {
  const row = {
    id: 'sug-1',
    title: 'Quay 1 clip mẫu móng mắt mèo',
    note: 'Đang lên xu hướng tuần này, khách hay hỏi',
    sourceUrl: 'https://www.tiktok.com/tag/cateyenails',
    sourceLabel: 'TikTok #cateyenails',
    createdByName: 'tramanh@lumioagency.com',
    createdAt: new Date('2026-09-05T02:00:00Z'),
    status: 'sent',
    doneAt: null,
    media: [{ url: 'https://cdn.lumio.app/t1/a.jpg', kind: 'image' }],
  };

  it('NEVER SENDS THE FEED THE TEAM READS EVERY MORNING', () => {
    const c = clientSuggestion(row);
    expect(JSON.stringify(c)).not.toMatch(/tiktok|TikTok|cateyenails/);
    expect(leaksAnything(c)).toBeNull();
  });

  it('does not name the employee — the shop hears from Lumio', () => {
    expect(JSON.stringify(clientSuggestion(row))).not.toMatch(/tramanh|lumioagency/);
  });

  it('carries what the shop needs and nothing else', () => {
    expect(Object.keys(clientSuggestion(row)).sort())
      .toEqual(['createdAt', 'id', 'media', 'note', 'status', 'title']);
  });

  it('reads a status it does not recognise as "still waiting"', () => {
    expect(suggestionStatus('done')).toBe('done');
    expect(suggestionStatus('DONE')).toBe('done');
    expect(suggestionStatus('rubbish')).toBe('sent');
    expect(suggestionStatus(null)).toBe('sent');
  });

  it('refuses anything that is not a real link in the media column', () => {
    expect(mediaOf([{ url: 'javascript:alert(1)', kind: 'image' }])).toEqual([]);
    expect(mediaOf('nope')).toEqual([]);
    expect(mediaOf([{ url: 'https://x/a.mp4', kind: 'video' }])).toEqual([{ url: 'https://x/a.mp4', kind: 'video' }]);
    // An unknown kind is treated as an image rather than trusted through.
    expect(mediaOf([{ url: 'https://x/a.jpg', kind: 'exe' }])[0].kind).toBe('image');
    expect(mediaOf(Array.from({ length: 40 }, () => ({ url: 'https://x/a.jpg' })))).toHaveLength(12);
  });
});

describe('one language on the phone, not two', () => {
  it('unwraps the bilingual pairs for the screen that asked', () => {
    const p = { a: { vi: 'xin chào', en: 'hello' }, b: [{ c: { vi: 'có', en: 'yes' } }] };
    expect(flattenForClient(p, 'vi')).toEqual({ a: 'xin chào', b: [{ c: 'có' }] });
    expect(flattenForClient(p, 'en')).toEqual({ a: 'hello', b: [{ c: 'yes' }] });
  });

  it('leaves a normal object alone', () => {
    expect(flattenForClient({ vi: 'a', en: 'b', extra: 1 }, 'vi')).toEqual({ vi: 'a', en: 'b', extra: 1 });
  });
});

describe('the guard the other tests are made of', () => {
  it('finds a forbidden key however deep it is buried', () => {
    expect(leaksAnything({ a: { b: [{ sourceUrl: 'x' }] } })).toBe('sourceUrl');
    expect(leaksAnything({ a: { b: [{ ok: 1 }] } })).toBeNull();
    expect(NEVER_TO_CLIENT).toContain('why');
  });

  it('survives a payload that points at itself', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect(leaksAnything(loop)).toBeNull();
  });
});
