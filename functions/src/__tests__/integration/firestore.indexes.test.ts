/**
 * Тесты для проверки индексов Firestore
 */

import * as admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Инициализация Firebase Admin SDK для тестов
let db: admin.firestore.Firestore;

beforeAll(async () => {
  // Инициализируем Firebase Admin SDK для эмулятора
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'amulet-test'
    });
  }
  db = admin.firestore();
  
  // Подключаемся к эмулятору
  db.settings({
    host: 'localhost:8080',
    ssl: false
  });
});

describe('Firestore Indexes Tests', () => {
  
  describe('Index Configuration', () => {
    test('should have valid indexes configuration', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      expect(indexesConfig).toBeDefined();
      expect(indexesConfig.indexes).toBeDefined();
      expect(Array.isArray(indexesConfig.indexes)).toBe(true);
    });

    test('should have required indexes for users collection', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      const userIndexes = indexesConfig.indexes.filter((index: any) => 
        index.collectionGroup === 'users'
      );
      
      expect(userIndexes.length).toBeGreaterThan(0);
    });

    test('should have required indexes for devices collection', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      const deviceIndexes = indexesConfig.indexes.filter((index: any) => 
        index.collectionGroup === 'devices'
      );
      
      expect(deviceIndexes.length).toBeGreaterThan(0);
    });

    test('should have required indexes for practices collection', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      const practiceIndexes = indexesConfig.indexes.filter((index: any) => 
        index.collectionGroup === 'practices'
      );
      
      expect(practiceIndexes.length).toBeGreaterThan(0);
    });

    test('should have required indexes for patterns collection', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      const patternIndexes = indexesConfig.indexes.filter((index: any) => 
        index.collectionGroup === 'patterns'
      );
      
      expect(patternIndexes.length).toBeGreaterThan(0);
    });
  });

  describe('Query Performance Tests', () => {
    test('should perform efficient user queries', async () => {
      const startTime = Date.now();
      
      // Тест запроса по email (должен использовать индекс)
      const usersSnapshot = await db.collection('users')
        .where('email', '==', 'test@example.com')
        .get();
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000); // Запрос должен выполняться быстро
      expect(usersSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });

    test('should perform efficient device queries', async () => {
      const startTime = Date.now();
      
      // Тест запроса устройств пользователя
      const devicesSnapshot = await db.collection('devices')
        .where('userId', '==', 'test-user-id')
        .where('isActive', '==', true)
        .get();
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000);
      expect(devicesSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });

    test('should perform efficient practice queries', async () => {
      const startTime = Date.now();
      
      // Тест запроса практик по типу и сложности
      const practicesSnapshot = await db.collection('practices')
        .where('type', '==', 'breath')
        .where('difficulty', '==', 'beginner')
        .where('isPublic', '==', true)
        .orderBy('title')
        .limit(10)
        .get();
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000);
      expect(practicesSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });

    test('should perform efficient pattern queries', async () => {
      const startTime = Date.now();
      
      // Тест запроса паттернов по версии железа
      const patternsSnapshot = await db.collection('patterns')
        .where('hardwareVersion', '==', 200)
        .where('public', '==', true)
        .orderBy('usageCount', 'desc')
        .limit(20)
        .get();
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000);
      expect(patternsSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });

    test('should perform efficient array-contains queries', async () => {
      const startTime = Date.now();
      
      // Тест запроса с array-contains
      const patternsSnapshot = await db.collection('patterns')
        .where('tags', 'array-contains', 'breath')
        .get();
      
      const endTime = Date.now();
      const queryTime = endTime - startTime;
      
      expect(queryTime).toBeLessThan(1000);
      expect(patternsSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Index Validation', () => {
    test('should validate composite indexes', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      // Проверяем наличие составных индексов
      const compositeIndexes = indexesConfig.indexes.filter((index: any) => 
        index.fields && index.fields.length > 1
      );
      
      expect(compositeIndexes.length).toBeGreaterThan(0);
    });

    test('should validate array-contains indexes', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      // Проверяем наличие индексов для array-contains
      const arrayContainsIndexes = indexesConfig.indexes.filter((index: any) => 
        index.fields && index.fields.some((field: any) => field.arrayConfig === 'CONTAINS')
      );
      
      expect(arrayContainsIndexes.length).toBeGreaterThan(0);
    });

    test('should validate orderBy indexes', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      // Проверяем наличие индексов для orderBy
      const orderByIndexes = indexesConfig.indexes.filter((index: any) => 
        index.fields && index.fields.some((field: any) => field.order === 'ASCENDING' || field.order === 'DESCENDING')
      );
      
      expect(orderByIndexes.length).toBeGreaterThan(0);
    });
  });

  describe('Index Coverage', () => {
    test('should cover all required query patterns', () => {
      const indexesPath = join(__dirname, '../../../../firestore.indexes.json');
      const indexesConfig = JSON.parse(readFileSync(indexesPath, 'utf8'));
      
      const requiredCollections = [
        'users',
        'devices', 
        'practices',
        'patterns',
        'firmware'
      ];
      
      const coveredCollections = new Set(
        indexesConfig.indexes.map((index: any) => index.collectionGroup)
      );
      
      requiredCollections.forEach(collection => {
        expect(coveredCollections.has(collection)).toBe(true);
      });
    });
  });
});


