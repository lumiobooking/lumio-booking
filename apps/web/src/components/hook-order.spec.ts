import * as fs from 'fs';
import * as path from 'path';

/**
 * No React hook may sit below an early return.
 *
 * WHAT THIS COST
 *
 * A `useEffect` for a sidebar badge was written next to the code that uses it,
 * which happened to be BELOW `if (!ready || !token …) return <Loading/>`. React
 * counts hooks per render: the loading pass ran one fewer hook than the loaded
 * pass, so the second render threw. Every page in the salon app renders inside
 * SalonShell, so one misplaced line turned the entire product into
 * "Application error: a client-side exception has occurred" — the marketing
 * site, the salon app, every route.
 *
 * It type-checked. It passed every test. It built cleanly on Render. The rule
 * it broke is a React rule, and nothing in the pipeline knew about React rules.
 *
 * WHY A TEXT SCAN AND NOT A LINTER
 *
 * `react-hooks/rules-of-hooks` catches this, and this repo has no ESLint config
 * — running `next lint` offers to create one. Adding a whole lint setup under
 * production-down pressure is how a second mistake gets made. This scan is
 * narrow, has no dependencies, runs in the guard shards that already exist, and
 * fails with the file and line. If ESLint arrives later, this can go.
 *
 * WHAT IT CHECKS
 *
 * Inside a top-level `export function Component()` / `export default function`,
 * find the first statement-level `return` at the function's own brace depth,
 * then assert no `useX(` call appears after it.
 */

const ROOTS = [path.join(__dirname), path.join(__dirname, '..', 'app')];

const HOOK = /(?:^|[^.\w])(use[A-Z]\w*)\s*\(/;
/** A `return` that is a statement of the component body, not one inside JSX. */
const RETURN = /^\s{2}(?:return\b|if\s*\([^)]*\)\s*return\b)/;
/** Where a component body starts: two-space indent is this repo's style. */
const COMPONENT = /^(?:export\s+)?(?:export\s+default\s+)?function\s+([A-Z]\w*)\s*\(/;

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { yield* walk(p); continue; }
    if (/\.tsx$/.test(e.name)) yield p;
  }
}

interface Offence { file: string; line: number; hook: string; component: string; returnLine: number }

function scan(file: string): Offence[] {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out: Offence[] = [];
  let component: string | null = null;
  let firstReturn = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const m = COMPONENT.exec(raw);
    if (m) { component = m[1]; firstReturn = -1; continue; }
    if (!component) continue;
    // A new top-level declaration ends the component we were reading.
    if (/^(?:export\s+)?(?:const|function|class|type|interface)\s/.test(raw) && !COMPONENT.test(raw)) {
      component = null; firstReturn = -1; continue;
    }
    if (firstReturn === -1 && RETURN.test(raw)) { firstReturn = i + 1; continue; }
    if (firstReturn === -1) continue;

    // Only a hook CALL at statement level counts. `const x = useMemo(...)`
    // counts; `onClick={() => useFoo()}` would too, and is also illegal.
    const h = HOOK.exec(raw);
    if (h && !/^\s*(\/\/|\*|\/\*)/.test(raw)) {
      out.push({ file, line: i + 1, hook: h[1], component, returnLine: firstReturn });
    }
  }
  return out;
}

describe('no hook below an early return', () => {
  const files = [...new Set([...walk(ROOTS[0]), ...walk(ROOTS[1])])].filter((f) => !f.endsWith('.spec.tsx'));

  it('has files to check, so a passing run means something', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('catches the exact shape that took the app down', () => {
    // A canary, so the scanner cannot quietly stop working: this is the bug,
    // reduced. If this stops being detected, the test above is worthless.
    const tmp = path.join(__dirname, '.hook-order-canary.tsx');
    fs.writeFileSync(tmp, [
      'export function Broken() {',
      '  const [a, setA] = useState(0);',
      '  if (!a) return null;',
      '  useEffect(() => { setA(1); }, []);',
      '  return <div />;',
      '}',
      '',
    ].join('\n'));
    try {
      const found = scan(tmp);
      expect(found).toHaveLength(1);
      expect(found[0].hook).toBe('useEffect');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('finds none in the app', () => {
    const bad = files.flatMap(scan);
    const report = bad.map((b) =>
      `${path.relative(process.cwd(), b.file)}:${b.line} — ${b.hook}() in <${b.component}> sits below the return on line ${b.returnLine}`);
    // React counts hooks per render. A hook below a conditional return runs on
    // some renders and not others, and the second render throws — taking down
    // every page that renders inside the component.
    expect(report).toEqual([]);
  });
});
