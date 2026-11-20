jest.mock('./api', () => ({ apiFetch: jest.fn() }));
import { apiFetch } from './api';
import { forgetThreadList, threadList } from './thread-list';

const fetchMock = apiFetch as unknown as jest.Mock;

describe('rt229 — the inbox and the alerts share one read of the list', () => {
  beforeEach(() => { fetchMock.mockReset(); forgetThreadList(); });

  it('two asks at once go to the server once', async () => {
    fetchMock.mockResolvedValue([{ id: 't1' }]);
    const [a, b] = await Promise.all([threadList('tok'), threadList('tok')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual([{ id: 't1' }]);
    expect(b).toBe(a);
  });

  it('another account never gets this one’s list', async () => {
    fetchMock.mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }]);
    const a = await threadList('tok-A');
    const b = await threadList('tok-B');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toEqual([{ id: 'a' }]);
    expect(b).toEqual([{ id: 'b' }]);
  });

  it('a failed read is not handed to the next ask', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce([{ id: 'ok' }]);
    await expect(threadList('tok')).rejects.toThrow('down');
    await expect(threadList('tok')).resolves.toEqual([{ id: 'ok' }]);
  });
});
