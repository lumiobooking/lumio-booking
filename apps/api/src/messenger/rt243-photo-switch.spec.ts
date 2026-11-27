import { withPhotoSwitch } from './photo-switch';

describe('rt243 AI auto-photo switch', () => {
  const tools = [{ name: 'book' }, { name: 'send_photos' }, { name: 'style' }];
  it('keeps send_photos when on or unset (default on)', () => {
    expect(withPhotoSwitch(tools, true)).toHaveLength(3);
    expect(withPhotoSwitch(tools, undefined)).toHaveLength(3);
    expect(withPhotoSwitch(tools, null)).toHaveLength(3);
  });
  it('drops only send_photos when the owner turned it off', () => {
    expect(withPhotoSwitch(tools, false).map((t) => t.name)).toEqual(['book', 'style']);
  });
  it('is per salon: one salon off does not change another salon\'s tools', () => {
    const a = withPhotoSwitch(tools, false);
    const b = withPhotoSwitch(tools, true);
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(3);
    expect(tools).toHaveLength(3);
  });
});
