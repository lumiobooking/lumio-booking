import { publishGrantFrom, explainPublishGap } from './publish-grant';

const both = { fb: true, ig: true };

describe('publishGrantFrom', () => {
  it('reads granted and declined straight off the answer', () => {
    const g = publishGrantFrom([
      { permission: 'pages_manage_posts', status: 'granted' },
      { permission: 'instagram_content_publish', status: 'declined' },
    ], both, 'T');
    expect(g.scopes).toEqual({ pages_manage_posts: 'granted', instagram_content_publish: 'declined' });
    expect(g.at).toBe('T');
  });

  it('CALLS A SCOPE WE ASKED FOR AND META NEVER SHOWED "not-asked"', () => {
    // This is the case a reconnect can never fix, and the one the old warning
    // sent people to reconnect for.
    const g = publishGrantFrom([{ permission: 'pages_messaging', status: 'granted' }], both);
    expect(g.scopes.pages_manage_posts).toBe('not-asked');
  });

  it('knows the difference between Meta dropping it and us never asking', () => {
    const g = publishGrantFrom([], { fb: false, ig: false });
    expect(g.scopes.pages_manage_posts).toBe('not-requested');
    expect(g.scopes.instagram_content_publish).toBe('not-requested');
  });

  it('survives a missing or malformed answer', () => {
    expect(publishGrantFrom(null, both).scopes.pages_manage_posts).toBe('not-asked');
    expect(publishGrantFrom([{ permission: 'pages_manage_posts', status: 'weird' }], both).scopes.pages_manage_posts).toBe('not-asked');
  });
});

describe('explainPublishGap', () => {
  const grant = (fb: string, ig = 'granted') => ({ at: 'T', scopes: { pages_manage_posts: fb, instagram_content_publish: ig } }) as never;

  it('says RECONNECT when the person unticked it — that reconnect works', () => {
    expect(explainPublishGap(['pages_manage_posts'], grant('declined'))).toEqual({ cause: 'declined', reconnectHelps: true });
  });

  it('says DO NOT BOTHER RECONNECTING when Meta did not offer it', () => {
    expect(explainPublishGap(['pages_manage_posts'], grant('not-asked'))).toEqual({ cause: 'not-offered', reconnectHelps: false });
  });

  it('blames the app config, not the salon, when the dialog never had it', () => {
    expect(explainPublishGap(['pages_manage_posts'], grant('not-requested'))).toEqual({ cause: 'not-requested', reconnectHelps: false });
  });

  it('lets the worst news win across two scopes', () => {
    expect(explainPublishGap(['pages_manage_posts', 'instagram_content_publish'], grant('declined', 'not-asked')).cause).toBe('not-offered');
  });

  it('calls a granted-but-absent scope stale, and still suggests a reconnect', () => {
    expect(explainPublishGap(['pages_manage_posts'], grant('granted'))).toEqual({ cause: 'stale', reconnectHelps: true });
  });

  it('falls back to the old advice when nothing was recorded (connected before this existed)', () => {
    expect(explainPublishGap(['pages_manage_posts'], null)).toEqual({ cause: 'unknown', reconnectHelps: true });
  });

  it('has nothing to explain when nothing is missing', () => {
    expect(explainPublishGap([], grant('declined')).reconnectHelps).toBe(false);
  });
});
