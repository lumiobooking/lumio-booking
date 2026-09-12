import { walkFbPages, firstAccountsUrl, FB_MAX_HOPS, FB_MAX_ROWS, FbPagesBody } from './fb-pages';

const page = (n: number) => ({ id: `p${n}`, name: `Page ${n}`, access_token: `t${n}` });

/** A fake Graph that hands out `total` pages in batches of `size`. */
function graphWith(total: number, size = 100) {
  const calls: string[] = [];
  const get = async (url: string): Promise<FbPagesBody> => {
    calls.push(url);
    const from = Number(new URL(url).searchParams.get('after') ?? 0);
    const data = Array.from({ length: Math.min(size, total - from) }, (_, i) => page(from + i));
    const nextFrom = from + data.length;
    return {
      data,
      paging: nextFrom < total ? { next: `https://graph.facebook.com/v21.0/me/accounts?after=${nextFrom}` } : {},
    };
  };
  return { get, calls };
}

describe('every Page an agency manages, not the first 25', () => {
  it('asks for 100 at a time instead of taking Meta’s default 25', () => {
    expect(firstAccountsUrl('tok')).toContain('limit=100');
  });

  it('keeps following the cursor past the first batch', async () => {
    const g = graphWith(63);
    const out = await walkFbPages('tok', g.get);
    expect(out.pages).toHaveLength(63);
    expect(out.error).toBeUndefined();
    expect(out.truncated).toBe(false);
  });

  it('is the actual reported bug: 60 pages must not come back as 25', async () => {
    // The old code did exactly one fetch of Meta's default page size.
    const g = graphWith(60, 25);
    const onlyFirstBatch = (await g.get(firstAccountsUrl('tok'))).data ?? [];
    expect(onlyFirstBatch).toHaveLength(25);
    const walked = await walkFbPages('tok', graphWith(60, 25).get);
    expect(walked.pages).toHaveLength(60);
  });

  it('returns one row per Page when Meta repeats rows across cursor pages', async () => {
    let hop = 0;
    const get = async (): Promise<FbPagesBody> => {
      hop += 1;
      if (hop === 1) return { data: [page(1), page(2)], paging: { next: 'x' } };
      return { data: [page(2), page(3)] };
    };
    const out = await walkFbPages('tok', get);
    expect(out.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });

  it('keeps what it already read when a later hop fails', async () => {
    let hop = 0;
    const get = async (): Promise<FbPagesBody> => {
      hop += 1;
      if (hop === 1) return { data: [page(1), page(2)], paging: { next: 'x' } };
      throw new Error('socket hang up');
    };
    const out = await walkFbPages('tok', get);
    expect(out.pages).toHaveLength(2);
    expect(out.error).toBeUndefined();   // partial is not failure
    expect(out.truncated).toBe(true);
  });

  it('reports an error only when it could read nothing at all', async () => {
    const out = await walkFbPages('tok', async () => ({ error: { message: 'Invalid OAuth token' } }));
    expect(out.pages).toHaveLength(0);
    expect(out.error).toBe('Invalid OAuth token');
  });

  it('does not loop for ever on a cursor that never ends', async () => {
    let hops = 0;
    const get = async (): Promise<FbPagesBody> => {
      hops += 1;
      return { data: [page(hops)], paging: { next: 'always-more' } };
    };
    const out = await walkFbPages('tok', get);
    expect(hops).toBe(FB_MAX_HOPS);
    expect(out.truncated).toBe(true);
  });

  it('stops at the row ceiling and says so rather than pretending it saw it all', async () => {
    const g = graphWith(5000);
    const out = await walkFbPages('tok', g.get);
    expect(out.pages.length).toBeGreaterThanOrEqual(FB_MAX_ROWS);
    expect(out.truncated).toBe(true);
  });

  it('survives a body with no data and no paging', async () => {
    const out = await walkFbPages('tok', async () => ({}));
    expect(out.pages).toEqual([]);
    expect(out.error).toBeUndefined();
  });

  it('writes a trace a person can read when a salon reports missing pages', async () => {
    const trace: string[] = [];
    await walkFbPages('tok', graphWith(150).get, trace);
    expect(trace.join('\n')).toMatch(/hop 1: \+100 \(total 100\)/);
    expect(trace.join('\n')).toMatch(/hop 2: \+50 \(total 150\)/);
  });
});
