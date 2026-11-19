import {
  DEFAULT_RULES, blockedReason, cleanPending, cleanRules, fold, parseReading, pickPhotos, priceSignature, scoreItem, suggestFor, toolAnswer, wordsOf, type LibItem,
} from './photo-library';
import { PhotoLibraryService, sentUrls } from './photo-library.service';

const now = new Date('2026-11-19T05:00:00Z');
const item = (id: string, o: Partial<LibItem> = {}): LibItem => ({
  id, url: `https://cdn.x/${id}.jpg`, kind: 'sample', title: '', serviceId: null, serviceName: null, tags: [],
  aiAllowed: true, expiresAt: null, flags: [], consent: false, status: 'ready', priceSig: null, ...o,
});

describe('photo library — choosing the right picture', () => {
  const french = item('fr', { title: 'French trắng vuông', serviceId: 'svcFrench', serviceName: 'Gel French', tags: ['french', 'trắng', 'vuông'] });
  const red = item('red', { title: 'Đỏ cherry', serviceId: 'svcGel', serviceName: 'Sơn gel', tags: ['đỏ', 'cherry'] });
  const nude = item('nude', { title: 'Nude ombre', serviceId: 'svcGel', serviceName: 'Sơn gel', tags: ['nude', 'ombre', 'ngắn'] });

  it('folds Vietnamese and drops words that carry no picture', () => {
    expect(fold('Mắt Mèo Đỏ')).toBe('mat meo do');
    expect(wordsOf('Có mẫu French trắng không em')).toEqual(['french', 'trang']);
  });

  it('a caption that mentions "French" no longer makes a red set a French sample', () => {
    // The old search matched the caption; the library reads labels only.
    const redWithCaption = { ...red, title: 'Đỏ cherry' };
    expect(scoreItem(redWithCaption, { kind: 'sample', words: ['french'] })).toBe(0);
    expect(scoreItem(french, { kind: 'sample', words: ['french'] })).toBe(1);
  });

  it('service and style each count half', () => {
    expect(scoreItem(french, { kind: 'sample', serviceId: 'svcFrench', words: ['nude'] })).toBe(0.5);
    expect(scoreItem(nude, { kind: 'sample', serviceId: 'svcGel', words: ['nude'] })).toBe(1);
    expect(scoreItem(red, { kind: 'sample', words: [] })).toBe(0.6);
  });

  it('strong matches are sent, up to the salon maximum', () => {
    const r = pickPhotos([french, red, nude], { kind: 'sample', words: ['french'] }, { now, sent: new Set(), rules: DEFAULT_RULES });
    expect(r.decision).toBe('send');
    expect(r.picked.map((p) => p.item.id)).toEqual(['fr']);
  });

  it('a close but not exact picture: ONE picture and a question', () => {
    const r = pickPhotos([french, red], { kind: 'sample', serviceId: 'svcFrench', words: ['nude'] }, { now, sent: new Set(), rules: DEFAULT_RULES });
    expect(r.decision).toBe('ask');
    expect(r.picked).toHaveLength(1);
    expect(toolAnswer(r, 1, 'French nude')).toMatch(/asking whether this style/);
  });

  it('nothing that fits: none, and the AI is told not to describe pictures', () => {
    const r = pickPhotos([french, red], { kind: 'sample', words: ['mat', 'meo'] }, { now, sent: new Set(), rules: DEFAULT_RULES });
    expect(r.decision).toBe('none');
    expect(toolAnswer(r, 0, 'mắt mèo')).toMatch(/^NONE/);
  });

  it('never sends the same picture twice in one conversation', () => {
    const r = pickPhotos([french], { kind: 'sample', words: ['french'] }, { now, sent: new Set([french.url]), rules: DEFAULT_RULES });
    expect(r.decision).toBe('none');
    expect(r.allSent).toBe(true);
    expect(toolAnswer(r, 0, 'French')).toMatch(/already in this chat/);
  });

  it('expired promotions, flagged pictures and stale price lists are held back', () => {
    const promo = item('p', { kind: 'promo', expiresAt: new Date('2026-11-01') });
    const face = item('f', { tags: ['french'], flags: ['face'] });
    const price = item('pl', { kind: 'price_list', priceSig: 'old' });
    expect(blockedReason(promo, now)).toBe('expired');
    expect(blockedReason(face, now)).toBe('flagged');
    expect(blockedReason({ ...face, consent: true }, now)).toBeNull();
    expect(blockedReason(price, now, 'new')).toBe('price_stale');
    expect(blockedReason(price, now, 'old')).toBeNull();
    const r = pickPhotos([price], { kind: 'price_list', words: [] }, { now, sent: new Set(), priceSig: 'new', rules: DEFAULT_RULES });
    expect(r.decision).toBe('none');
    expect(toolAnswer(r, 0, 'bảng giá')).toMatch(/older than the current prices/);
  });

  it('a customer result needs consent, and is never sent by the AI on its own', () => {
    expect(blockedReason(item('r', { kind: 'result' }), now)).toBe('no_consent');
    expect(cleanRules({ modes: { result: 'auto' } }).modes.result).toBe('approve');
  });

  it('the salon decides per kind: approve holds the pictures for a person, off sends none', () => {
    const approve = cleanRules({ modes: { sample: 'approve' } });
    expect(pickPhotos([french], { kind: 'sample', words: ['french'] }, { now, sent: new Set(), rules: approve }).decision).toBe('approve');
    const off = cleanRules({ modes: { sample: 'off' } });
    expect(pickPhotos([french], { kind: 'sample', words: ['french'] }, { now, sent: new Set(), rules: off }).decision).toBe('off');
  });

  it('rules from a browser are read back into known values', () => {
    expect(cleanRules({ minScore: 5, max: 9, whenNone: 'x', modes: { sample: 'hack' } })).toEqual(DEFAULT_RULES);
  });

  it('price signature changes with a price, not with order', () => {
    const a = priceSignature([{ id: 'a', priceCents: 100 }, { id: 'b', priceCents: 200 }]);
    expect(priceSignature([{ id: 'b', priceCents: 200 }, { id: 'a', priceCents: 100 }])).toBe(a);
    expect(priceSignature([{ id: 'a', priceCents: 150 }, { id: 'b', priceCents: 200 }])).not.toBe(a);
  });

  it('inbox suggestions: the price list for a price question, already-sent last, flagged marked', () => {
    const price = item('pl', { kind: 'price_list' });
    const face = item('f', { tags: ['french'], flags: ['face'] });
    const s = suggestFor([french, red, price, face], 'bảng giá sao em', { now, sent: new Set() });
    expect(s[0].item.id).toBe('pl');
    const s2 = suggestFor([french, face], 'mẫu french', { now, sent: new Set([french.url]) });
    expect(s2[s2.length - 1].item.id).toBe('fr');
    expect(s2.find((x) => x.item.id === 'f')!.blocked).toBe('flagged');
  });

  it('reads the picture reader answer and keeps only known flags', () => {
    expect(parseReading('Đây: {"title":"French trắng","tags":["French","trắng"],"flags":["face","virus"],"kind":"sample"}'))
      .toEqual({ title: 'French trắng', tags: ['french', 'trắng'], flags: ['face'], kind: 'sample' });
    expect(parseReading('no json')).toBeNull();
  });

  it('waiting suggestions keep only safe thread ids, newest 50', () => {
    const map = cleanPending({ good: { ids: ['a'], label: 'x', at: '2026-11-19' }, 'bad id!': { ids: ['a'], at: '1' }, empty: { ids: [] } });
    expect(Object.keys(map)).toEqual(['good']);
  });

  it('sentUrls reads only pictures the salon sent', () => {
    expect([...sentUrls([{ role: 'user', images: ['u1'] }, { role: 'assistant', images: ['s1'] }])]).toEqual(['s1']);
  });
});

