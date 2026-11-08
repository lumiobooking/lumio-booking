import { cleanPhash, hamming, matchFingerprints, seenFindings, parseSeen, forViewer, type FpRow, type SalonFacts } from './media-guard';
import { MediaGuardService } from './media-guard.service';

const A = 'tenant-a', B = 'tenant-b', C = 'tenant-c';
const t0 = new Date('2026-11-01T10:00:00Z');

describe('wrong-salon media: fingerprints', () => {
  it('reads only real 64-bit hashes', () => {
    expect(cleanPhash('A1B2c3d4e5f60718')).toBe('a1b2c3d4e5f60718');
    expect(cleanPhash('0000000000000000')).toBeNull(); // blank picture
    expect(cleanPhash('xyz')).toBeNull();
    expect(cleanPhash(undefined)).toBeNull();
  });
  it('counts differing bits', () => {
    expect(hamming('ffffffffffffffff', 'fffffffffffffff0')).toBe(4);
    expect(hamming('0123456789abcdef', '0123456789abcdef')).toBe(0);
  });
  it('the same file or the same picture at ANOTHER salon is a match; the same salon is not', () => {
    const rows: FpRow[] = [
      { tenantId: A, sha256: 's1', phash: '0123456789abcdef', createdAt: t0 },          // own salon: never a warning
      { tenantId: B, sha256: 's1', phash: null, createdAt: t0 },                        // same bytes
      { tenantId: C, sha256: 'zz', phash: '0123456789abcdee', createdAt: t0 },          // resized copy (1 bit off)
      { tenantId: C, sha256: 'yy', phash: 'fedcba9876543210', createdAt: t0 },          // a different picture
    ];
    const m = matchFingerprints(A, { sha256: 's1', phash: '0123456789abcdef' }, rows);
    expect(m.map((x) => [x.tenantId, x.how]).sort()).toEqual([[B, 'same-file'], [C, 'same-picture']]);
    expect(matchFingerprints(A, { sha256: 'new', phash: null }, rows)).toEqual([]);
  });
});

describe('wrong-salon media: what the picture shows', () => {
  const own: SalonFacts = { id: A, name: 'Saigon Spa & Tattoo', slug: 'saigon-spa', phone: '(640) 213-2999', website: 'saigonspa.com' };
  const others: SalonFacts[] = [
    { id: B, name: "Amy's Lash and Brows", slug: 'amys-lash-and-brows', phone: '407-555-0101', website: 'amyslash.com' },
    { id: C, name: 'Lux Nail Spa', slug: 'lux-nail-spa', phone: null, website: null },
  ];
  it('another salon’s sign, phone or booking link is flagged — with who it belongs to', () => {
    const f = seenFindings({ names: ["AMY'S LASH & BROWS"], phones: ['407.555.0101'], links: ['lumiobooking.com/amys-lash-and-brows'] }, own, others);
    expect(f.map((x) => [x.kind, x.tenantId])).toEqual([['phone', B], ['name', B], ['link', B]]);
  });
  it('the salon’s own sign and number pass; brands and generic words do not trip it', () => {
    expect(seenFindings({ names: ['Saigon Spa', 'OPI', 'NAILS'], phones: ['640-213-2999'], links: ['saigonspa.com', 'opi.com'] }, own, others)).toEqual([]);
    // "Lux" alone is not "Lux Nail Spa" being named? It is: every distinctive word ("lux") is there.
    expect(seenFindings({ names: ['LUX NAIL SPA'], phones: [], links: [] }, own, others).map((x) => x.tenantId)).toEqual([C]);
    // Own name visible too (e.g. a poster for a collab): not flagged by name.
    expect(seenFindings({ names: ['Saigon Spa', 'Lux Nail Spa'], phones: [], links: [] }, own, others)).toEqual([]);
  });
  it('an unknown phone that is not ours is still flagged (no owner named)', () => {
    expect(seenFindings({ names: [], phones: ['(713) 555-0199'], links: [] }, own, others)).toEqual([{ kind: 'phone', found: '(713) 555-0199', tenantId: null }]);
  });
  it('reads the model’s JSON, and treats anything else as nothing seen', () => {
    expect(parseSeen('```json\n{"names":["A"],"phones":[],"links":["x.com"]}\n```')).toEqual({ names: ['A'], phones: [], links: ['x.com'] });
    expect(parseSeen('sorry')).toEqual({ names: [], phones: [], links: [] });
  });
});

