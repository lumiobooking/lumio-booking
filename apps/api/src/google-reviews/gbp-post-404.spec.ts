import { explainLocalPost404, bareLocationId } from './gbp-post-404';

describe('explainLocalPost404 — one 404, three owners of the fix', () => {
  it('a location that no longer exists sends the salon to re-pick it', () => {
    const v = explainLocalPost404({ locationFound: false });
    expect(v.kind).toBe('stale-location');
    expect(v.message).toContain('chọn lại địa điểm');
  });

  it('an unverified listing names verification, and names the OWNER as the one to do it', () => {
    const v = explainLocalPost404({ locationFound: true, canOperateLocalPost: false, hasVoiceOfMerchant: false });
    expect(v.kind).toBe('cannot-post');
    expect(v.message).toContain('CHƯA ĐƯỢC XÁC MINH');
    expect(v.message).toContain('business.google.com');
    // Not our fix: no "chọn lại địa điểm", no "kết nối lại".
    expect(v.message).not.toContain('chọn lại địa điểm');
  });

  it('a verified listing Google still refuses points at the Google dashboard and offers the other channels', () => {
    const v = explainLocalPost404({ locationFound: true, canOperateLocalPost: false, hasVoiceOfMerchant: true });
    expect(v.kind).toBe('cannot-post');
    expect(v.message).toContain('Add update');
    expect(v.message).toContain('Facebook/Instagram');
  });

  it('a location owned by another account is repaired, not explained', () => {
    const v = explainLocalPost404({ locationFound: true, canOperateLocalPost: true, ownerAccount: 'accounts/222', storedAccount: 'accounts/111' });
    expect(v.kind).toBe('wrong-account');
    if (v.kind === 'wrong-account') expect(v.fixAccount).toBe('accounts/222');
    expect(v.message).toContain('tự sửa');
  });

  it('the same account is not a mismatch', () => {
    const v = explainLocalPost404({ locationFound: true, canOperateLocalPost: true, ownerAccount: 'accounts/111', storedAccount: 'accounts/111' });
    expect(v.kind).toBe('unknown');
  });

  it('never claims to have fixed something when the owner was not found', () => {
    const v = explainLocalPost404({ locationFound: true, canOperateLocalPost: true, ownerAccount: null, storedAccount: 'accounts/111' });
    expect(v.kind).toBe('unknown');
    expect(v.message).not.toContain('tự sửa');
  });
});

describe('bareLocationId', () => {
  it.each([
    ['locations/456', 'locations/456'],
    ['accounts/1/locations/456', 'locations/456'],
  ])('%s → %s', (a, b) => expect(bareLocationId(a)).toBe(b));
});
