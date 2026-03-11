module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/unit/**/*.test.js'],
  modulePathIgnorePatterns: [
    '<rootDir>/templates/'
  ],
  collectCoverageFrom: [
    'server/**/*.js',
    '!server/index.js', // Entry point, tested via e2e
    '!**/node_modules/**'
  ],
  coverageDirectory: 'coverage',
  verbose: true
};
