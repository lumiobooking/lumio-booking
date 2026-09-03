import { readEsmsCallback } from './esms-callback';

describe('readEsmsCallback', () => {
  it('reads a delivered callback (SendStatus 5 with a success counter)', () => {
    const r = readEsmsCallback({
      SMSID: 'abc-123', RequestId: 'notif-9', SendStatus: '5',
      SendSuccess: '1', SendFailed: '0', TotalSent: '1', telcoid: '1',
    });
    expect(r).toEqual({ smsId: 'abc-123', requestId: 'notif-9', outcome: 'delivered' });
  });

  it('reads a carrier failure and names the carrier', () => {
    const r = readEsmsCallback({ SMSID: 'x', SendStatus: '5', SendSuccess: '0', SendFailed: '1', telcoid: '2' });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toContain('Mobifone');
  });

  it('treats SendStatus 4 as a terminal rejection even with empty counters', () => {
    const r = readEsmsCallback({ SMSID: 'x', SendStatus: '4' });
    expect(r.outcome).toBe('failed');
    expect(r.reason).toContain('từ chối');
  });

  it('stays silent while the message is still moving (statuses 1, 2, 7)', () => {
    for (const s of ['1', '2', '7']) {
      expect(readEsmsCallback({ SMSID: 'x', SendStatus: s }).outcome).toBe('pending');
    }
    // 5 with counters not yet settled is also not an answer.
    expect(readEsmsCallback({ SMSID: 'x', SendStatus: '5', SendSuccess: '0', SendFailed: '0' }).outcome).toBe('pending');
  });

  it('tolerates the case drift in eSMS field names', () => {
    const r = readEsmsCallback({ smsid: 'low', requestid: 'req', sendstatus: '5', sendsuccess: 1 });
    expect(r).toEqual({ smsId: 'low', requestId: 'req', outcome: 'delivered' });
  });

  it('returns empty ids rather than throwing on garbage', () => {
    const r = readEsmsCallback({});
    expect(r.smsId).toBe('');
    expect(r.requestId).toBe('');
    expect(r.outcome).toBe('pending');
  });
});
