import * as fs from 'fs';
import * as path from 'path';

/**
 * Publishing must not be switched off by the flag that switches off drafting.
 *
 * WHAT WENT WRONG
 *
 * The post sweeper was started at the bottom of `onModuleInit`, which put it
 * AFTER `if (CONTENT_PLANNER_ENABLED !== 'true') return`. Two different jobs on
 * one switch — and the wrong way round:
 *
 *   DRAFTING calls a paid AI API for every salon every hour. It is exactly the
 *   thing somebody turns off to stop a bill, or leaves off outside production.
 *
 *   PUBLISHING sends posts the salon has already written and approved and is
 *   waiting for. It costs nothing to run, and stopping it is invisible: no
 *   error, no log, the queue simply never fires and the salon finds out when a
 *   customer mentions the Page has gone quiet.
 *
 * So the sweeper starts first, unconditionally. This test pins that order,
 * because it is the kind of thing a later edit reorders without noticing.
 */

const SRC = fs.readFileSync(path.join(__dirname, 'content.scheduler.ts'), 'utf8');
const RAW_INIT = /onModuleInit\(\)\s*\{([^]*?)\n  \}/.exec(SRC)?.[1] ?? '';
/**
 * The body with comments removed.
 *
 * The comment above the sweeper NAMES the flag it must not depend on, so a
 * naive index search finds the prose before the code and passes for the wrong
 * reason. Order-of-execution claims have to be measured on executable lines.
 */
const INIT = RAW_INIT.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('the scheduler starts publishing before it checks the drafting flag', () => {
  it('reads onModuleInit at all, so a pass here means something', () => {
    expect(INIT).toContain('postTimer');
    expect(INIT).toContain('CONTENT_PLANNER_ENABLED');
    // And the comment stripping really removed something, or the guard above is
    // measuring the same string twice.
    expect(RAW_INIT.length).toBeGreaterThan(INIT.length);
  });

  it('starts the post sweeper before the planner flag is read', () => {
    expect(INIT.indexOf('postTimer')).toBeLessThan(INIT.indexOf('CONTENT_PLANNER_ENABLED'));
  });

  it('starts the post sweeper before any early return', () => {
    const firstReturn = INIT.indexOf('return;');
    expect(firstReturn).toBeGreaterThan(-1);
    expect(INIT.indexOf('this.postTimer = setInterval')).toBeLessThan(firstReturn);
  });

  it('says out loud that posts still publish when drafting is off', () => {
    // The log line is the only way anybody operating this learns the two are
    // independent. Without it the next person re-couples them to "tidy up".
    expect(RAW_INIT).toMatch(/Scheduled posts still publish/);
  });

  it('sweeps on a much faster clock than the hourly planner', () => {
    // A post scheduled for 9:00 must go out at 9:00, not somewhere in the hour
    // that follows.
    const post = /postIntervalMs\s*=\s*([^;]+);/.exec(SRC)?.[1] ?? '';
    const plan = /intervalMs\s*=\s*([^;]+);/.exec(SRC)?.[1] ?? '';
    // eslint-disable-next-line no-eval
    expect(eval(post)).toBeLessThanOrEqual(60 * 1000);
    // eslint-disable-next-line no-eval
    expect(eval(post)).toBeLessThan(eval(plan));
  });

  it('clears both timers on shutdown, so a reload does not double-publish', () => {
    const destroy = /onModuleDestroy\(\)\s*\{([^]*?)\n  \}/.exec(SRC)?.[1] ?? '';
    expect(destroy).toContain('this.timer');
    expect(destroy).toContain('this.postTimer');
  });
});
