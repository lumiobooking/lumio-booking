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
      // Blocks real network calls. Two builds have now been broken by a unit
      // test quietly calling a live API; see jest.setup.js for both.
      setupFilesAfterEnv: ['<rootDir>/../../jest.setup.js'],
    },
    {
      displayName: 'web',
      rootDir: '<rootDir>/apps/web',
      testEnvironment: 'node',
      testRegex: 'src/(lib|components)/.*\\.spec\\.ts$',
      transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
      setupFilesAfterEnv: ['<rootDir>/../../jest.setup.js'],
    },
  ],
};
