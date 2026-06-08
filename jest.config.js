/** Jest config — runs the TS test suite via ts-jest (already installed). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  roots: ['<rootDir>/src', '<rootDir>/lib', '<rootDir>/app', '<rootDir>/components'],
}
