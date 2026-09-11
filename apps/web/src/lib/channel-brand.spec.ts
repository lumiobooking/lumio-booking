import { channelBrand, channelOf } from './inbox-view';

/**
 * The badge is the only thing on a row that says which app the customer is in.
 * It used to be a typographic mark that read as "mail" for Messenger, so these
 * pin the one property that carries the recognition: the colour, per channel,
 * all four different from each other.
 */
describe('the channel badge', () => {
  it('gives every channel its own colour', () => {
    const seen = ['messenger', 'instagram', 'zalo', 'web'].map((c) => channelBrand(c).bg);
    expect(new Set(seen).size).toBe(4);
  });

  it('names the channel in words for the tooltip and for screen readers', () => {
    expect(channelBrand('instagram').name).toBe('Instagram');
    expect(channelBrand('zalo').name).toBe('Zalo');
    expect(channelBrand('web').name).toBe('Website');
    expect(channelBrand('messenger').name).toBe('Messenger');
  });

  it('falls back to Messenger for anything it does not know, like channelOf', () => {
    for (const junk of ['', null, undefined, 'sms', 'WHATSAPP']) {
      expect(channelBrand(junk).name).toBe('Messenger');
      expect(channelOf(junk)).toBe('messenger');
    }
  });

  it('reads a channel written in capitals', () => {
    expect(channelBrand('Instagram').name).toBe('Instagram');
    expect(channelBrand(' ZALO ').name).toBe('Zalo');
  });
});
