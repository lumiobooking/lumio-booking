/**
 * `npm run test:guards` — the deploy gate, with the reason WHY at the END.
 *
 * Render's log viewer lands on the last lines of a failed build, and jest
 * writes its failures first and a long "Ran all test suites matching …" line
 * last — so every failed deploy showed the pattern and nothing else. This
 * runs jest as before, streams its output, and when it fails prints the
 * failing suites and their "●" blocks AGAIN at the very end. Nothing about
 * what is tested changes: the pattern below is the whole gate.
 */
const { spawn } = require('child_process');
const path = require('path');

const PATTERN = require('../package.json').guardPattern;
if (!PATTERN) { console.error('guardPattern missing in package.json'); process.exit(1); }

/** The failing suites and their "●" blocks, from jest's full output. */
function summarize(rawLines, signal) {
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const clean = rawLines.map(strip);
  const out = [];
  out.push('', '================ WHY test:guards FAILED (repeated for the log tail) ================');
  if (signal) out.push(`jest was killed by signal ${signal} (out of memory on the build machine?)`);
  clean.filter((l) => /^\s*FAIL /.test(l)).forEach((l) => out.push(l.trim()));
  let block = [];
  let inBlock = false;
  let kept = 0;
  const flush = () => { if (block.length && kept < 12) { out.push(...block.slice(0, 40)); kept++; } block = []; inBlock = false; };
  for (const l of clean) {
    if (/^\s*● /.test(l) && !/●.*Console/.test(l)) { flush(); block = [l]; inBlock = true; continue; }
    if (inBlock) {
      if (/^(Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites)/.test(l)) { flush(); continue; }
      block.push(l);
    }
  }
  flush();
  clean.filter((l) => /^(Test Suites:|Tests:)/.test(l) || /heap|out of memory|worker process|timed out|Timeout/i.test(l)).slice(-12).forEach((l) => out.push(l));
  out.push('====================================================================================');
  return out.join('\n') + '\n';
}
module.exports = { summarize };

if (require.main === module) {
  const jest = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
  const args = ['--selectProjects', 'api', 'web', '--maxWorkers=2', '--workerIdleMemoryLimit=768MB', '--testPathPattern', PATTERN, ...process.argv.slice(2)];
  const lines = [];
  const child = spawn(jest, args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '0' } });
  const tap = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      const s = d.toString();
      out.write(s);
      buf += s;
      const parts = buf.split('\n');
      buf = parts.pop();
      lines.push(...parts);
    });
    stream.on('end', () => { if (buf) lines.push(buf); });
  };
  tap(child.stdout, process.stdout);
  tap(child.stderr, process.stderr);
  child.on('close', (code, signal) => {
    if (code === 0) process.exit(0);
    process.stdout.write(summarize(lines, signal));
    process.exit(code || 1);
  });
}
