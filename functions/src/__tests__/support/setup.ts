import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import path from 'path';
import { beforeAll, afterAll, beforeEach, expect } from '@jest/globals';

// Глобальная переменная для хранения окружения
let testEnv: RulesTestEnvironment;

// Увеличиваем таймауты для тестов с эмуляторами
// jest.setTimeout(30000); // Убрано, так как jest не импортирован

// --- ГЛОБАЛЬНАЯ НАСТРОЙКА (ЗАПУСКАЕТСЯ ОДИН РАЗ ПЕРЕД ВСЕМИ ТЕСТАМИ) ---
beforeAll(async () => {
  // Устанавливаем переменные окружения, чтобы Admin SDK знал, куда подключаться
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
  process.env.GOOGLE_CLOUD_PROJECT = 'amulet-test'; // Важно указать projectId

  // Инициализируем тестовую среду для правил
  testEnv = await initializeTestEnvironment({
    projectId: 'amulet-test',
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
    },
  });

  // Инициализируем Admin SDK, если он еще не инициализирован
  // Это должно происходить ПОСЛЕ установки переменных окружения
  if (admin.apps.length === 0) {
    admin.initializeApp({ projectId: 'amulet-test' });
  }
});

// --- ГЛОБАЛЬНАЯ ОЧИСТКА (ЗАПУСКАЕТСЯ ОДИН РАЗ ПОСЛЕ ВСЕХ ТЕСТОВ) ---
afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

// --- ОЧИСТКА МЕЖДУ ТЕСТАМИ ---
beforeEach(async () => {
  if (testEnv) {
    // Очищаем данные в эмуляторе перед каждым тестом
    // Исключаем тесты, которые создают данные в beforeAll (например, seed.test.ts)
    const testPath = expect.getState().testPath || '';
    if (!testPath.includes('seed.test.ts') && !testPath.includes('firestore.integration.test.ts')) {
      await testEnv.clearFirestore();
    }
  }
});

// Экспортируем testEnv для использования в тестах правил
export { testEnv };