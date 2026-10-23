import 'reflect-metadata';
import { readFileSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateMessengerDto } from './dto/messenger.dto';

/**
 * The Bot page sends its WHOLE form on every save, and the global pipe refuses
 * any field the DTO does not name. Twice now a field reached the form before
 * it reached the DTO (chatAssignMode, then quotePolicy), and every save on the
 * page — the AI on/off switch included — failed with "property … should not
 * exist". This reads the fields the page actually sends and checks each one.
 */
describe('Bot page save body vs UpdateMessengerDto', () => {
  const page = readFileSync(join(__dirname, '..', '..', '..', 'web', 'src', 'app', 'salon', 'messenger', 'page.tsx'), 'utf8');
  const start = page.indexOf("apiFetch<MConf>('/messenger/settings'");
  const body = page.slice(page.indexOf('body: {', start) + 7, page.indexOf('...patch', start));
  const keys = [...body.matchAll(/([A-Za-z]+):/g)].map((m) => m[1]);

  it('finds the fields the page sends', () => {
    expect(start).toBeGreaterThan(0);
    expect(keys).toEqual(expect.arrayContaining(['enabled', 'botMode', 'quotePolicy', 'chatAssignMode']));
  });

  it('accepts every one of them', () => {
    const sample: Record<string, unknown> = {
      pageId: 'p1', igId: 'i1', enabled: false, greeting: 'Hi', closing: 'Bye', agentName: 'Lumi', bizIntro: 'x', aiInstruction: 'x',
      botMode: 'sales', quotePolicy: 'facts', leadEmail: 'a@b.co', humanActiveMins: 30, graceMins: 2,
      chatAssignMode: 'off', chatMaxOpenPerAgent: 5, chatPreferUsualTech: true,
    };
    const sent = Object.fromEntries(keys.map((k) => [k, sample[k] ?? 'x']));
    const errors = validateSync(plainToInstance(UpdateMessengerDto, sent), { whitelist: true, forbidNonWhitelisted: true });
    const unknown = errors.filter((e) => e.constraints?.whitelistValidation).map((e) => e.property);
    expect(unknown).toEqual([]);
  });

  it('still refuses a quote policy it does not know', () => {
    const errors = validateSync(plainToInstance(UpdateMessengerDto, { quotePolicy: 'free-for-all' }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e) => e.property)).toEqual(['quotePolicy']);
  });
});
