// Jest config — two projects so node API/unit tests and jsdom
// component/accessibility tests each run with the right environment.
//   node project:  existing .test.ts files (API guards, audit, env, tailwind-gate)
//   jsdom project: component & accessibility/interaction tests (.spec.ts, .spec.tsx,
//                  .test.tsx) with @testing-library + jest-axe matchers (jest.setup.ts)
const shared = {
  preset: 'ts-jest',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  roots: ['<rootDir>/src', '<rootDir>/lib', '<rootDir>/app', '<rootDir>/components', '<rootDir>/__tests__', '<rootDir>/tests'],
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
      // tsconfig uses jsx:"preserve" (for Next). Tests need JSX compiled, so
      // override ts-jest to the automatic React runtime for this project.
      transform: {
        '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
      },
    },
  ],
};
