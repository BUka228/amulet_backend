/**
 * Настройка тестовой среды для Firebase Emulator Suite
 */

// import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

// Глобальная настройка для всех тестов
beforeAll(async () => {
  // Устанавливаем переменные окружения для эмуляторов
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST = 'localhost:9199';
  process.env.FIREBASE_FUNCTIONS_EMULATOR_HOST = 'localhost:5001';
});

// Очистка после каждого теста
afterEach(async () => {
  // Очищаем все эмуляторы после каждого теста
  if (global.testEnv) {
    await global.testEnv.clearFirestore();
    await global.testEnv.clearAuth();
    await global.testEnv.clearStorage();
  }
});

// Глобальная очистка
afterAll(async () => {
  if (global.testEnv) {
    await global.testEnv.cleanup();
  }
});

// Увеличиваем таймауты для тестов с эмуляторами
jest.setTimeout(30000);

// Настройка для работы с Firebase Admin SDK в тестах
export const setupTestEnvironment = async (projectId: string) => {
  // Временно отключаем из-за отсутствия пакета
  // const testEnv = await initializeTestEnvironment({
  //   projectId,
  //   firestore: {
  //     rules: `
  //       rules_version = '2';
  //       service cloud.firestore {
  //         match /databases/{database}/documents {
  //           match /{document=**} {
  //             allow read, write: if true; // Разрешаем все для тестов
  //           }
  //         }
  //       }
  //     `,
  //     host: 'localhost',
  //     port: 8080
  //   },
  //   auth: {
  //     host: 'localhost',
  //     port: 9099
  //   },
  //   storage: {
  //     rules: `
  //       rules_version = '2';
  //       service firebase.storage {
  //         match /b/{bucket}/o {
  //           match /{allPaths=**} {
  //             allow read, write: if true; // Разрешаем все для тестов
  //           }
  //         }
  //       }
  //     `,
  //     host: 'localhost',
  //     port: 9199
  //   }
  // });

  // global.testEnv = testEnv;
  // return testEnv;
  
  // Заглушка для компиляции
  return null as any;
};

// Утилиты для создания тестовых данных
export const createTestUser = async (testEnv: any, uid: string, customClaims?: any) => {
  return testEnv.authenticatedContext(uid, customClaims);
};

export const createTestData = async (firestore: any, collection: string, data: any[]) => {
  const results = [];
  for (const item of data) {
    const docRef = await firestore.collection(collection).add(item);
    results.push({ id: docRef.id, ...item });
  }
  return results;
};

// Утилиты для проверки индексов
export const testIndexQuery = async (
  firestore: any,
  collection: string,
  queryConstraints: any[],
  expectedCount: number
) => {
  const query = firestore.collection(collection);
  queryConstraints.forEach(constraint => {
    if (constraint.type === 'where') {
      query.where(constraint.field, constraint.operator, constraint.value);
    } else if (constraint.type === 'orderBy') {
      query.orderBy(constraint.field, constraint.direction);
    } else if (constraint.type === 'limit') {
      query.limit(constraint.value);
    }
  });

  const snapshot = await query.get();
  expect(snapshot.size).toBe(expectedCount);
  return snapshot;
};

// Утилиты для проверки правил безопасности
export const testSecurityRule = async (
  testEnv: any,
  uid: string,
  customClaims: any,
  operation: 'read' | 'write',
  path: string,
  data?: any,
  shouldSucceed: boolean = true
) => {
  const context = testEnv.authenticatedContext(uid, customClaims);
  
  try {
    if (operation === 'read') {
      await context.firestore().doc(path).get();
    } else if (operation === 'write') {
      if (data) {
        await context.firestore().doc(path).set(data);
      } else {
        await context.firestore().doc(path).delete();
      }
    }
    
    if (!shouldSucceed) {
      fail('Expected operation to fail but it succeeded');
    }
    } catch (error: any) {
      if (shouldSucceed) {
        fail(`Expected operation to succeed but it failed: ${error.message}`);
      }
    }
};

// Утилиты для тестирования производительности
export const measureQueryPerformance = async (
  queryFn: () => Promise<any>,
  maxTimeMs: number = 1000
) => {
  const startTime = Date.now();
  const result = await queryFn();
  const endTime = Date.now();
  const duration = endTime - startTime;
  
  expect(duration).toBeLessThan(maxTimeMs);
  return { result, duration };
};

// Утилиты для тестирования пагинации
export const testPagination = async (
  firestore: any,
  collection: string,
  pageSize: number,
  totalItems: number
) => {
  let allDocs = [];
  let lastDoc = null;
  let pageCount = 0;
  
  while (allDocs.length < totalItems && pageCount < 10) { // Защита от бесконечного цикла
    let query = firestore.collection(collection).limit(pageSize);
    
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    
    const snapshot = await query.get();
    
    if (snapshot.empty) {
      break;
    }
    
    allDocs.push(...snapshot.docs);
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    pageCount++;
  }
  
  expect(allDocs.length).toBe(totalItems);
  return allDocs;
};

// Утилиты для тестирования транзакций
export const testTransaction = async (
  firestore: any,
  transactionFn: (transaction: any) => Promise<void>
) => {
  return firestore.runTransaction(transactionFn);
};

// Утилиты для тестирования batch операций
export const testBatch = async (
  firestore: any,
  batchFn: (batch: any) => void
) => {
  const batch = firestore.batch();
  batchFn(batch);
  return batch.commit();
};

// Утилиты для тестирования offline/online режимов
export const testOfflineMode = async (
  testEnv: any,
  testFn: () => Promise<void>
) => {
  // Включаем offline режим
  await testEnv.withSecurityRulesDisabled(async (context: any) => {
    await context.firestore().enableNetwork();
    await testFn();
  });
};

// Утилиты для тестирования кэширования
export const testCacheBehavior = async (
  firestore: any,
  docPath: string,
  testFn: () => Promise<void>
) => {
  // Очищаем кэш
  await firestore.clearPersistence();
  
  // Выполняем тест
  await testFn();
  
  // Проверяем, что данные в кэше
  const cachedDoc = await firestore.doc(docPath).get({ source: 'cache' });
  expect(cachedDoc.exists).toBe(true);
};

// Утилиты для тестирования realtime listeners
export const testRealtimeListener = async (
  firestore: any,
  docPath: string,
  timeout: number = 5000
) => {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Listener timeout'));
    }, timeout);
    
    const unsubscribe = firestore.doc(docPath).onSnapshot(
      (snapshot: any) => {
        clearTimeout(timeoutId);
        unsubscribe();
        resolve(snapshot);
      },
      (error: any) => {
        clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      }
    );
  });
};

// Экспорт типов для тестов
export interface TestQueryConstraint {
  type: 'where' | 'orderBy' | 'limit';
  field?: string;
  operator?: any;
  value?: any;
  direction?: 'asc' | 'desc';
}

export interface TestPerformanceResult {
  result: any;
  duration: number;
}

// Глобальные типы для тестовой среды
declare global {
  var testEnv: any;
}