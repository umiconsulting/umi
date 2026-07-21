// 1. src/setupTests.ts - MANTENER SIMPLE
import { jest } from '@jest/globals';
import { existsSync, unlinkSync, readdirSync } from 'fs';
import path from 'path';

// Configurar variables de entorno para tests
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.DATABASE_PATH = './data/test-leads.db';

// Función para limpiar archivos de test de base de datos
const cleanTestDatabases = () => {
  const dataDir = path.join(process.cwd(), 'data');
  if (existsSync(dataDir)) {
    const files = readdirSync(dataDir);
    files.forEach((file) => {
      if (file.includes('test') && file.endsWith('.db')) {
        const filePath = path.join(dataDir, file);
        try {
          unlinkSync(filePath);
          console.log(`🧹 Archivo de test eliminado: ${file}`);
        } catch {
          console.warn(`⚠️ No se pudo eliminar: ${file}`);
        }
      }
    });
  }
};

beforeAll(() => {
  console.log('🚀 Iniciando configuración de tests...');
  cleanTestDatabases();
});

afterAll(() => {
  console.log('🧹 Limpiando después de todos los tests...');
  cleanTestDatabases();
});

afterEach(() => {
  jest.clearAllMocks();
});
