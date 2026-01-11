/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      stringifyContentPathRegex: '\\.(html|svg)$'
    }
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular)'],
  moduleNameMapper: {
    '^@wailsjs/(.*)$': '<rootDir>/wailsjs/$1'
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': 'jest-preset-angular'
  }
};
