/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-preset-angular',
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/setup-jest.ts'],
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$|@angular)'],
  moduleNameMapper: {
    '^@wailsjs/(.*)$': '<rootDir>/wailsjs/$1',
    '^@angular/cdk/scrolling$': '<rootDir>/node_modules/@angular/cdk/fesm2022/scrolling.mjs'
  },
  transform: {
    '^.+\\.(ts|mjs|js|html)$': ['<rootDir>/jest-transformer.cjs', {
      tsconfig: '<rootDir>/tsconfig.spec.json',
      stringifyContentPathRegex: '\\.(html|svg)$',
      useESM: true
    }]
  }
};
