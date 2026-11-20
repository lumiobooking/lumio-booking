import { commentOnly, isCommentNotice, pickComment, postIdFromNotice } from './comment-reply';
import { readSendRefusal } from './send-errors';

const notice = 'Lien Vo đã bình luận về bài viết của bạn. Lien Vo sẽ chỉ nhìn thấy đoạn chat này sau khi bạn bắt đầu cuộc trò chuyện. Đoạn chat này sẽ biến mất sau 7 ngày nếu bạn không điều đó. Xem bình luận(https://facebook.com/story.php?story_fbid=12345&id=999)';

describe('rt227 — a customer who only commented (#551)', () => {
  it('recognises Meta’s note and the post it points at', () => {
    expect(isCommentNotice(notice)).toBe(true);
    expect(isCommentNotice('Chào chị')).toBe(false);
    expect(postIdFromNotice(notice)).toBe('999_12345');
    expect(postIdFromNotice('xem https://www.facebook.com/999/posts/777')).toBe('999_777');
    expect(postIdFromNotice('không có link')).toBeNull();
  });

  it('comment-only until the customer writes on Messenger', () => {
    const h = [{ role: 'user', content: notice }, { role: 'user', content: 'Ib nhe' }];
    expect(commentOnly(h)).toMatchObject({ commentText: 'Ib nhe' });
    expect(commentOnly([...h, { role: 'assistant', content: 'Chào chị' }])).not.toBeNull();
    expect(commentOnly([...h, { role: 'assistant', content: 'Chào chị' }, { role: 'user', content: 'Dạ em muốn hỏi giá' }])).toBeNull();
    expect(commentOnly([{ role: 'user', content: 'Hello' }])).toBeNull();
  });

  it('finds the customer’s comment by id, then name, then words', () => {
    const cs = [{ id: 'c1', message: 'Đẹp quá', from: { id: 'x', name: 'An' } }, { id: 'c2', message: 'Ib nhe', from: { name: 'Lien Vo' } }];
    expect(pickComment(cs, { psid: 'x' })?.id).toBe('c1');
    expect(pickComment(cs, { name: 'lien vo', text: 'Ib nhe' })?.id).toBe('c2');
    expect(pickComment(cs, { text: 'ib  nhe' })?.id).toBe('c2');
    expect(pickComment(cs, { name: 'Nobody', text: 'nope' })).toBeNull();
  });

  it('#551 is explained in words, never "(#551) This person isn’t available"', () => {
    const r = readSendRefusal(400, { code: 551, message: "(#551) This person isn't available right now." });
    expect(r.reason).not.toMatch(/#551/);
  });
});
