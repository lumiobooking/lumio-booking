import { createHash } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

/**
 * A small, server-side WebSocket (RFC 6455) — just what Twilio's
 * ConversationRelay needs: text frames in and out, ping/pong, close.
 *
 * Why not a library: the API has no WebSocket dependency today, and adding
 * one changes the lock file the Render build installs from. These ~150 lines
 * have no install step and are pinned by tests (ws-lite.spec.ts).
 *
 * Limits on purpose: one message is at most 1 MB (Twilio's are a few hundred
 * bytes), and a client that does not mask its frames is dropped, as the RFC
 * requires.
 */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export class LiteSocket {
  onmessage?: (text: string) => void;
  onclose?: () => void;
  private buf: Buffer = Buffer.alloc(0);
  private frags: Buffer[] = [];
  private fragBytes = 0;
  private fragOp = 0;
  private closed = false;
  private readonly pinger: ReturnType<typeof setInterval>;

  constructor(private readonly sock: Duplex, head?: Buffer, pingMs = 25_000) {
    sock.on('data', (d: Buffer) => this.feed(d));
    sock.on('close', () => this.finish());
    sock.on('error', () => this.finish());
    // Keep idle proxies from closing a quiet call (the caller is thinking).
    this.pinger = setInterval(() => this.frame(0x9, Buffer.alloc(0)), pingMs);
    (this.pinger as { unref?: () => void }).unref?.();
    if (head && head.length) this.feed(head);
  }

  get isOpen(): boolean { return !this.closed; }

  send(text: string): void {
    this.frame(0x1, Buffer.from(text, 'utf8'));
  }

  close(code = 1000): void {
    if (this.closed) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this.frame(0x8, p);
    try { this.sock.end(); } catch { /* already gone */ }
    this.finish();
  }

  /** Bytes from the network. Public for the tests. */
  feed(chunk: Buffer): void {
    if (this.closed) return;
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const op = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE_BYTES)) return this.close(1009);
        len = Number(big);
        off = 10;
      }
      if (!masked) return this.close(1002);
      if (len > MAX_MESSAGE_BYTES) return this.close(1009);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      this.handle(op, fin, payload);
      if (this.closed) return;
    }
  }

  private handle(op: number, fin: boolean, payload: Buffer): void {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this.frame(0xa, payload); return; }
    if (op === 0xa) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) { this.deliver(op, payload); return; }
      this.fragOp = op;
      this.frags = [payload];
      this.fragBytes = payload.length;
      return;
    }
    if (op === 0x0) {
      if (!this.fragOp) { this.close(1002); return; }
      this.frags.push(payload);
      this.fragBytes += payload.length;
      if (this.fragBytes > MAX_MESSAGE_BYTES) { this.close(1009); return; }
      if (fin) {
        const whole = Buffer.concat(this.frags);
        const kind = this.fragOp;
        this.frags = []; this.fragBytes = 0; this.fragOp = 0;
        this.deliver(kind, whole);
      }
      return;
    }
    this.close(1002); // unknown opcode
  }

  private deliver(op: number, payload: Buffer): void {
    if (op !== 0x1) return; // Twilio speaks JSON text; binary is ignored
    try { this.onmessage?.(payload.toString('utf8')); } catch { /* a bad handler must not kill the socket */ }
  }

  private frame(op: number, payload: Buffer): void {
    if (this.closed) return;
    const n = payload.length;
    let head: Buffer;
    if (n < 126) {
      head = Buffer.from([0x80 | op, n]);
    } else if (n < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2);
    }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this.finish(); }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pinger);
    try { this.sock.destroy(); } catch { /* gone */ }
    try { this.onclose?.(); } catch { /* ignore */ }
  }
}

/** Answer an HTTP upgrade with the WebSocket handshake, or refuse it. */
export function acceptWebSocket(req: IncomingMessage, sock: Duplex, head: Buffer): LiteSocket | null {
  const key = req.headers['sec-websocket-key'];
  const upgrade = String(req.headers.upgrade || '').toLowerCase();
  if (upgrade !== 'websocket' || typeof key !== 'string' || !key || String(req.headers['sec-websocket-version'] || '') !== '13') {
    sock.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    sock.destroy();
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  return new LiteSocket(sock, head);
}
