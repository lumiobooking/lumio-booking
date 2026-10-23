import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
// The enums the services read, so the spec runs on any generated client (some machines have an old one).
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  PrintJobStatus: { PENDING: 'PENDING', PRINTED: 'PRINTED', FAILED: 'FAILED' },
  TenantStatus: { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' },
}));
import { PrintDevicesService } from './print-devices.service';
import { PrintService } from './print.service';
import { AGENT_VERSION, agentScript, installScript } from './agent-scripts';
import {
  asciiJson, DRAWER_KICK, drawerRoute, printableWidth, cleanCode, cleanRoutes, columnsOf, escposBytes, plain, publicApiBase, routeFor, runLine, styleRows,
} from './print-devices.logic';

/* In-memory Prisma for the calls these services make. Every where is applied
 * as written — a query that forgot its tenantId would see the other shop. */
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    const val = row[k] ?? null;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return v.not === null ? val !== null : val !== v.not;
      if ('in' in v) return (v.in as unknown[]).includes(val);
      if ('lt' in v) return val !== null && val < v.lt;
      if ('gte' in v) return val !== null && val >= v.gte;
      return true;
    }
    if (v instanceof Date) return val instanceof Date && val.getTime() === v.getTime();
    return val === (v ?? null);
  });
}
function table(rows: Row[], defaults: () => Row = () => ({})) {
  let seq = 0;
  return {
    rows,
    findFirst: jest.fn(async (a: Row = {}) => { const r = rows.find((x) => matches(x, a.where)); return r ? { ...r } : null; }),
    findUnique: jest.fn(async (a: Row = {}) => { const r = rows.find((x) => matches(x, a.where)); return r ? { ...r } : null; }),
    findMany: jest.fn(async (a: Row = {}) => {
      let list = rows.filter((x) => matches(x, a.where));
      if (a.orderBy?.createdAt) list = [...list].sort((x, y) => x.createdAt - y.createdAt);
      return list.slice(0, a.take ?? 1000).map((x) => ({ ...x }));
    }),
    count: jest.fn(async (a: Row = {}) => rows.filter((x) => matches(x, a.where)).length),
    create: jest.fn(async (a: Row) => { const r = { id: `id${++seq}${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date(Date.now() + seq), ...defaults(), ...a.data }; rows.push(r); return { ...r }; }),
    updateMany: jest.fn(async (a: Row) => { const hit = rows.filter((x) => matches(x, a.where)); hit.forEach((x) => Object.assign(x, a.data)); return { count: hit.length }; }),
    deleteMany: jest.fn(async (a: Row) => { const keep = rows.filter((x) => !matches(x, a.where)); const n = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count: n }; }),
  };
}

function world() {
  const prisma = {
    printDevice: table([], () => ({ revokedAt: null, pairedAt: null, tokenHash: null, lastSeenAt: null, agentVersion: null, defaultPrinter: null })),
    printJob: table([], () => ({ status: 'PENDING', copies: 1, station: null, deviceId: null, claimedAt: null, route: null, title: null, drawer: false })),
    tenant: table([{ id: 'tA', status: 'ACTIVE' }, { id: 'tB', status: 'ACTIVE' }]),
    setting: table([]),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const svc = new PrintDevicesService(prisma as never, audit as never);
  const owner = (tenantId: string) => ({ userId: `u-${tenantId}`, role: 'SALON_ADMIN', tenantId }) as never;
  const headers = { host: 'lumio-api-vn.onrender.com', 'x-forwarded-proto': 'https' };
  async function addComputer(tenantId: string, name = 'QUAY') {
    const inst = await svc.installer(owner(tenantId), headers);
    const { token } = await svc.pair({ code: inst.code, name, printers: ['XP-80C', 'Microsoft Print to PDF'], defaultPrinter: 'XP-80C' });
    const device = prisma.printDevice.rows.find((d) => d.id === inst.id)!;
    return { token, id: inst.id, device, h: { 'x-lumio-device': token } };
  }
  const job = (tenantId: string, over: Row = {}) => prisma.printJob.create({ data: { tenantId, text: 'BEP\nBAN M3\n1 x Pho', ...over } });
  const take = async (h: Row) => JSON.parse(await svc.jobs(h)).jobs as Row[];
  return { prisma, audit, svc, owner, headers, addComputer, job, take };
}

describe('one-touch printing — setup', () => {
  it('gives a one-line setup that fits the Run box and names this API', async () => {
    const w = world();
    const inst = await w.svc.installer(w.owner('tA'), w.headers);
    expect(inst.url).toBe(`https://lumio-api-vn.onrender.com/api/print-agent/i/${inst.code}`);
    expect(inst.runLine.length).toBeLessThan(259);
    expect(inst.runLine).toContain(`irm '${inst.url}'|iex`);
    const script = await w.svc.install(inst.code, w.headers);
    expect(script).toContain(`$Code = '${inst.code}'`);
    expect(script).toContain("$Api = 'https://lumio-api-vn.onrender.com/api'");
    expect(script).not.toMatch(/__API__|__CODE__/);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(script)).toBe(true);
  });

  it('a code works once, only for its own shop, and not after 30 minutes', async () => {
    const w = world();
    const inst = await w.svc.installer(w.owner('tA'), w.headers);
    const { token } = await w.svc.pair({ code: inst.code.toLowerCase(), name: 'QUAY', printers: ['XP-80C'] });
    expect(token).toMatch(/^lpd_/);
    await expect(w.svc.pair({ code: inst.code })).rejects.toBeInstanceOf(NotFoundException);
    expect(await w.svc.install(inst.code, w.headers)).toContain('het han');
    const d = w.prisma.printDevice.rows.find((x) => x.id === inst.id)!;
    expect(d.tenantId).toBe('tA');
    expect(d.tokenHash).not.toBe(token); // only the hash is kept
    expect(d.routes).toEqual({ '*': { printer: '' } }); // the first computer prints everything
    const late = await w.svc.installer(w.owner('tA'), w.headers);
    w.prisma.printDevice.rows.find((x) => x.id === late.id)!.pairExpiresAt = new Date(Date.now() - 1000);
    await expect(w.svc.pair({ code: late.code })).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.pair({ code: 'not a code' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a second computer waits to be told what to print', async () => {
    const w = world();
    await w.addComputer('tA', 'QUAY');
    const second = await w.addComputer('tA', 'BEP');
    expect(second.device.routes).toEqual({});
  });

  it('a new code retires the waiting one', async () => {
    const w = world();
    const a = await w.svc.installer(w.owner('tA'), w.headers);
    await w.svc.installer(w.owner('tA'), w.headers);
    await expect(w.svc.pair({ code: a.code })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('one-touch printing — jobs', () => {
  it('a computer prints its own shop’s tickets, once', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    const b = await w.addComputer('tB');
    await w.job('tA', { title: 'A1' });
    await w.job('tB', { title: 'B1' });
    const got = await w.take(a.h);
    expect(got.map((j) => j.title)).toEqual(['A1']);
    expect(got[0].printer).toBe('');
    expect(got[0].rows[0]).toEqual({ r: 't', t: 'BEP' }); // the first line of a bill: the shop name, large
    expect(await w.take(a.h)).toEqual([]); // taken already
    expect((await w.take(b.h)).map((j) => j.title)).toEqual(['B1']);
  });

  it('sends kitchen tickets to the kitchen computer and the rest to the counter', async () => {
    const w = world();
    const counter = await w.addComputer('tA', 'QUAY');
    const kitchen = await w.addComputer('tA', 'BEP');
    await w.svc.update(w.owner('tA'), kitchen.id, { routes: { KITCHEN: { host: '192.168.1.50', beep: true } } });
    await w.job('tA', { title: 'kitchen', station: 'KITCHEN' });
    await w.job('tA', { title: 'bill' });
    await w.job('tA', { title: 'bar', station: 'BAR' });
    expect((await w.take(kitchen.h)).map((j) => [j.title, j.host, j.port, typeof j.raw])).toEqual([['kitchen', '192.168.1.50', 9100, 'string']]);
    expect((await w.take(counter.h)).map((j) => j.title)).toEqual(['bill', 'bar']);
  });

  it('does not print yesterday’s tickets on a computer that just came online', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await w.job('tA', { title: 'old', createdAt: new Date(Date.now() - 3 * 3600_000) });
    expect(await w.take(a.h)).toEqual([]);
  });

  it('only the computer that took a ticket reports on it', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    const a2 = await w.addComputer('tA', 'BEP');
    const b = await w.addComputer('tB');
    const j = await w.job('tA');
    await w.take(a.h);
    await expect(w.svc.result(b.h, j.id, true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.result(a2.h, j.id, true)).rejects.toBeInstanceOf(NotFoundException);
    await w.svc.result(a.h, j.id, false, 'Out of paper');
    expect(w.prisma.printJob.rows.find((x) => x.id === j.id)).toMatchObject({ status: 'FAILED', error: 'Out of paper' });
  });

  it('a test print goes to the computer it was pressed for', async () => {
    const w = world();
    const counter = await w.addComputer('tA', 'QUAY');
    const kitchen = await w.addComputer('tA', 'BEP');
    await w.svc.update(w.owner('tA'), kitchen.id, { routes: { KITCHEN: { printer: 'XP-80 Bep' } } });
    await w.svc.test(w.owner('tA'), kitchen.id, 'KITCHEN');
    expect(await w.take(counter.h)).toEqual([]);
    const got = await w.take(kitchen.h);
    expect(got).toHaveLength(1);
    expect(got[0].printer).toBe('XP-80 Bep');
    expect(got[0].rows[1].r).toBe('h');
  });

  it('a removed computer is refused (and uninstalls itself); a suspended shop is paused, not removed', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await w.svc.revoke(w.owner('tA'), a.id);
    await expect(w.svc.jobs(a.h)).rejects.toBeInstanceOf(UnauthorizedException);
    const b = await w.addComputer('tB');
    w.prisma.tenant.rows.find((t) => t.id === 'tB')!.status = 'SUSPENDED';
    await expect(w.svc.jobs(b.h)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(w.svc.jobs({ 'x-lumio-device': 'nope' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a removed computer’s unprinted tickets go back to the queue', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    const j = await w.job('tA');
    await w.take(a.h);
    await w.svc.revoke(w.owner('tA'), a.id);
    expect(w.prisma.printJob.rows.find((x) => x.id === j.id)).toMatchObject({ deviceId: null, claimedAt: null, status: 'PENDING' });
  });
});

describe('one-touch printing — owners only see their own computers', () => {
  it('another shop cannot list, change, test or remove them', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    expect((await w.svc.list(w.owner('tB'))).devices).toEqual([]);
    await expect(w.svc.update(w.owner('tB'), a.id, { routes: { '*': { printer: 'x' } } })).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.test(w.owner('tB'), a.id, 'COUNTER')).rejects.toBeInstanceOf(NotFoundException);
    await expect(w.svc.revoke(w.owner('tB'), a.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(a.device.routes).toEqual({ '*': { printer: '' } });
    const mine = await w.svc.list(w.owner('tA'));
    expect(mine.devices.map((d) => [d.name, d.paired, d.online, d.printers])).toEqual([['QUAY', true, true, ['XP-80C', 'Microsoft Print to PDF']]]);
  });

  it('the old agent stands down while a one-touch computer is online', async () => {
    const w = world();
    await w.addComputer('tA');
    await w.job('tA');
    await w.job('tB');
    const old = new PrintService(w.prisma as never, w.svc);
    expect(await old.pending('tA')).toEqual([]);
    expect((await old.pending('tB')).length).toBe(1);
  });
});

describe('one-touch printing — the pure parts', () => {
  it('reads codes the way people type them', () => {
    expect(cleanCode('abcd-2345')).toBe('ABCD2345');
    expect(cleanCode('ABC')).toBeNull();
  });

  it('keeps only sane routes', () => {
    expect(cleanRoutes({
      counter: { printer: 'XP-80C' }, KITCHEN: { host: '192.168.1.50', port: 9101, beep: true },
      BAR: { host: '999.1.1.1' }, 'bad key!': { printer: 'x' }, '*': { printer: '' }, NOTE: 'x',
    })).toEqual({ COUNTER: { printer: 'XP-80C' }, KITCHEN: { host: '192.168.1.50', port: 9101, beep: true }, '*': { printer: '' } });
  });

  it('routes by station, then "everything else", oldest computer first', () => {
    const d1 = { id: 'd1', pairedAt: new Date(1), routes: { '*': { printer: '' } } };
    const d2 = { id: 'd2', pairedAt: new Date(2), routes: { KITCHEN: { printer: 'K' } } };
    expect(routeFor({ station: 'KITCHEN' }, [d2, d1])?.deviceId).toBe('d2');
    expect(routeFor({ station: null }, [d2, d1])?.deviceId).toBe('d1');
    expect(routeFor({ station: 'BAR' }, [d2])).toBeNull();
    expect(routeFor({ station: null, deviceId: 'd2', route: 'KITCHEN' }, [d1, d2])).toEqual({ deviceId: 'd2', key: 'KITCHEN', route: { printer: 'K' } });
  });

  it('draws the table large and dishes bold on a kitchen ticket', () => {
    const rows = styleRows('      BẾP · MÓN MỚI\n        BÀN M3\nBill #57\n2 x Phở bò\n    - Không hành\n\n\n', 'KITCHEN');
    expect(rows.map((r) => r.r).join('')).toBe('bhnbb');
    expect(columnsOf(rows)).toBe(32);
    expect(styleRows('NHÀ HÀNG LUMIO\nabc\nTỔNG CỘNG  100', null).map((r) => r.r).join('')).toBe('tnb');
  });

  it('makes ESC/POS without accents, with a cut', () => {
    expect(plain('Phở bò tái · “Đặc biệt”')).toBe('Pho bo tai - "Dac biet"');
    const b = escposBytes(styleRows('BEP\nBAN M3\n1 x Pho', 'KITCHEN'), { host: 'x', beep: true });
    expect([...b.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...b.subarray(b.length - 4)]).toEqual([0x1d, 0x56, 0x42, 0x00]);
    // A cash sale: the drawer pulse comes right after init, before the bill prints.
    const k = escposBytes(styleRows('LUMIO\nTONG  100', null), { host: 'x' }, { kick: true });
    expect([...k.subarray(2, 12)]).toEqual([...DRAWER_KICK]);
    expect(b.includes(Buffer.from([0x1b, 0x42, 0x02, 0x02]))).toBe(true);
  });

  it('sends JSON PowerShell cannot misread', () => {
    const s = asciiJson({ t: 'Phở' });
    expect(/^[\x20-\x7e]*$/.test(s)).toBe(true);
    expect(JSON.parse(s).t).toBe('Phở');
  });

  it('builds the API address the shop reaches', () => {
    expect(publicApiBase({ host: 'api.x.com', 'x-forwarded-proto': 'https,http' })).toBe('https://api.x.com/api');
    expect(runLine('https://a/api/print-agent/i/ABCD2345')).toContain('SecurityProtocol=3072');
  });

  it('ships an ASCII agent that knows its version, and refuses a bad setup address', () => {
    const a = agentScript();
    expect(a).toContain(`$Version = '${AGENT_VERSION}'`);
    expect(/^[\x09\x0a\x0d\x20-\x7e]*$/.test(a)).toBe(true);
    expect(() => installScript("https://x/api'; Remove-Item C:\\ -Recurse; '", 'ABCD2345')).toThrow();
    expect(() => installScript('https://x/api', "AB'CD")).toThrow();
  });
});

describe('one-touch printing — the cash drawer', () => {
  it('opens on a cash sale, only on the printer the drawer is plugged into', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await w.svc.update(w.owner('tA'), a.id, { routes: { COUNTER: { printer: 'XP-80C', drawer: true }, '*': { printer: '' } } });
    await w.job('tA', { title: 'cash bill', text: 'LUMIO\nTONG 100', drawer: true });
    await w.job('tA', { title: 'card bill', text: 'LUMIO\nTONG 100' });
    await w.job('tA', { title: 'kitchen', text: 'BEP\nBAN M3', station: 'KITCHEN', drawer: true });
    const got = await w.take(a.h);
    expect(got.map((j) => [j.title, j.kick, j.drawerOnly, j.printer])).toEqual([
      ['cash bill', true, false, 'XP-80C'], ['card bill', false, false, 'XP-80C'], ['kitchen', false, false, ''],
    ]);
  });

  it('"Mở két" needs a drawer set up, goes to its printer, and is logged', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await expect(w.svc.openDrawer(w.owner('tA'))).rejects.toMatchObject({ message: 'DRAWER_NOT_SET' });
    await w.svc.update(w.owner('tA'), a.id, { routes: { '*': { host: '192.168.1.60', drawer: true } } });
    await w.svc.openDrawer(w.owner('tA'), 'đổi tiền');
    const [j] = await w.take(a.h);
    expect(j.drawerOnly).toBe(true);
    expect(Buffer.from(j.raw, 'base64').includes(DRAWER_KICK)).toBe(true);
    expect(w.audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tA', userId: 'u-tA', action: 'print.drawer_opened', metadata: { reason: 'đổi tiền' } }));
    // Another shop has no drawer of its own, whatever shop A set up.
    await expect(w.svc.openDrawer(w.owner('tB'))).rejects.toMatchObject({ message: 'DRAWER_NOT_SET' });
  });

  it('tests the drawer of one computer, and refuses where none is set', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await expect(w.svc.test(w.owner('tA'), a.id, 'COUNTER', true)).rejects.toMatchObject({ message: 'DRAWER_NOT_SET' });
    await w.svc.update(w.owner('tA'), a.id, { routes: { COUNTER: { printer: 'XP-80C', drawer: true } } });
    await w.svc.test(w.owner('tA'), a.id, 'COUNTER', true);
    const [j] = await w.take(a.h);
    expect([j.drawerOnly, j.printer]).toEqual([true, 'XP-80C']);
  });

  it('the old agent never gets a drawer-only job (it would print a blank page)', async () => {
    const w = world();
    await w.job('tB', { text: '', drawer: true });
    const old = new PrintService(w.prisma as never, w.svc);
    expect(await old.pending('tB')).toEqual([]);
  });

  it('picks the counter drawer first, and keeps drawer flags when cleaning routes', () => {
    const d1 = { id: 'd1', pairedAt: new Date(1), routes: { '*': { printer: '', drawer: true } } };
    const d2 = { id: 'd2', pairedAt: new Date(2), routes: { COUNTER: { printer: 'X', drawer: true } } };
    expect(drawerRoute([d1, d2])?.deviceId).toBe('d2');
    expect(drawerRoute([d1])?.key).toBe('*');
    expect(drawerRoute([{ id: 'd3', pairedAt: new Date(3), routes: { COUNTER: { printer: 'X' } } }])).toBeNull();
    expect(cleanRoutes({ COUNTER: { printer: 'X', drawer: true }, BAR: { host: '10.0.0.9', drawer: 'yes' } })).toEqual({ COUNTER: { printer: 'X', drawer: true }, BAR: { host: '10.0.0.9', port: 9100 } });
  });
});

describe('one-touch printing — bills that keep their amounts', () => {
  it('pins the amount of a two-column line to the right edge', () => {
    const rows = styleRows('NHA HANG LUMIO\n2x Phở bò tái            170.000 đ\nTỔNG CỘNG                800.027 đ\nCam on quy khach', null);
    expect(rows[1]).toEqual({ r: 'n', t: '2x Phở bò tái            170.000 đ', a: '170.000 đ' });
    expect(rows[2]).toMatchObject({ r: 'b', a: '800.027 đ' });
    expect(rows[3].a).toBeUndefined();
    expect(styleRows('BEP · MON MOI\n        BAN M3\n2 x Pho', 'KITCHEN')[1].a).toBeUndefined();
  });

  it('caps the drawing width at the paper, and keeps the paper choice', () => {
    expect(printableWidth({ printer: 'X' })).toBe(283);
    expect(printableWidth({ printer: 'X', paper: 58 })).toBe(189);
    expect(cleanRoutes({ COUNTER: { printer: 'X', paper: '58' }, BAR: { printer: 'Y', paper: 99 } })).toEqual({ COUNTER: { printer: 'X', paper: 58 }, BAR: { printer: 'Y' } });
  });

  it('lists a restaurant’s kitchen and bar even before its settings were saved', async () => {
    const w = world();
    w.prisma.tenant.rows.find((t) => t.id === 'tA')!.businessType = 'RESTAURANT';
    expect((await w.svc.list(w.owner('tA'))).stations.map((s) => s.key)).toEqual(['COUNTER', 'KITCHEN', 'BAR']);
    expect((await w.svc.list(w.owner('tB'))).stations.map((s) => s.key)).toEqual(['COUNTER']);
  });

  it('sends kitchen tickets only to the kitchen printer once it is set, never to the counter', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await w.svc.update(w.owner('tA'), a.id, { routes: { COUNTER: { printer: 'EPSON' }, KITCHEN: { host: '192.168.1.50' }, BAR: { printer: 'XP-58' }, '*': { printer: '' } } });
    await w.job('tA', { title: 'k', station: 'KITCHEN' });
    await w.job('tA', { title: 'b', station: 'BAR' });
    await w.job('tA', { title: 'bill' });
    const got = await w.take(a.h);
    expect(got.map((j) => [j.title, j.printer ?? j.host])).toEqual([['k', '192.168.1.50'], ['b', 'XP-58'], ['bill', 'EPSON']]);
    expect(got[2].maxWidth).toBe(283);
  });
});

describe('one-touch printing — a bill that looks like the designer', () => {
  // The restaurant bill exactly as the till builds it (48 columns, centred with spaces).
  const W = 48;
  const centre = (x: string) => ' '.repeat(Math.floor((W - x.length) / 2)) + x;
  const row = (l: string, r: string) => l + ' '.repeat(W - l.length - r.length) + r;
  const bill = [
    centre('LUMIO AGENCY'), centre('238/26 Đường Trường Chinh'), centre('ĐT: 037 586 6868'), '-'.repeat(W),
    centre('HOÁ ĐƠN'), centre('Số #9'), centre('14:19:58 23/10/2026'), '-'.repeat(W),
    row('1x Green Papaya Salad', '200.000 đ'), row('2x Shaking Beef', '44 đ'), '-'.repeat(W),
    row('Tạm tính', '400.101 đ'), row('TỔNG CỘNG', '400.101 đ'), row('Đã trả · Tiền mặt', '500.000 đ'), row('Tiền thối', '99.899 đ'),
    '-'.repeat(W), centre('Cảm ơn quý khách!'),
  ].join('\n');

  it('reads titles, centred lines, rules and amounts out of the plain text', () => {
    const rows = styleRows(bill, null);
    expect(rows.map((x) => x.r).join('')).toBe('tnnstnnsnnsnbnnsn');
    expect(rows[0]).toMatchObject({ t: expect.stringContaining('LUMIO AGENCY'), c: true });
    expect(rows[4]).toMatchObject({ r: 't', c: true });
    expect(rows[8]).toMatchObject({ r: 'n', a: '200.000 đ' });
    expect(rows[8].c).toBeUndefined();
    expect(rows[12]).toMatchObject({ r: 'b', a: '400.101 đ' });
    expect(rows[16]).toMatchObject({ c: true });
  });

  it('tells the computer which font and size to draw it in, by paper', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    await w.svc.update(w.owner('tA'), a.id, { routes: { COUNTER: { printer: 'EPSON', paper: 58 } } });
    await w.job('tA', { text: bill });
    const [j] = await w.take(a.h);
    expect([j.font, j.size, j.maxWidth]).toEqual(['Arial', 8.5, 189]);
  });

  it('answers a waiting computer the moment a ticket is created', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    const t0 = Date.now();
    const waiting = w.svc.jobs(a.h, 10);
    setTimeout(() => { void w.job('tA', { title: 'now' }).then(() => w.svc.notify('tA')); }, 150);
    const got = JSON.parse(await waiting).jobs;
    expect(got.map((j: { title: string }) => j.title)).toEqual(['now']);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('does not wake for another shop’s ticket', async () => {
    const w = world();
    const a = await w.addComputer('tA');
    const t0 = Date.now();
    const waiting = w.svc.jobs(a.h, 1);
    setTimeout(() => { void w.job('tB', { title: 'other' }).then(() => w.svc.notify('tB')); }, 100);
    expect(JSON.parse(await waiting).jobs).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  });
});
