import { createServer, type Server } from 'http';
import { PassThrough } from 'stream';
import type { AddressInfo } from 'net';
import { acceptWebSocket, LiteSocket } from './ws-lite';

/** A real WebSocket client (Node's own) against the small server. */
describe('ws-lite', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer();
    server.on('upgrade', (req, sock, head) => {
      const ws = acceptWebSocket(req, sock, head);
      if (ws) ws.onmessage = (t) => (t === 'bye' ? ws.close(1000) : ws.send(`echo:${t}`));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

  const open = () => new Promise<WebSocket>((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/voice/relay`);
    ws.onopen = () => res(ws);
    ws.onerror = (e) => rej(e);
  });
  const next = (ws: WebSocket) => new Promise<string>((res) => { ws.onmessage = (e) => res(String(e.data)); });

  it('handshakes and echoes text, small and large', async () => {
    const ws = await open();
    let got = next(ws); ws.send('{"type":"setup"}');
    expect(await got).toBe('echo:{"type":"setup"}');
    const big = 'x'.repeat(70_000); // 64-bit length frames both ways
    got = next(ws); ws.send(big);
    expect(await got).toBe(`echo:${big}`);
    const mid = 'é'.repeat(300); // 16-bit length, multi-byte UTF-8
    got = next(ws); ws.send(mid);
    expect(await got).toBe(`echo:${mid}`);
    ws.close();
  });

  it('closes cleanly when the server ends the session', async () => {
    const ws = await open();
    const closed = new Promise<number>((res) => { ws.onclose = (e) => res(e.code); });
    ws.send('bye');
    expect(await closed).toBe(1000);
  });

  const masked = (op: number, payload: Buffer, fin = true) => {
    const mask = Buffer.from([1, 2, 3, 4]);
    const body = Buffer.from(payload.map((b, i) => b ^ mask[i & 3]));
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | payload.length]), mask, body]);
  };

  it('reassembles fragmented messages and answers pings', () => {
    const sock = new PassThrough();
    const written: Buffer[] = [];
    sock.write = ((c: Buffer) => { written.push(Buffer.from(c)); return true; }) as never;
    const ws = new LiteSocket(sock, undefined, 60_000);
    const msgs: string[] = [];
    ws.onmessage = (t) => msgs.push(t);
    ws.feed(Buffer.concat([masked(0x1, Buffer.from('hel'), false), masked(0x0, Buffer.from('lo'), true)]));
    expect(msgs).toEqual(['hello']);
    ws.feed(masked(0x9, Buffer.from('p')));
    expect(written.some((w) => w[0] === 0x8a)).toBe(true); // a pong went back
    ws.close();
  });

  it('drops a client that does not mask its frames', () => {
    const sock = new PassThrough();
    sock.write = (() => true) as never;
    const ws = new LiteSocket(sock, undefined, 60_000);
    let closed = false;
    ws.onclose = () => { closed = true; };
    ws.feed(Buffer.from([0x81, 0x02, 0x68, 0x69]));
    expect(closed).toBe(true);
    expect(ws.isOpen).toBe(false);
  });

  it('refuses a request that is not a WebSocket upgrade', () => {
    const sock = new PassThrough();
    let wrote = '';
    sock.write = ((c: string) => { wrote += c; return true; }) as never;
    const r = acceptWebSocket({ headers: { upgrade: 'h2c' } } as never, sock, Buffer.alloc(0));
    expect(r).toBeNull();
    expect(wrote).toContain('400');
  });
});
