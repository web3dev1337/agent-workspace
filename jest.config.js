module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js', // Entry point, tested via e2e
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
