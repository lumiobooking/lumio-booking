import { composeCaption, captionIssues } from './caption-style';

const BAD = `Gel Polish Change in real time. Clean lines. Precision hand. Every detail locked in. This is what $25 / 20 minutes looks like when you book with us. Zero stress, zero mistakes. Swipe in bio to book your next refresh. 💅✨
#NailArt #GelPolish #NailTechnician #Kerrville #DetailsCount #QuickService #SalonLife #ProNails #NailGoals`;

describe('captionIssues', () => {
  it('CATCHES EVERYTHING WRONG WITH THE CAPTION THAT STARTED THIS', () => {
    const issues = captionIssues(BAD);
    expect(issues.join(' | ')).toMatch(/câu cụt/);
    expect(issues.join(' | ')).toMatch(/swipe in bio/);
    expect(issues.join(' | ')).toMatch(/không kiểm chứng/);
    expect(issues.join(' | ')).toMatch(/9 hashtag/);
    expect(issues.join(' | ')).toMatch(/thiếu dòng trống/);
  });

  it('passes a caption written to the shape', () => {
    const good = composeCaption({
      hook: 'A full gel change in 20 minutes.',
      proof: 'Old set off, new colour on, cured under the lamp — 20 minutes from chair to door.',
      ask: 'Book in 30 seconds — link in bio.',
      talk: 'Which colour would you pick? Tell us below 👇',
    }) + '\n\n#kerrvillenails #kerrvilletx #gelpolish #gelmanicure #nailsoftheday #nailsofinstagram';
    expect(captionIssues(good)).toEqual([]);
  });

  it('counts words before the tags, not the tags', () => {
    const long = `${'word '.repeat(61)}\n\nBook now.\n\n#a #b #c #d #e`;
    expect(captionIssues(long).join(' ')).toMatch(/quá dài: 6[1-9] từ/);
  });

  it('allows two emoji and objects to three', () => {
    expect(captionIssues('Hook 💅\nProof line here.\n\nBook — link in bio ✨')).toEqual([]);
    expect(captionIssues('Hook 💅✨\nProof.\n\nBook 🎉').join(' ')).toMatch(/3 emoji/);
  });

  it('does not mistake three normal sentences for a fragment chain', () => {
    const ok = 'We changed the colour in twenty minutes. She had a meeting at noon. She made it with time to spare.\n\nBook — link in bio.';
    expect(captionIssues(ok).join(' ')).not.toMatch(/câu cụt/);
  });
});

describe('composeCaption', () => {
  it('puts the blank line where the ask begins and drops empty parts', () => {
    expect(composeCaption({ hook: 'Hook', ask: 'Ask' })).toBe('Hook\n\nAsk');
    expect(composeCaption({ hook: 'Hook', proof: 'Proof', ask: 'Ask', talk: 'Talk' })).toBe('Hook\nProof\n\nAsk\nTalk');
  });
});
