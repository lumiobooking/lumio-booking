import * as fs from 'fs';
import * as path from 'path';

/**
 * The lint that keeps anything floating on a phone above the tab bar.
 *
 * WHAT HAPPENED
 *
 * The salon app's bottom navigation is `position: fixed; bottom: 0` at z-index
 * 60. The chat launcher — the only way into the thread on a phone — was placed
 * at `bottom: 16` with the SAME z-index 60. Same stacking level, drawn earlier,
 * sixty pixels of navigation on top of it: the button was not merely awkward to
 * reach, it was invisible. It took a user screenshot to find, and the code read
 * as perfectly reasonable in isolation, because nothing in the file mentions
 * the tab bar.
 *
 * That is exactly the shape of bug a human should not be the detector for. Both
 * halves of the collision are in this repository and both are readable from
 * source, so the invariant is checkable: whatever floats above the phone
 * viewport must sit ABOVE the bar in z-order and CLEAR of it in offset.
 *
 * WHY IT READS THE SOURCE
 *
 * These are inline style objects on components that need a browser, a session
 * and a live thread to render. Rendering them to assert a CSS offset would test
 * a mock. The numbers themselves are the contract, and they are right here.
 */

const HERE = __dirname;
const read = (f: string) => fs.readFileSync(path.join(HERE, f), 'utf8');

/** The bar every floating control on a phone has to get out of the way of. */
function tabBar() {
  const src = read('MobileTabBar.tsx');
  const nav = /<nav style=\{\{([^]*?)\}\}>/.exec(src);
  expect(nav).toBeTruthy();
  const z = /zIndex:\s*(\d+)/.exec(nav![1]);
  expect(z).toBeTruthy();
  return { zIndex: Number(z![1]), style: nav![1] };
}

describe('the phone tab bar is what every floating control has to clear', () => {
  it('is still pinned to the bottom of the viewport', () => {
    // If this ever stops being true the rest of this file is measuring nothing,
    // so it fails loudly rather than passing vacuously.
    expect(tabBar().style).toMatch(/position:\s*'fixed'/);
    expect(tabBar().style).toMatch(/bottom:\s*0/);
  });
});

describe('the chat launcher on a phone', () => {
  const src = read('ContentChat.tsx');
  // The launcher is the button inside TeamChatWindow's `!open` branch.
  const launcher = /aria-label=\{vi \? 'Mở trao đổi với Lumio'[^]*?style=\{\{([^]*?)\}\}/.exec(src);

  it('exists and is still identifiable', () => {
    expect(launcher).toBeTruthy();
  });

  it('stacks above the tab bar rather than level with it', () => {
    const z = Number(/zIndex:\s*(\d+)/.exec(launcher![1])![1]);
    expect(z).toBeGreaterThan(tabBar().zIndex);
  });

  it('sits clear of the bar, not inside the space it occupies', () => {
    // `main` reserves 88px of bottom padding for the bar, so anything under
    // roughly that number is underneath the navigation.
    const bottom = /bottom:\s*'calc\((\d+)px/.exec(launcher![1]);
    expect(bottom).toBeTruthy();
    expect(Number(bottom![1])).toBeGreaterThanOrEqual(72);
  });

  it('leaves room for the iPhone home bar underneath it', () => {
    expect(launcher![1]).toContain('env(safe-area-inset-bottom');
  });

  it('says what it opens instead of being a bare circle in a corner', () => {
    const label = /aria-label=\{vi \? 'Mở trao đổi với Lumio'[^]*?<\/button>/.exec(src)![0];
    expect(label).toMatch(/Nhắn Lumio/);
  });
});

describe('the opened thread covers the bar rather than fighting it', () => {
  it('goes full-screen above everything on a phone', () => {
    const src = read('ContentChat.tsx');
    const panel = /position:\s*'fixed',\s*zIndex:\s*(\d+),\s*\n\s*\/\/ Phone: the whole screen/.exec(src);
    expect(panel).toBeTruthy();
    expect(Number(panel![1])).toBeGreaterThan(tabBar().zIndex);
  });
});
