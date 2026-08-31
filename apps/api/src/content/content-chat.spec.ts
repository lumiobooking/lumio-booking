import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ContentChatService } from './content-chat.service';
import type { AuthenticatedUser } from '../common/tenant/tenant-context';

type Row = {
  id: string; tenantId: string; subject: string; side: string;
  authorName: string; body: string; createdAt: Date;
  readByLumioAt: Date | null; readBySalonAt: Date | null;
};

function fakePrisma(seed: Partial<Row>[] = []) {
  const rows: Row[] = seed.map((r, i) => ({
    id: `m-${i}`, tenantId: 'tenant-a', subject: 'general', side: 'salon',
    authorName: 'x', body: 'x', createdAt: new Date(2026, 0, i + 1),
    readByLumioAt: null, readBySalonAt: null, ...r,
  }));
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (v === null
      ? (r as unknown as Record<string, unknown>)[k] === null
      : (r as unknown as Record<string, unknown>)[k] === v));
  return {
    contentMessage: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where))),
      create: jest.fn(async ({ data }: { data: Partial<Row> }) => {
        const row = { ...rows[0], ...data, id: `m-${rows.length}`, createdAt: new Date() } as Row;
        rows.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        let n = 0;
        for (const r of rows) if (match(r, where)) { Object.assign(r, data); n += 1; }
        return { count: n };
      }),
    },
    _rows: rows,
  };
}

const salon: AuthenticatedUser = {
  userId: 'u-s', email: 'owner@salon.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a',
};
const lumio: AuthenticatedUser = { ...salon, userId: 'u-l', email: 'me@lumio.test', supportSession: true };

const svc = (p: ReturnType<typeof fakePrisma>) => new ContentChatService(p as never);

describe('an address is validated, never trusted', () => {
  const s = svc(fakePrisma());

  it('accepts the four shapes the screen actually uses', async () => {
    for (const sub of ['general', 'ads', 'week:2026-W36', 'idea:abc123def']) {
      await expect(s.list(salon, sub)).resolves.toMatchObject({ subject: sub });
    }
  });

  it('refuses anything else rather than storing a thread nobody can find', async () => {
    // `subject` goes straight into a WHERE clause. An unbounded string is a
    // thread addressed to a screen that does not exist.
    for (const bad of ['week:nonsense', 'idea:x', '../general', '', 'week:2026-W1']) {
      await expect(s.list(salon, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
  });
});

describe('which side wrote it is decided at write time', () => {
  it('marks a support session as Lumio and a salon login as the salon', async () => {
    const p = fakePrisma();
    await svc(p).send(lumio, 'general', 'từ team');
    await svc(p).send(salon, 'general', 'từ tiệm');
    expect(p._rows.map((r) => r.side)).toContain('lumio');
    expect(p._rows.map((r) => r.side)).toContain('salon');
  });

  it('does not recolour history when the same person signs in differently', async () => {
    // A support token carries a SALON_ADMIN role by design. Deriving the side
    // at READ time would flip every old message the moment the same human
    // logged in the other way.
    const p = fakePrisma();
    await svc(p).send(lumio, 'general', 'hello');
    const asSalon = await svc(p).list(salon, 'general');
    expect(asSalon.messages[0].side).toBe('lumio');
    expect(asSalon.side).toBe('salon');
  });

  it('never signs a salon message as Lumio', async () => {
    const p = fakePrisma();
    await svc(p).send(salon, 'general', 'xin chào');
    expect(p._rows[0].authorName).not.toBe('Lumio');
  });
});

describe('the unread dot lands on the item being discussed', () => {
  it('counts only the other side’s unread messages, per subject', async () => {
    const p = fakePrisma([
      { subject: 'general', side: 'salon', readByLumioAt: null },
      { subject: 'idea:abc123def', side: 'salon', readByLumioAt: null },
      { subject: 'idea:abc123def', side: 'salon', readByLumioAt: null },
      // Lumio's own messages are not unread FOR Lumio.
      { subject: 'general', side: 'lumio', readByLumioAt: new Date() },
    ]);
    const u = await svc(p).unread(lumio);
    expect(u.total).toBe(3);
    expect(u.bySubject['idea:abc123def']).toBe(2);
    expect(u.bySubject.general).toBe(1);
  });

  it('is empty for the side that wrote everything', async () => {
    const p = fakePrisma([{ subject: 'general', side: 'lumio' }]);
    expect((await svc(p).unread(lumio)).total).toBe(0);
  });

  it('clears only MY side when I read a thread', async () => {
    // Marking both would wipe the other side's dot without them seeing
    // anything — the bug that makes an unread count untrustworthy.
    const p = fakePrisma([{ subject: 'general', side: 'salon' }]);
    await svc(p).list(lumio, 'general');
    expect(p._rows[0].readByLumioAt).not.toBeNull();
    expect(p._rows[0].readBySalonAt).toBeNull();
  });
});

describe('it refuses to send nothing', () => {
  it('rejects an empty or whitespace body', async () => {
    const s = svc(fakePrisma());
    await expect(s.send(salon, 'general', '   ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps a very long message rather than storing it whole', async () => {
    const p = fakePrisma();
    await svc(p).send(salon, 'general', 'x'.repeat(9000));
    expect(p._rows[p._rows.length - 1].body.length).toBe(4000);
  });
});

describe('tenant isolation', () => {
  it('reads and writes only inside the caller’s salon', async () => {
    const p = fakePrisma([{ tenantId: 'tenant-b', subject: 'general', side: 'salon', body: 'someone else' }]);
    const r = await svc(p).list(salon, 'general');
    expect(r.messages).toHaveLength(0);
    await svc(p).send(salon, 'general', 'mine');
    expect(p.contentMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: 'tenant-a' }) }),
    );
  });
});

// ---- what makes it survive a year -----------------------------------------

describe('a thread that outlives its first two hundred messages', () => {
  it('shows the NEWEST page, not the first one written', async () => {
    // The first version took the first 200 rows ascending. Fine for a month,
    // then silently wrong for ever: message 201 onwards never appears and the
    // thread looks abandoned while both sides are still writing into it.
    const many = Array.from({ length: 120 }, (_, i) => ({
      subject: 'general', side: 'salon' as const, body: `m${i}`,
    }));
    const p = fakePrisma(many);
    // The fake returns insertion order; the service asks for desc + slice +
    // reverse, so the assertion that matters is that it PAGES rather than
    // taking everything.
    const r = await svc(p).list(salon, 'general');
    expect(r.messages.length).toBeLessThanOrEqual(50);
    expect(r.hasMore).toBe(true);
    expect(r.oldestAt).not.toBeNull();
  });

  it('reports no more pages on a short thread', async () => {
    const r = await svc(fakePrisma([{ subject: 'general', side: 'salon' }])).list(salon, 'general');
    expect(r.hasMore).toBe(false);
  });
});

describe('a message is signed by a person, not by a company', () => {
  it('names the Lumio staff member who wrote it', async () => {
    // "Lumio" was wrong the moment a second person joined: an answer signed by
    // a company is an answer nobody is accountable for, and the team cannot
    // tell who replied last either.
    const p = fakePrisma();
    await svc(p).send({ ...lumio, email: 'thao.nguyen@lumio.test' }, 'general', 'chào chị');
    expect(p._rows[p._rows.length - 1].authorName).toBe('Lumio · thao nguyen');
  });

  it('falls back to the company only when there is no human name', async () => {
    const p = fakePrisma();
    await svc(p).send({ ...lumio, email: '' }, 'general', 'x');
    expect(p._rows[p._rows.length - 1].authorName).toBe('Lumio');
  });
});
