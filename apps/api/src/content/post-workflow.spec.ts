import { cleanStage, keepDriveLinks, mediaFileName, nextStage, postFolderName, statusFor, unarchived } from './post-workflow';

describe('post workflow — written, designed, locked', () => {
  it('reads a stage and defaults an unknown one to ready (how every old row behaves)', () => {
    expect(cleanStage('design')).toBe('design');
    expect(cleanStage(' WRITING ')).toBe('writing');
    expect(cleanStage('banana')).toBe('ready');
    expect(cleanStage(undefined, 'writing')).toBe('writing');
  });

  it('walks writing → design → ready and stops', () => {
    expect(nextStage('writing')).toBe('design');
    expect(nextStage('design')).toBe('ready');
    expect(nextStage('ready')).toBe('ready');
  });

  it('NEVER lets an unfinished post be scheduled, whatever the request said', () => {
    expect(statusFor('writing', 'scheduled')).toBe('draft');
    expect(statusFor('design', 'scheduled')).toBe('draft');
    expect(statusFor('ready', 'scheduled')).toBe('scheduled');
    expect(statusFor('ready', 'draft')).toBe('draft');
  });

  it('keeps the Drive copy of a file the screen sent back without it', () => {
    const prev = [{ url: 'https://h/a.jpg', kind: 'image' as const, driveUrl: 'https://drive/a' }, { url: 'https://h/b.jpg', kind: 'image' as const }];
    const next = keepDriveLinks([{ url: 'https://h/b.jpg', kind: 'image' }, { url: 'https://h/a.jpg', kind: 'image' }], prev);
    expect(next[1].driveUrl).toBe('https://drive/a');
    expect(next[0].driveUrl).toBeUndefined();
    expect(unarchived(next).map((m) => m.url)).toEqual(['https://h/b.jpg']);
  });

  it('names the folder by the salon day and the caption’s first words, tags and links dropped', () => {
    expect(postFolderName('2026-09-09', '✨ Simple, classy, and always in style 💅 #nails https://x.y/z')).toBe('2026-09-09 Simple classy and always in style');
    expect(postFolderName('2026-09-09', '')).toBe('2026-09-09 bai-dang');
  });

  it('names files in carousel order with the right extension', () => {
    expect(mediaFileName(0, { url: 'https://h/p/photo.JPEG', kind: 'image' })).toBe('01.jpeg');
    expect(mediaFileName(3, { url: 'https://h/clip', kind: 'video' })).toBe('04.mp4');
  });
});
