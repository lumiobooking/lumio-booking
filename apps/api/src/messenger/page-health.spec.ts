import { classifyPageError, pageHealthText, shouldAlert } from './page-health';

const IMPERSONATE = 'The user must be an administrator, editor, or moderator of the page in order to impersonate it. If the page business requires Two Factor Authentication, the user also needs to enable Two Factor Authentication.';

describe('page connection health', () => {
  it('names the two causes behind Meta\'s "impersonate" sentence', () => {
    const h = classifyPageError({ message: IMPERSONATE, code: 190, error_subcode: 492 });
    expect(h.lost).toBe(true);
    expect(['two_factor', 'role_lost']).toContain(h.state);
    expect(pageHealthText(h.state)).toMatch(/Kết nối lại/);
    expect(classifyPageError({ message: 'The user must be an administrator, editor, or moderator of the page in order to impersonate it.', code: 190, error_subcode: 492 }).state).toBe('role_lost');
    expect(pageHealthText('role_lost')).toMatch(/vai trò/);
    expect(pageHealthText('two_factor')).toMatch(/2 lớp/);
  });

  it('"log in to www.facebook.com" is a checkpoint on the connecting account, not a revoked token', () => {
    const h = classifyPageError({ message: 'You cannot access the app till you log in to www.facebook.com and follow the instructions given.', code: 190, error_subcode: 459 });
    expect(h).toMatchObject({ state: 'checkpoint', lost: true });
    expect(classifyPageError({ message: 'You cannot access the app till you log in to www.facebook.com and follow the instructions given.', code: 190 }).state).toBe('checkpoint');
    expect(pageHealthText('checkpoint')).toMatch(/www\.facebook\.com/);
    expect(pageHealthText('checkpoint')).toMatch(/Admin khác/);
    expect(pageHealthText('checkpoint', false)).toMatch(/another Admin/);
  });

  it('tells an expired, a revoked and a merely unreachable token apart', () => {
    expect(classifyPageError({ message: 'Error validating access token: Session has expired on Monday', code: 190, error_subcode: 463 }).state).toBe('expired');
    expect(classifyPageError({ message: 'Invalid OAuth access token - Cannot parse access token', code: 190 }).state).toBe('revoked');
    expect(classifyPageError({ message: '(#4) Application request limit reached', code: 4 })).toMatchObject({ state: 'unknown', lost: false });
    expect(classifyPageError(null)).toMatchObject({ state: 'ok', lost: false, raw: null });
  });

  it('alerts the team once per change, not every day', () => {
    const lost = classifyPageError({ message: IMPERSONATE, code: 190, error_subcode: 492 });
    const ok = classifyPageError(null);
    expect(shouldAlert(null, lost)).toBe(true);
    expect(shouldAlert(lost, lost)).toBe(false);
    expect(shouldAlert(ok, lost)).toBe(true);
    expect(shouldAlert(lost, ok)).toBe(false);
    expect(shouldAlert(lost, { ...lost, state: 'revoked' })).toBe(true);
  });
});
