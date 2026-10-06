// 1. src/setupTests.ts - MANTENER SIMPLE
import { jest } from '@jest/globals';

// Configurar variables de entorno para tests
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.DATABASE_PATH = './data/test-leads.db';

afterEach(() => {
  jest.clearAllMocks();
});
