module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // Configuración moderna de ts-jest (no deprecated)
        useESM: false,
        tsconfig: {
          target: "ES2017",
          module: "commonjs",
        },
      },
    ],
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!src/setupTests.ts",
  ],
  // ✅ CORREGIDO: moduleNameMapping → moduleNameMapper
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.ts"],
  testTimeout: 30000,
  verbose: true,
  clearMocks: true,
  restoreMocks: true,

  // Ignorar archivos de base de datos
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/data/",
  ],

  // Configuración para mocks
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],

  // Configuración de coverage
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
