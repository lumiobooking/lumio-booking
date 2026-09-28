import { GoogleReviewsService } from './google-reviews.service';

/**
 * "Video trên Google được phép đăng thủ công, tại sao hệ thống không đăng?"
 * The Business Profile screen takes a video in a post; the API has refused it
 * for years. So a post with a video goes out as text (+ photo), and the video
 * is added to the profile's Photos & videos — the part of the API that does
 * take video. These pin that the post is never lost over the video.
 */
describe('Google Business post with a video', () => {
  const calls: { url: string; body: any }[] = [];
  let answer: (url: string, body: any) => { status: number; json: any };

  const svc = new GoogleReviewsService({} as any, {} as any, {} as any);
  beforeEach(() => {
    calls.length = 0;
    jest.spyOn(svc as any, 'getSettings').mockResolvedValue({ connected: true, locationId: '123' });
    jest.spyOn(svc as any, 'postingLocation').mockResolvedValue({ parent: 'accounts/1/locations/123', title: 'Lux' });
    jest.spyOn(svc as any, 'accessToken').mockResolvedValue('tok');
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ url, body });
      const a = answer(url, body);
      return { ok: a.status < 300, status: a.status, text: async () => JSON.stringify(a.json) };
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const post = { summary: 'Móng mới', languageCode: 'vi' as const, photoUrl: null, videoUrl: 'https://media.x/v.mp4', cta: null };

  it('Google refuses the video in the post → the post goes out without it, and says so', async () => {
    answer = (url, body) => (/localPosts/.test(url) && body?.media?.[0]?.mediaFormat === 'VIDEO'
      ? { status: 400, json: { error: { message: 'Request contains an invalid argument.' } } }
      : { status: 200, json: { name: 'accounts/1/locations/123/localPosts/9', searchUrl: 'https://g.co/x' } });
    const out = await svc.createLocalPost('t1', post);
    expect(out).toMatchObject({ name: 'accounts/1/locations/123/localPosts/9', videoInPost: false });
    expect(calls).toHaveLength(2);
    expect(calls[1].body.media).toBeUndefined(); // text-only retry, no photo given
  });

  it('with a photo too, the retry carries the photo', async () => {
    answer = (url, body) => (body?.media?.[0]?.mediaFormat === 'VIDEO' ? { status: 400, json: {} } : { status: 200, json: { name: 'p' } });
    await svc.createLocalPost('t1', { ...post, photoUrl: 'https://media.x/a.jpg' });
    expect(calls[1].body.media).toEqual([{ mediaFormat: 'PHOTO', sourceUrl: 'https://media.x/a.jpg' }]);
  });

  it('if Google ever accepts the video in the post, it stays there', async () => {
    answer = () => ({ status: 200, json: { name: 'p' } });
    const out = await svc.createLocalPost('t1', post);
    expect(out.videoInPost).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('adds the video to the profile\'s Photos & videos', async () => {
    answer = () => ({ status: 200, json: { name: 'accounts/1/locations/123/media/7' } });
    const out = await svc.addLocationVideo('t1', 'https://media.x/v.mp4');
    expect(out.name).toBe('accounts/1/locations/123/media/7');
    expect(calls[0].url).toBe('https://mybusiness.googleapis.com/v4/accounts/1/locations/123/media');
    expect(calls[0].body).toEqual({ mediaFormat: 'VIDEO', locationAssociation: { category: 'ADDITIONAL' }, sourceUrl: 'https://media.x/v.mp4' });
  });
});
