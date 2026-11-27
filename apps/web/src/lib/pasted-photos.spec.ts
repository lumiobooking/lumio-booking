import { dragHasFiles, imageFiles, splitSendable } from './pasted-photos';

const file = (name: string, type: string, size = 10) => ({ name, type, size } as unknown as File);

describe('rt244 pasted / dropped photos', () => {
  it('takes images from files and clipboard items, once each, max 5', () => {
    const a = file('a.png', 'image/png');
    const items = [{ kind: 'file', type: 'image/png', getAsFile: () => a }, { kind: 'string', type: 'text/plain', getAsFile: () => null }];
    expect(imageFiles({ files: [a], items })).toHaveLength(1);
    const many = Array.from({ length: 8 }, (_, i) => file(`p${i}.jpg`, 'image/jpeg', i + 1));
    expect(imageFiles({ files: many })).toHaveLength(5);
  });
  it('ignores non-images and empty payloads', () => {
    expect(imageFiles({ files: [file('a.pdf', 'application/pdf')] })).toEqual([]);
    expect(imageFiles(null)).toEqual([]);
  });
  it('splits what Messenger can take from GIF/HEIC', () => {
    const r = splitSendable([file('a.webp', 'image/webp'), file('b.gif', 'image/gif'), file('c.heic', 'image/heic')]);
    expect(r.ok.map((f) => f.name)).toEqual(['a.webp']);
    expect(r.bad).toHaveLength(2);
  });
  it('lights up only for file drags', () => {
    expect(dragHasFiles(['Files'])).toBe(true);
    expect(dragHasFiles(['text/plain'])).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });
});
