// Integration tests against a running local Supabase stack (`npm run test:integration`).
//
// Plain Node rather than the jest-expo preset: that preset swaps the global
// fetch for Expo's, whose native half is stubbed under Jest, so no request
// would ever reach the server. Nothing here renders, so nothing needs it.
// Files still compile through babel.config.js, as the app's do.
const { jest: base } = require('./package.json');

module.exports = {
  testEnvironment: 'node',
  transformIgnorePatterns: base.transformIgnorePatterns,
  testMatch: ['**/*.integration.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  // Loads the server's URL and key before any module reads them.
  setupFiles: ['<rootDir>/src/sync/__tests__/integration-env.ts'],
  // A cold local stack can take a few seconds to answer the first request.
  testTimeout: 30_000,
};
