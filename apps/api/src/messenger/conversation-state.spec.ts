/**
 * Where the conversation stands (18/11/2026): read from the thread's own
 * turns by code — what was asked, what was given, what was sent.
 */
import { chatState, chatStateBlock, questionsIn } from './conversation-state';
import { RELEASE_FEATURES, isUiFeature } from '../common/ai-release';

const u = (content: string) => ({ role: 'user', content });
const a = (content: string, extra: object = {}) => ({ role: 'assistant', content, ...extra });

describe('questions in a message', () => {
  it('only sentences that end in a question mark', () => {
    expect(questionsIn('Dạ bên em có ạ. Anh/chị cho em xin tên tiệm và thành phố ạ?')).toEqual(['Anh/chị cho em xin tên tiệm và thành phố ạ?']);
    expect(questionsIn('We open at 9.\nWhich day works for you? Morning or afternoon?')).toEqual(['Which day works for you?', 'Morning or afternoon?']);
    expect(questionsIn('See you then!')).toEqual([]);
    expect(questionsIn('ok?')).toEqual([]);
  });
});

describe('the ledger', () => {
  it('a first message has nothing to remember', () => {
    expect(chatStateBlock([])).toBe('');
    expect(chatStateBlock(null)).toBe('');
    expect(chatStateBlock([u('hi')])).toBe('');
  });

  it('the open question is the one the last reply ended on; earlier ones are listed apart', () => {
    const h = [u('giá?'), a('Dạ em chào chị ạ. Chị cho em xin tên tiệm ạ?'), u('Kim Nails'), a('Dạ tiệm mình ở thành phố nào ạ?')];
    const s = chatState(h);
    expect(s.replies).toBe(2);
    expect(s.openQuestion).toBe('Dạ tiệm mình ở thành phố nào ạ?');
    expect(s.asked).toEqual(['Chị cho em xin tên tiệm ạ?']);
    const b = chatStateBlock(h);
    expect(b).toContain('WHERE THIS CONVERSATION STANDS');
    expect(b).toContain('do not greet again');
    expect(b).toContain('as their ANSWER');
    expect(b).toContain('«Chị cho em xin tên tiệm ạ?»');
  });

  it('a question asked twice is not to be asked a third time (accents and punctuation do not hide a repeat)', () => {
    const h = [u('hi'), a('What is the name of your shop?'), u('how much'), a('What is the name of your shop ?'), u('just tell me')];
    expect(chatState(h).askedTwice).toEqual(['What is the name of your shop?']);
    expect(chatStateBlock(h)).toContain('Asked TWICE');
  });

  it('what the customer typed and what already went out', () => {
    const h = [u('my number is (832) 555-0142, mail kim@example.com'), a('[Đã gửi 3 ảnh: Gel X]'), a('Here is the booking page: https://lumiobooking.com/book/kim'), u('ok')];
    const s = chatState(h);
    expect(s.gave).toEqual(['(832) 555-0142', 'kim@example.com']);
    expect(s.sent).toEqual(['photos', 'link']);
    expect(s.replies).toBe(1); // a stage direction is not a reply
    expect(chatStateBlock(h)).toContain('never ask for it again');
  });

  it('a price or a year is not a phone number; a reminder the system sent is not a question the AI asked', () => {
    expect(chatState([u('is it $1,200 for 2026?'), a('Yes.')]).gave).toEqual([]);
    expect(chatState([u('hi'), a('Hello!'), a('Are you still there?', { nudge: true })]).asked).toEqual([]);
  });

  it('after days of silence the "do not greet" line gives way', () => {
    const h = [u('hi'), a('Hello! How can I help?')];
    expect(chatStateBlock(h, { gapDays: 3 })).not.toContain('do not greet again');
    expect(chatStateBlock(h, { gapDays: 3 })).toContain('do not introduce yourself again');
  });

  it('never throws on turns it does not understand', () => {
    expect(() => chatStateBlock([{ role: 'assistant', content: [{ type: 'text' }] }, { role: 'tool' }, null as never, u('x')] as never)).not.toThrow();
  });
});

describe('released in stages', () => {
  it('to the test accounts first, held by the golden run', () => {
    expect(RELEASE_FEATURES.chatState.ships).toBe('canary');
    expect(isUiFeature('chatState')).toBe(false);
  });
});

describe('a tool\'s refusal is a note to the assistant, not something the customer said', () => {
  it('save_lead without a name says so, live and dry alike', () => {
    const { dryToolResult, LEAD_NEEDS_NAME } = require('./dry-run');
    expect(dryToolResult('save_lead', { phone: '8325550142' })).toBe(LEAD_NEEDS_NAME);
    expect(LEAD_NEEDS_NAME).toContain('do not answer it');
    expect(LEAD_NEEDS_NAME).toContain('say sorry sincerely first');
    const src = require('fs').readFileSync(require('path').join(__dirname, 'messenger.service.ts'), 'utf8');
    expect(src).toContain('return LEAD_NEEDS_NAME;');
    // Cards count as sent only when a card tool SUCCEEDED (a refused call sends nothing).
    expect(src).toMatch(/cardsOut\?: number \}\)\.cardsOut \?\? 0\) > 0 && \(this\.release\?\.isOn\('cardsOnce'/);
  });
});
