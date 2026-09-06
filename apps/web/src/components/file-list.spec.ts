import * as fs from 'fs';
import * as path from 'path';

/**
 * A `FileList` from `<input type="file">` is LIVE: clearing the input
 * (`e.target.value = ''`, done so the same photo can be picked twice) empties
 * the list for everyone still holding it. The suggestion card handed the list
 * to an async upload and cleared the input on the next line — the upload saw
 * 0 files, showed "Đang gửi Infinity%", and never finished. A shop that had
 * just filmed for us could not send it.
 *
 * Rule: `.files` may only be read as a single file (`?.[0]`, `[0]`) or copied
 * at once (`Array.from(…)`). Never handed on as the list itself.
 */

const ROOTS = [path.join(__dirname), path.join(__dirname, '..', 'app')];
// Only the DOM's: `e.target.files`, `input.files`, `ev.dataTransfer.files`.
// A plain `.files` property on our own records is a normal array.
const DOM_FILES = /(?:target|current|dataTransfer|input|el)\??\.files\b/;
const OK = /\.files\s*(\?\.\[0\]|\[0\]|\?\.length|\.length)/;
const COPY = /Array\.from\(\s*[\w.?]*\.files/;

function walk(dir: string, out: string[] = []): string[] {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(n) && !/\.spec\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe('a live FileList is never passed on as-is', () => {
  const files = ROOTS.flatMap((r) => (fs.existsSync(r) ? walk(r) : []));
  it('scans something', () => expect(files.length).toBeGreaterThan(10));

  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DOM_FILES.test(line)) return;
      it(`${path.relative(ROOTS[0], f)}:${i + 1}`, () => {
        expect(OK.test(line) || COPY.test(line)).toBe(true);
      });
    });
  }
});
