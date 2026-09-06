import { putChunk, haveChunks, assemble, dropChunks, sweepChunks, putResult, getResult, dropPieces } from './chunk-store';

const T = 'tenant-spec-' + process.pid;
const U = 'upload-' + Date.now().toString(36) + 'abcdef';

describe('a file arrives in pieces', () => {
  afterAll(() => dropChunks(T, U));

  it('remembers which pieces it has, in order, and assembles only when all are in', async () => {
    await putChunk(T, U, 2, Buffer.from('CC'));
    await putChunk(T, U, 0, Buffer.from('AA'));
    expect(await haveChunks(T, U)).toEqual([0, 2]);
    expect(await assemble(T, U, 3)).toBeNull();
    await putChunk(T, U, 1, Buffer.from('BB'));
    expect((await assemble(T, U, 3))!.toString()).toBe('AABBCC');
  });

  it('the same piece twice is the same piece', async () => {
    await putChunk(T, U, 1, Buffer.from('BB'));
    expect(await haveChunks(T, U)).toEqual([0, 1, 2]);
  });

  it('refuses ids that could leave the tenant’s folder', async () => {
    await expect(putChunk(T, '../../etc', 0, Buffer.from('x'))).rejects.toThrow();
    expect(await haveChunks(T, '../x')).toEqual([]);
    expect(await haveChunks('', U)).toEqual([]);
  });

  it('drops everything on request, and the sweep leaves fresh uploads alone', async () => {
    expect(await sweepChunks()).toBe(0);
    await dropChunks(T, U);
    expect(await haveChunks(T, U)).toEqual([]);
  });

  it('keeps the answer after the pieces are gone, so a second ask gets the same file', async () => {
    await putChunk(T, U, 0, Buffer.from('x'));
    await putResult(T, U, { url: 'https://cdn/x.mp4', kind: 'video', at: 1 });
    await dropPieces(T, U);
    expect(await haveChunks(T, U)).toEqual([]);
    expect(await getResult(T, U)).toMatchObject({ url: 'https://cdn/x.mp4', kind: 'video' });
    await dropChunks(T, U);
    expect(await getResult(T, U)).toBeNull();
  });

  it('a sweep a day later removes what was abandoned', async () => {
    await putChunk(T, U, 0, Buffer.from('x'));
    expect(await sweepChunks(Date.now() + 25 * 60 * 60 * 1000)).toBeGreaterThanOrEqual(1);
    expect(await haveChunks(T, U)).toEqual([]);
  });
});