describe('isolation: a salon never learns another salon’s name', () => {
  const g = { sha256: 's', warnings: [{ kind: 'same-file' as const, salon: 'Lux Nail Spa', at: t0.toISOString() }], checked: { fingerprint: true, picture: false } };
  it('Lumio staff see the name; the salon sees only "another salon"', () => {
    expect(forViewer(g, true).warnings[0].salon).toBe('Lux Nail Spa');
    expect(forViewer(g, false).warnings[0]).toEqual({ kind: 'same-file', at: t0.toISOString() });
  });

  function fakePrisma(rows: (FpRow & { phash: string | null })[]) {
    const saved: unknown[] = [];
    const audits: unknown[] = [];
    return {
      saved, audits,
      prisma: {
        mediaFingerprint: {
          findMany: async (a: { where: { sha256?: string; NOT: { tenantId: string } } }) =>
            rows.filter((r) => r.tenantId !== a.where.NOT.tenantId && (a.where.sha256 ? r.sha256 === a.where.sha256 : r.phash !== null)),
          create: async (a: { data: unknown }) => { saved.push(a.data); return a.data; },
        },
        tenant: { findMany: async () => [{ id: A, name: 'Saigon Spa & Tattoo', slug: 's', contactPhone: null }, { id: B, name: 'Lux Nail Spa', slug: 'l', contactPhone: null }] },
        setting: { findMany: async () => [] },
        auditLog: { create: async (a: unknown) => { audits.push(a); return a; } },
      },
    };
  }

  it('the server compares across salons, remembers the upload, and audits the warning', async () => {
    const f = fakePrisma([{ tenantId: B, sha256: 'abc', phash: null, createdAt: t0 }]);
    const svc = new MediaGuardService(f.prisma as never);
    const forSalon = await svc.inspect(A, { sha256: 'abc', kind: 'video', mime: 'video/mp4', url: 'u' }, { userId: 'u1', staff: false });
    expect(forSalon.warnings).toEqual([{ kind: 'same-file', at: t0.toISOString() }]);
    expect(JSON.stringify(forSalon)).not.toContain('Lux');
    const forStaff = await svc.inspect(A, { sha256: 'abc', kind: 'video', mime: 'video/mp4', url: 'u' }, { userId: 'u1', staff: true });
    expect(forStaff.warnings[0].salon).toBe('Lux Nail Spa');
    expect(f.saved).toHaveLength(2);
    expect((f.saved[0] as { tenantId: string }).tenantId).toBe(A);
    expect(f.audits.length).toBe(2);
  });

  it('the same salon uploading its own file again gets no warning', async () => {
    const f = fakePrisma([{ tenantId: A, sha256: 'abc', phash: null, createdAt: t0 }]);
    const svc = new MediaGuardService(f.prisma as never);
    const g2 = await svc.inspect(A, { sha256: 'abc', kind: 'video', mime: 'video/mp4' }, { staff: true });
    expect(g2.warnings).toEqual([]);
    expect(g2.checked.fingerprint).toBe(true);
  });

  it('a broken lookup never breaks the upload — it says it could not check', async () => {
    const svc = new MediaGuardService({
      mediaFingerprint: { findMany: async () => { throw new Error('db down'); }, create: async () => { throw new Error('db down'); } },
      tenant: { findMany: async () => [] }, setting: { findMany: async () => [] }, auditLog: { create: async () => null },
    } as never);
    const g = await svc.inspect(A, { sha256: 'abc', kind: 'image', mime: 'image/heic' }, {});
    expect(g).toEqual({ sha256: 'abc', warnings: [], checked: { fingerprint: false, picture: false } });
  });
});
