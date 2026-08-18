/**
 * One test run for the whole monorepo.
 *
 * The API already had jest; the web app had no test runner at all, which is why
 * the money rules on the dashboard — the ones a salon types prices into — were
 * only ever checked by hand. Both are projects here so a single `npm test`
 * covers them, and so the deploy can refuse to continue when either fails.
 */
module.exports = {
  projects: [
    {
      displayName: 'api',
      rootDir: '<rootDir>/apps/api',
      testEnvironment: 'node',
      testRegex: '.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
    },
    {
      displayName: 'web',
      rootDir: '<rootDir>/apps/web',
      testEnvironment: 'node',
      testRegex: 'src/lib/.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
    },
  ],
};
