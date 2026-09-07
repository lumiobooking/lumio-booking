import { extOf, resolveMime, cleanMime } from './media-mime';

describe('resolveMime', () => {
  it('believes a declared image or video type', () => {
    expect(resolveMime({ declared: 'video/quicktime', name: 'x.bin' })).toBe('video/quicktime');
    expect(resolveMime({ declared: 'image/png; charset=binary' })).toBe('image/png');
  });

  it('ignores a hosting that calls a clip text and reads the extension instead', () => {
    expect(resolveMime({ declared: 'text/plain', name: 'https://h/x/clip.mp4?x=1' })).toBe('video/mp4');
    expect(resolveMime({ declared: 'application/octet-stream', name: 'IMG_0012.MOV' })).toBe('video/quicktime');
    expect(resolveMime({ declared: '', name: 'photo.JPG' })).toBe('image/jpeg');
  });

  it('falls back to what the caller knows, then to nothing', () => {
    expect(resolveMime({ declared: 'text/html', name: 'https://h/x/abc', kind: 'video' })).toBe('video/mp4');
    expect(resolveMime({ declared: undefined, name: undefined, kind: 'image' })).toBe('image/jpeg');
    expect(resolveMime({ declared: 'text/plain', name: 'notes.txt' })).toBe('');
  });

  it('reads extensions off names and urls', () => {
    expect(extOf('a/b/c.MP4#frag')).toBe('mp4');
    expect(extOf('noext')).toBeNull();
    expect(cleanMime(' Video/MP4 ; x')).toBe('video/mp4');
  });
});
