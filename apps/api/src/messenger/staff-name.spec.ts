import { staffLabel } from './staff-name';
import { mergeHistory, HistoryTurn } from './history-merge';

describe('which teammate typed a reply', () => {
  it('uses the account first name', () => {
    expect(staffLabel({ firstName: '  Sophia ', email: 'sophia23289@gmail.com' })).toBe('Sophia');
  });

  it('falls back to the technician profile, then the email name', () => {
    expect(staffLabel({ firstName: '', staffFirstName: 'Lan', email: 'x@y.com' })).toBe('Lan');
    expect(staffLabel({ email: 'sophia23289@gmail.com' })).toBe('sophia23289');
  });

  it('never returns a whole email address or an empty string', () => {
    expect(staffLabel({ email: 'owner@salon.com' })).not.toContain('@');
    expect(staffLabel({})).toBeNull();
    expect(staffLabel(null)).toBeNull();
  });

  it('keeps a long name short', () => {
    expect(staffLabel({ firstName: 'A'.repeat(60) })).toHaveLength(24);
  });
});

describe('the sender survives the merge with Meta’s transcript', () => {
  const u = (content: string): HistoryTurn => ({ role: 'user', content });
  const a = (content: string, over: Partial<HistoryTurn> = {}): HistoryTurn => ({ role: 'assistant', content, ...over });

  it('carries the name across on the message id', () => {
    const meta = [u('còn chỗ không'), a('Dạ còn 2pm ạ', { messageId: 'm1' })];
    const local = [a('Dạ còn 2pm ạ', { manual: true, messageId: 'm1', by: 'Sophia' })];
    const out = mergeHistory(meta, local);
    expect(out[1]).toMatchObject({ manual: true, by: 'Sophia' });
  });

  it('carries the name across on the text when there is no id', () => {
    const meta = [a('Thank you')];
    const local = [a('Thank you', { manual: true, by: 'Lan' })];
    expect(mergeHistory(meta, local)[0]).toMatchObject({ manual: true, by: 'Lan' });
  });

  it('does not give the bot a name', () => {
    const meta = [a('Hi! How can I help?')];
    expect(mergeHistory(meta, [])[0].by).toBeUndefined();
  });
});
