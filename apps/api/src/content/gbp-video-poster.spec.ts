import { gbpPhotoOf } from './social-publish';

/**
 * "Google chỉ hiện chữ, video không lên." Google's post API takes no video, so
 * a video post goes to Google with the video's still frame as its picture —
 * never as bare text when a frame exists.
 */
describe('the picture a Google post carries', () => {
  it('a photo wins when the post has one', () => {
    expect(gbpPhotoOf([
      { url: 'https://m/v.mp4', kind: 'video', poster: 'https://m/f.jpg' },
      { url: 'https://m/a.jpg', kind: 'image' },
    ])).toBe('https://m/a.jpg');
  });

  it('a video post uses the video\'s still frame', () => {
    expect(gbpPhotoOf([{ url: 'https://m/v.mp4', kind: 'video', poster: 'https://m/f.jpg' }])).toBe('https://m/f.jpg');
  });

  it('no frame, no photo → no picture (the text still goes up)', () => {
    expect(gbpPhotoOf([{ url: 'https://m/v.mp4', kind: 'video' }])).toBeNull();
  });

  it('a frame that is not https is ignored', () => {
    expect(gbpPhotoOf([{ url: 'https://m/v.mp4', kind: 'video', poster: 'data:image/jpeg;base64,xx' }])).toBeNull();
  });
});
