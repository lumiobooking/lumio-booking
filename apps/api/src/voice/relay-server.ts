import { Logger } from '@nestjs/common';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import { RelaySession, relaySignatureOk } from './relay';
import { acceptWebSocket } from './ws-lite';
import type { VoiceService } from './voice.service';

export const RELAY_PATH = '/api/voice/relay';

/**
 * Plug the streaming hotline into the API's HTTP server: Twilio opens
 * wss://<api>/api/voice/relay for each relay call.
 *
 * Off unless VOICE_RELAY_NUMBERS is set: with it empty, every upgrade is
 * refused exactly as before this existed (Node drops an upgrade nobody
 * handles). Each connection must carry Twilio's signature for this URL.
 */
export function attachVoiceRelay(server: Server, voice: VoiceService, env: Record<string, string | undefined> = process.env): void {
  const logger = new Logger('VoiceRelay');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = String(req.url || '').split('?')[0];
    if (path !== RELAY_PATH || !String(env.VOICE_RELAY_NUMBERS ?? '').trim()) {
      socket.destroy();
      return;
    }
    if (!relaySignatureOk({ apiBase: voice.publicApiBase(), path: String(req.url || ''), signature: req.headers['x-twilio-signature'] }, env)) {
      logger.warn('relay upgrade refused: bad or missing Twilio signature');
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const ws = acceptWebSocket(req, socket, head);
    if (!ws) return;
    const session = new RelaySession({
      send: (m) => ws.send(JSON.stringify(m)),
      close: () => ws.close(),
      setup: (callSid, accountSid) => voice.relaySetup(callSid, accountSid),
      turn: (callSid, speech, interim) => voice.relayTurn(callSid, speech, interim),
      silence: (callSid, misses) => voice.relaySilence(callSid, misses),
      interrupted: (callSid, heard) => voice.relayInterrupted(callSid, heard),
      filler: (lang, n) => voice.relayFiller(lang, n),
      log: (m) => logger.warn(m),
    });
    ws.onmessage = (text) => { session.onMessage(text).catch((e) => logger.warn(`relay message failed: ${String(e).slice(0, 160)}`)); };
    ws.onclose = () => session.onClose();
  });
}