/** The service against an in-memory table holding TWO salons. */
function setup() {
  const rows: Record<string, unknown>[] = [
    { id: 'a1', tenantId: 'A', url: 'https://cdn.x/a1.jpg', kind: 'sample', title: 'French A', serviceId: null, tags: ['french'], aiAllowed: true, expiresAt: null, flags: [], consent: false, status: 'ready', source: 'upload', priceSig: null, sentCount: 0, lastSentAt: null, createdAt: now, updatedAt: now },
    { id: 'b1', tenantId: 'B', url: 'https://cdn.x/b1.jpg', kind: 'sample', title: 'French B', serviceId: null, tags: ['french'], aiAllowed: true, expiresAt: null, flags: ['face'], consent: false, status: 'ready', source: 'upload', priceSig: null, sentCount: 0, lastSentAt: null, createdAt: now, updatedAt: now },
  ];
  const settings = new Map<string, unknown>([['A|messenger.photo_library_imported', {}], ['B|messenger.photo_library_imported', {}]]);
  const logs: { tenantId: string; action: string }[] = [];
  const match = (r: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' && 'in' in (v as object) ? ((v as { in: unknown[] }).in).includes(r[k]) : r[k] === v);
  const prisma = {
    mediaLibraryItem: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
      findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => match(r, where)) ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { const r = { id: `n${rows.length}`, flags: [], sentCount: 0, createdAt: now, updatedAt: now, ...data }; rows.push(r); return r; }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => match(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) rows.splice(i, 1); return { count: before - rows.length };
      }),
    },
    service: { findMany: jest.fn(async () => []), findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === 'sA' && where.tenantId === 'A' ? { id: 'sA' } : null)) },
    setting: {
      findUnique: jest.fn(async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
        const v = settings.get(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`); return v === undefined ? null : { value: v };
      }),
      upsert: jest.fn(async ({ where, create }: { where: { tenantId_key: { tenantId: string; key: string } }; create: { value: unknown } }) => {
        settings.set(`${where.tenantId_key.tenantId}|${where.tenantId_key.key}`, create.value); return {};
      }),
    },
    messengerThread: { findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => (where.id === 'tA' && where.tenantId === 'A' ? { id: 'tA', history: [{ role: 'user', content: 'có mẫu french không' }] } : null)) },
    auditLog: { create: jest.fn(async ({ data }: { data: { tenantId: string; action: string } }) => { logs.push(data); return {}; }) },
  };
  return { svc: new PhotoLibraryService(prisma as never), rows, logs, settings };
}
const ownerA = { userId: 'oA', role: 'SALON_ADMIN', tenantId: 'A' } as never;
const ownerB = { userId: 'oB', role: 'SALON_ADMIN', tenantId: 'B' } as never;

describe('photo library — one salon never sees or touches another', () => {
  it('lists only the caller salon pictures', async () => {
    const { svc } = setup();
    const a = await svc.list(ownerA);
    expect(a.items.map((i) => i.id)).toEqual(['a1']);
    const b = await svc.list(ownerB);
    expect(b.items.map((i) => i.id)).toEqual(['b1']);
    expect(b.warnings.flagged).toBe(1);
  });

  it('cannot edit, delete or send another salon picture', async () => {
    const { svc, rows } = setup();
    await expect(svc.update(ownerA, 'b1', { consent: true })).rejects.toThrow();
    await expect(svc.remove(ownerA, 'b1')).rejects.toThrow();
    await expect(svc.sendable(ownerA, 'b1')).rejects.toThrow();
    expect(rows.find((r) => r.id === 'b1')!.consent).toBe(false);
    expect(rows).toHaveLength(2);
  });

  it('a service from another salon cannot be attached', async () => {
    const { svc } = setup();
    await expect(svc.update(ownerA, 'a1', { serviceId: 'sB' })).rejects.toThrow(/không thuộc tiệm/);
    await expect(svc.update(ownerA, 'a1', { serviceId: 'sA' })).resolves.toMatchObject({ serviceId: 'sA' });
  });

  it('a flagged picture cannot be sent by a person until consent, and consent is audited', async () => {
    const { svc, logs } = setup();
    await expect(svc.sendable(ownerB, 'b1')).rejects.toThrow(/đồng ý/);
    await svc.update(ownerB, 'b1', { consent: true });
    await expect(svc.sendable(ownerB, 'b1')).resolves.toMatchObject({ tenantId: 'B', id: 'b1' });
    expect(logs).toContainEqual(expect.objectContaining({ tenantId: 'B', action: 'media_library.consent_given' }));
  });

  it('the AI picks from its own salon only, and falls back when a salon has no library', async () => {
    const { svc } = setup();
    const a = await svc.pickForAi('A', 'sample', null, ['french'], new Set());
    expect(a!.result.picked.map((p) => p.item.id)).toEqual(['a1']);
    expect(await svc.pickForAi('C', 'sample', null, ['french'], new Set())).toBeNull();
    expect(await svc.pickForAi('A', 'price_list', null, [], new Set())).toBeNull();
  });

  it('inbox suggestions only for a thread of the caller salon', async () => {
    const { svc } = setup();
    await expect(svc.suggest(ownerB, 'tA')).rejects.toThrow();
    const s = await svc.suggest(ownerA, 'tA');
    expect(s.suggestions.map((x) => x.id)).toEqual(['a1']);
  });

  it('waiting suggestions are kept per salon', async () => {
    const { svc, settings } = setup();
    await svc.addPending('A', 'tA', ['a1'], 'french');
    expect(settings.get('A|messenger.photo_pending')).toMatchObject({ tA: { ids: ['a1'] } });
    expect(settings.get('B|messenger.photo_pending')).toBeUndefined();
    await svc.clearPending('A', 'tA');
    expect(settings.get('A|messenger.photo_pending')).toEqual({});
  });
});
