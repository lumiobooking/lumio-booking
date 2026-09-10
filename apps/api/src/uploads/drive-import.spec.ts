import { driveFileIdFrom, drivePublicDownloadUrl, importCheck, isDriveLink, jobView, IMPORT_VIDEO_MAX } from './drive-import';

describe('a Drive link, read for its file', () => {
  it('finds the id in every share-link shape', () => {
    expect(driveFileIdFrom('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFileIdFrom('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFileIdFrom('https://drive.google.com/uc?id=1AbCdEfGhIjKlMnOp&export=download')).toBe('1AbCdEfGhIjKlMnOp');
    expect(driveFileIdFrom('https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
  });

  it('is not fooled by other hosts or by a folder link', () => {
    expect(driveFileIdFrom('https://cdn.lumio.app/v/1.mp4')).toBeNull();
    // A folder is not a file: nothing to import.
    expect(isDriveLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp')).toBe(false);
    expect(driveFileIdFrom('https://drive.google.com/drive/u/0/my-drive')).toBeNull();
  });

  it('builds the public download address with the confirm flag', () => {
    expect(drivePublicDownloadUrl('abc_123')).toBe('https://drive.usercontent.google.com/download?id=abc_123&export=download&confirm=t');
  });
});

describe('what may be imported', () => {
  it('takes a video up to a gigabyte and an image up to 12 MB', () => {
    expect(importCheck({ mime: 'video/mp4', size: 600 * 1048576, name: 'a.mp4' })).toEqual({ kind: 'video', problem: null });
    expect(importCheck({ mime: 'video/quicktime', size: IMPORT_VIDEO_MAX + 1, name: 'a.mov' }).problem).toMatch(/tối đa 1 GB/);
    expect(importCheck({ mime: 'image/jpeg', size: 20 * 1048576, name: 'a.jpg' }).problem).toMatch(/12 MB/);
  });

  it('reads the kind off the name when Drive only says octet-stream', () => {
    expect(importCheck({ mime: 'application/octet-stream', size: 100, name: 'clip.MOV' }).kind).toBe('video');
  });

  it('turns Google’s viewer page into the sentence about sharing', () => {
    expect(importCheck({ mime: 'text/html; charset=utf-8', size: null, name: '' }).problem).toMatch(/Bất kỳ ai có đường liên kết/);
  });

  it('refuses a document', () => {
    expect(importCheck({ mime: 'application/pdf', size: 100, name: 'menu.pdf' }).problem).toMatch(/không phải ảnh\/video/);
  });
});

describe('what the screen polls', () => {
  it('reports percent only once the size is known, and never 100 before done', () => {
    const base = { id: 'j', tenantId: 't', state: 'running' as const, url: null, kind: null, error: null, startedAt: 0 };
    expect(jobView({ ...base, loaded: 50, size: null }).pct).toBeNull();
    expect(jobView({ ...base, loaded: 100, size: 100 }).pct).toBe(99);
    expect(jobView({ ...base, loaded: 25 * 1048576, size: 100 * 1048576 })).toMatchObject({ pct: 25, loadedMb: 25, sizeMb: 100 });
  });
});
