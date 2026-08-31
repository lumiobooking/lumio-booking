import { withBookingLink } from './booking-link';

describe('the confirmation link is attached by us, not left to the model', () => {
  const URL = 'https://book.lumio.app/a/abc123';

  it('appends the link to a reply that forgot it', () => {
    // The exact reply that went out with no link in it. The tool result had
    // asked for one; a tool result is a suggestion, not a requirement.
    const said = "You're all set for Nail Design on Thursday, September 3rd at 2 PM! Confirmation is on the way. 🎉";
    expect(withBookingLink(said, URL)).toBe(`${said}\n${URL}`);
  });

  it('does not add it twice when the model did include it', () => {
    const said = `All booked! You can view or cancel here: ${URL}`;
    expect(withBookingLink(said, URL)).toBe(said);
  });

  it('leaves an ordinary reply alone when nothing was booked', () => {
    expect(withBookingLink('Which day suits you?')).toBe('Which day suits you?');
    expect(withBookingLink('Which day suits you?', '')).toBe('Which day suits you?');
    expect(withBookingLink('Which day suits you?', null)).toBe('Which day suits you?');
  });

  it('works whatever language the reply is in', () => {
    // The reason it is a bare URL on its own line: the bot answers in whatever
    // language the customer wrote, and no lead-in sentence is right in all of
    // them. A link reads the same everywhere.
    const vi = 'Đã đặt lịch cho chị Sue, Thứ 5 lúc 2 giờ chiều nhé!';
    expect(withBookingLink(vi, URL)).toBe(`${vi}\n${URL}`);
  });

  it('still sends the link if the model said nothing at all', () => {
    expect(withBookingLink('', URL)).toBe(URL);
    expect(withBookingLink('   ', URL)).toBe(URL);
  });
});
