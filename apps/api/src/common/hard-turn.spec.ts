import { HardBudget, hardDailyCap, hardModel, hardTurnReason, modelForTurn } from './hard-turn';

describe('two-tier brain — the stronger model only for the turns that deserve it', () => {
  it('everyday messages stay on the everyday model', () => {
    for (const t of ['Mai mấy giờ mở cửa?', 'How much is a gel manicure?', 'ok 3pm', 'Cho mình đặt lịch thứ 7 nha', 'cảm ơn shop', '2 người làm móng lúc 3h được không', '']) {
      expect(hardTurnReason(t)).toBeNull();
    }
  });

  it('a complaint, a group, a comparison and a long message are hard', () => {
    expect(hardTurnReason('Lần trước làm xong 2 ngày đã bị bong, mình rất bực')).toBe('complaint');
    expect(hardTurnReason('I want a refund, this is unacceptable')).toBe('complaint');
    expect(hardTurnReason('Thứ 7 này 4 người làm chân được không')).toBe('group');
    expect(hardTurnReason('Can five of us come in Saturday?')).toBe('group');
    expect(hardTurnReason('party of 6 for pedicures')).toBe('group');
    expect(hardTurnReason('Gói Pro với gói Starter khác nhau chỗ nào?')).toBe('compare');
    expect(hardTurnReason('Giá sao? Có bảo hành không? Mấy giờ đóng cửa?')).toBe('long');
    expect(hardTurnReason('a'.repeat(401))).toBe('long');
  });

  it('is OFF until the platform names a hard model — nothing changes for anyone', () => {
    const budget = new HardBudget();
    expect(hardModel({})).toBe('');
    expect(modelForTurn({ tenantId: 'ta', reason: 'complaint', budget, env: {} })).toBeUndefined();
    expect(budget.usedToday('ta')).toBe(0);
  });

  it('when on: hard turns use it, easy turns never do', () => {
    const env = { ANTHROPIC_HARD_MODEL: ' claude-sonnet-5-5 ' };
    const budget = new HardBudget();
    expect(modelForTurn({ tenantId: 'ta', reason: 'complaint', budget, env })).toBe('claude-sonnet-5-5');
    expect(modelForTurn({ tenantId: 'ta', reason: null, budget, env })).toBeUndefined();
    expect(budget.usedToday('ta')).toBe(1);
  });

  it('the daily cap is per salon: one salon’s busy day never spends another’s share', () => {
    const env = { ANTHROPIC_HARD_MODEL: 'claude-sonnet-5-5', ANTHROPIC_HARD_DAILY: '2' };
    let day = '2026-11-16T10:00:00Z';
    const budget = new HardBudget(() => new Date(day));
    expect(modelForTurn({ tenantId: 'ta', reason: 'group', budget, env })).toBe('claude-sonnet-5-5');
    expect(modelForTurn({ tenantId: 'ta', reason: 'group', budget, env })).toBe('claude-sonnet-5-5');
    expect(modelForTurn({ tenantId: 'ta', reason: 'group', budget, env })).toBeUndefined();
    expect(modelForTurn({ tenantId: 'tb', reason: 'group', budget, env })).toBe('claude-sonnet-5-5');
    day = '2026-11-17T00:01:00Z';
    expect(modelForTurn({ tenantId: 'ta', reason: 'group', budget, env })).toBe('claude-sonnet-5-5');
  });

  it('reads the cap defensively', () => {
    expect(hardDailyCap({})).toBe(40);
    expect(hardDailyCap({ ANTHROPIC_HARD_DAILY: 'abc' })).toBe(40);
    expect(hardDailyCap({ ANTHROPIC_HARD_DAILY: '0' })).toBe(0);
  });
});
