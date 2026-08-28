import 'reflect-metadata';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { MessengerController } from './messenger.controller';

/**
 * Which parts of the Messenger module a technician can reach.
 *
 * WHY THIS IS TESTED BY READING THE DECORATORS
 *
 * Opening the inbox to staff means widening routes one at a time. The danger is
 * not the routes I widened on purpose — it is the next one somebody adds. A new
 * endpoint that quietly inherits the wrong role is invisible in review: nothing
 * looks different, and the first sign of trouble is a technician changing the
 * salon's Facebook connection or wiping the conversation history.
 *
 * So this reads the actual @Roles() metadata off the compiled controller and
 * pins the whole picture: every route staff CAN reach, and every route they
 * MUST NOT. A new route defaults to owner-only, and if anyone widens it this
 * test fails and says so by name.
 */

const rolesOf = (method: string): UserRole[] | undefined =>
  Reflect.getMetadata(ROLES_KEY, (MessengerController.prototype as never as Record<string, object>)[method])
  ?? Reflect.getMetadata(ROLES_KEY, MessengerController);

const canStaff = (method: string) => (rolesOf(method) ?? []).includes(UserRole.STAFF);

// Answering customers. A technician needs all of this to do the job.
const STAFF_MAY = [
  'threads', 'thread', 'avatar', 'stream',
  'send', 'handoff', 'threadStatus', 'threadRead', 'rename',
  'addNote', 'deleteNote',
  'labels', 'createLabel', 'setLabel', 'followUp',
  // Turning notifications on for their own phone is NOT here: that already
  // lived at /push/* before this work, open to any signed-in user, and building
  // a second copy of it under /messenger was a mistake caught late. One push
  // subsystem, one set of subscriptions, one place to fix.
];

// Running the business. A technician must never reach any of it.
const STAFF_MUST_NOT = [
  'get', 'connect', 'candidates', 'choose', 'update', 'disconnect',
  'importFacts', 'suggestGreeting',
  'leads', 'leadStatus', 'webhookStatus', 'activity',
  'clearReviewData', 'clearConversations',
  // Deleting a label strips it off every conversation in the shop. Creating one
  // is not destructive; deleting one is, and it is not undoable from the inbox.
  'deleteLabel',
];

describe('what a technician can reach in the inbox', () => {
  it.each(STAFF_MAY)('staff can use %s', (m) => {
    expect(canStaff(m)).toBe(true);
  });

  it.each(STAFF_MUST_NOT)('staff CANNOT use %s', (m) => {
    expect(canStaff(m)).toBe(false);
  });

  it('every route on the controller is accounted for above', () => {
    // The point of the test. A route nobody listed is a route nobody thought
    // about, and this fails until somebody does.
    const routes = Object.getOwnPropertyNames(MessengerController.prototype)
      .filter((n) => n !== 'constructor')
      .filter((n) => typeof (MessengerController.prototype as never as Record<string, unknown>)[n] === 'function');

    const known = new Set([...STAFF_MAY, ...STAFF_MUST_NOT]);
    const unlisted = routes.filter((r) => !known.has(r));
    expect(unlisted).toEqual([]);
  });

  it('never opens anything to a role outside this salon', () => {
    // SUPER_ADMIN and SUPPORT run the platform, not one shop's inbox. Neither
    // should appear on a route here — support reaches a salon through its own
    // short-lived session, not by being named in this module.
    for (const m of [...STAFF_MAY, ...STAFF_MUST_NOT]) {
      const roles = rolesOf(m) ?? [];
      expect(roles).not.toContain(UserRole.SUPER_ADMIN);
      // Compared as a string, not UserRole.SUPPORT: the sandbox's generated
      // Prisma client predates that enum value, and a test that cannot compile
      // locally is a test nobody runs before pushing.
      expect(roles as unknown as string[]).not.toContain('SUPPORT');
    }
  });

  it('the owner keeps access to everything', () => {
    for (const m of [...STAFF_MAY, ...STAFF_MUST_NOT]) {
      expect((rolesOf(m) ?? [])).toContain(UserRole.SALON_ADMIN);
    }
  });
});
