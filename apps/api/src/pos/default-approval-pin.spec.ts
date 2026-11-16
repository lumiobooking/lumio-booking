import { ForbiddenException } from '@nestjs/common';
import { DEFAULT_APPROVAL_PIN, PosService } from './pos.service';

/* 0000 approves for a salon owner who has not set a PIN yet — only in that
 * owner's own salon, and never once the owner set their own. */
describe('default approval PIN 0000', () => {
  const cashier = { userId: 'cashier', role: 'STAFF', staffRole: 'CASHIER', staffCaps: [] } as never;
  function fakeThis(owners: { id: string; tenantId: string; approvalPinHash: string | null }[]) {
    return {
      prisma: {
        user: {
          findMany: jest.fn(async () => []),
          findFirst: jest.fn(async ({ where }: { where: { tenantId: string; approvalPinHash: null } }) => owners.find((o) => o.tenantId === where.tenantId && o.approvalPinHash === null) ?? null),
        },
        staffMember: { findMany: jest.fn(async () => []) },
      },
    };
  }
  const approve = (self: unknown, tenantId: string, pin: string) => (PosService.prototype as unknown as { approverFor: (u: unknown, t: string, p: string) => Promise<string> }).approverFor.call(self, cashier, tenantId, pin);

  it('is 0000', () => { expect(DEFAULT_APPROVAL_PIN).toBe('0000'); });
  it('an owner without a PIN approves with 0000', async () => {
    await expect(approve(fakeThis([{ id: 'owner1', tenantId: 't1', approvalPinHash: null }]), 't1', '0000')).resolves.toBe('owner1');
  });
  it('not once the owner set their own PIN, and never across salons', async () => {
    await expect(approve(fakeThis([{ id: 'owner1', tenantId: 't1', approvalPinHash: 'x' }]), 't1', '0000')).rejects.toThrow(ForbiddenException);
    await expect(approve(fakeThis([{ id: 'owner2', tenantId: 't2', approvalPinHash: null }]), 't9', '0000')).rejects.toThrow(ForbiddenException);
  });
  it('any other PIN still fails', async () => {
    await expect(approve(fakeThis([{ id: 'owner1', tenantId: 't3', approvalPinHash: null }]), 't3', '1234')).rejects.toThrow('PIN không đúng');
  });
});
