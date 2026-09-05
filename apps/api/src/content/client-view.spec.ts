import {
  clientWeek, clientSuggestion, mediaOf, suggestionStatus, leaksAnything,
  flattenForClient, needsTeam, SHOP_JOB_KINDS, NEVER_TO_CLIENT,
} from './client-view';
import { buildWeekPlan } from './weekly-plan';
import { viOf, enOf } from './i18n';

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
      expect(Object.keys(j).sort()).toEqual(['day', 'dayIndex', 'how', 'kind', 'text']);
    }
  });

  it('TELLS THE SHOP HOW, NOT ONLY WHAT', () => {
    // The first version shipped without this and the answer came back at once:
    // a shop told to film and not told how films something nobody can use,
    // once, and then stops.
    const film = cw.jobs.find((j) => j.kind === 'film')!;
    expect(viOf(film.how)).toMatch(/9:16/);
    expect(viOf(film.how)).toMatch(/3 giây đầu/);
    const photo = cw.jobs.find((j) => j.kind === 'photo')!;
    expect(viOf(photo.how)).toMatch(/trước.*sau|sau.*trước/i);
  });

  it('and the how is craft, never method', () => {
    // "Shoot it vertical, window light" is true of the trade everywhere and
    // worth nothing to a competitor. "Saturday is your quietest day" is the
    // agency reading this shop's booking book, and stays out.
    for (const j of cw.jobs) {
      const both = `${viOf(j.how)} ${enOf(j.how)}`;
      expect(both).not.toMatch(/vắng nhất|quietest|sổ đặt lịch|booking book|giai đoạn|stage/i);
    }
    expect(leaksAnything(cw)).toBeNull();
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
      .toEqual(['createdAt', 'id', 'media', 'note', 'refThumbUrl', 'refUrl', 'status', 'title']);
  });

  it('SHOWS THE ONE REFERENCE, AND STILL NOT THE FEED', () => {
    // The distinction the first version got wrong by collapsing both into
    // "source": one clip a person picked is the brief and is meant to be seen;
    // the hashtag page it came off is the reading list.
    const c = clientSuggestion({
      ...row,
      refUrl: 'https://www.tiktok.com/@shop/video/123',
      refThumbUrl: 'https://cdn.lumio.app/thumb/123.jpg',
    });
    expect(c.refUrl).toBe('https://www.tiktok.com/@shop/video/123');
    expect(c.refThumbUrl).toBe('https://cdn.lumio.app/thumb/123.jpg');
    expect(JSON.stringify(c)).not.toMatch(/cateyenails/); // the feed, still gone
  });

  it('sends no reference at all when the staff member did not attach one', () => {
    const c = clientSuggestion(row);
    expect(c.refUrl).toBeNull();
    expect(c.refThumbUrl).toBeNull();
  });

  it('refuses anything that is not a real link, because these become href and src', () => {
    const c = clientSuggestion({ ...row, refUrl: 'javascript:alert(1)', refThumbUrl: 'data:text/html,x' });
    expect(c.refUrl).toBeNull();
    expect(c.refThumbUrl).toBeNull();
  });

  it('reads a status it does not recognise as "still waiting"', () => {
    expect(suggestionStatus('done')).toBe('done');
    expect(suggestionStatus('DONE')).toBe('done');
    expect(suggestionStatus('used')).toBe('used');
    expect(suggestionStatus('rubbish')).toBe('sent');
    expect(suggestionStatus(null)).toBe('sent');
  });

  it('does not make the shop care whether the team has got round to it', () => {
    // `used` is the team's bookkeeping. From the shop's side it filmed the
    // thing and sent it — one answer, not two.
    expect(clientSuggestion({ ...row, status: 'used' }).status).toBe('done');
    expect(clientSuggestion({ ...row, status: 'done' }).status).toBe('done');
    expect(clientSuggestion({ ...row, status: 'skipped' }).status).toBe('skipped');
  });

  it('says who a card is waiting on, which is what makes the inbox drain', () => {
    expect(needsTeam('done')).toBe(true);   // files in, no post yet
    expect(needsTeam('used')).toBe(false);  // post made
    expect(needsTeam('sent')).toBe(false);  // still on the shop
    expect(needsTeam('skipped')).toBe(false);
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
