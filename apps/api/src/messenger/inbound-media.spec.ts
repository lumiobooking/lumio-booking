import { describeMedia, imageUrls, imageMediaType, metaAttachments, nonImageRule, visionRule, zaloAttachments } from './inbound-media';

describe('what the customer sent that is not words', () => {
  it('reads a Messenger photo, and tells a sticker apart from a picture', () => {
    const m = metaAttachments({
      attachments: [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/a.jpg' } },
        { type: 'image', payload: { url: 'https://cdn/sticker.png', sticker_id: 369239263222822 } },
        { type: 'fallback', payload: { url: 'https://example.com', title: 'A link' } },
        { type: 'video', payload: { url: 'https://cdn/v.mp4' } },
      ],
    });
    expect(m).toEqual([
      { kind: 'image', url: 'https://lookaside.fbsbx.com/a.jpg' },
      { kind: 'sticker', url: 'https://cdn/sticker.png' },
      { kind: 'video', url: 'https://cdn/v.mp4' },
    ]);
    expect(imageUrls(m)).toEqual(['https://lookaside.fbsbx.com/a.jpg']);
  });

  it('is empty for a plain text message and a missing message', () => {
    expect(metaAttachments({ text: 'hi' })).toEqual([]);
    expect(metaAttachments(undefined)).toEqual([]);
  });

  it('reads Zalo by event name', () => {
    expect(zaloAttachments('user_send_image', { attachments: [{ type: 'image', payload: { url: 'https://z/x.jpg' } }] }))
      .toEqual([{ kind: 'image', url: 'https://z/x.jpg' }]);
    expect(zaloAttachments('user_send_sticker', {})).toEqual([{ kind: 'sticker', url: null }]);
    expect(zaloAttachments('user_send_audio', { attachments: [{ type: 'audio', payload: { url: 'https://z/a.m4a' } }] })).toEqual([{ kind: 'audio', url: 'https://z/a.m4a' }]);
    expect(zaloAttachments('user_send_text', { text: 'hi' })).toEqual([]);
    expect(zaloAttachments('follow', {})).toEqual([]);
  });

  it('writes the placeholder the inbox and the model both read', () => {
    expect(describeMedia([{ kind: 'image', url: 'x' }])).toBe('[Khách gửi 1 ảnh]');
    expect(describeMedia([{ kind: 'image', url: 'x' }, { kind: 'image', url: 'y' }, { kind: 'sticker', url: null }])).toBe('[Khách gửi 2 ảnh, gửi sticker]');
    expect(describeMedia([])).toBe('');
  });

  it('never lets the model look at more than three photos', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ kind: 'image' as const, url: `https://c/${i}.jpg` }));
    expect(imageUrls(many)).toHaveLength(3);
  });

  it('tells the model how to treat a picture, and what to say to a voice note', () => {
    expect(visionRule()).toMatch(/never invent one/);
    expect(visionRule()).toMatch(/do not confirm any payment/);
    expect(nonImageRule([{ kind: 'audio', url: null }])).toMatch(/voice message/);
    expect(nonImageRule([{ kind: 'sticker', url: null }])).toMatch(/sticker/);
    // A photo alongside a sticker: the photo rule speaks, the sticker line stays quiet.
    expect(nonImageRule([{ kind: 'image', url: 'x' }, { kind: 'sticker', url: null }])).toBe('');
  });

  it('accepts only the image types the API takes', () => {
    expect(imageMediaType('image/jpeg; charset=binary')).toBe('image/jpeg');
    expect(imageMediaType('image/jpg')).toBe('image/jpeg');
    expect(imageMediaType('image/webp')).toBe('image/webp');
    expect(imageMediaType('image/heic')).toBeNull();
    expect(imageMediaType(null)).toBeNull();
  });
});
