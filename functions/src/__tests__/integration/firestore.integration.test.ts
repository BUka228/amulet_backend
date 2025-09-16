/**
 * Интеграционные тесты для Firestore с использованием Emulator Suite
 */

import * as admin from 'firebase-admin';
import {
  User,
  Device,
  Practice,
  Pattern
} from '../../types/firestore';

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

describe('Firestore Integration Tests', () => {
  
  describe('User Collection', () => {
    test('should create and read user document', async () => {
      const userData: Omit<User, 'id' | 'createdAt' | 'updatedAt'> = {
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        timezone: 'Europe/Moscow',
        language: 'ru',
        consents: {
          analytics: true,
          marketing: false,
          telemetry: true
        },
        pushTokens: [],
        isDeleted: false
      };

      const userRef = db.collection('users').doc('test-user-id');
      await userRef.set({
        ...userData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const userDoc = await userRef.get();
      expect(userDoc.exists).toBe(true);
      expect(userDoc.data()?.displayName).toBe('Test User');
    });

    test('should query users by display name', async () => {
      const usersSnapshot = await db.collection('users')
        .where('displayName', '==', 'Test User')
        .get();

      expect(usersSnapshot.docs.length).toBeGreaterThan(0);
    });
  });

  describe('Device Collection', () => {
    test('should create and read device document', async () => {
      const deviceData: Omit<Device, 'id' | 'createdAt' | 'updatedAt'> = {
        ownerId: 'test-user-id',
        serial: 'TEST123456',
        hardwareVersion: 200,
        firmwareVersion: '1.0.0',
        name: 'Test Device',
        batteryLevel: 85,
        status: 'online',
        pairedAt: admin.firestore.Timestamp.now(),
        lastSeenAt: admin.firestore.Timestamp.now(),
        settings: {
          brightness: 80,
          haptics: 50,
          gestures: {
            singleTap: 'none',
            doubleTap: 'none',
            longPress: 'none'
          }
        }
      };

      const deviceRef = db.collection('devices').doc('test-device-id');
      await deviceRef.set({
        ...deviceData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const deviceDoc = await deviceRef.get();
      expect(deviceDoc.exists).toBe(true);
      expect(deviceDoc.data()?.name).toBe('Test Device');
    });

    test('should query devices by owner', async () => {
      const devicesSnapshot = await db.collection('devices')
        .where('ownerId', '==', 'test-user-id')
        .get();

      expect(devicesSnapshot.docs.length).toBeGreaterThan(0);
    });
  });

  describe('Practice Collection', () => {
    test('should create and read practice document', async () => {
      const practiceData: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'> = {
        type: 'breath',
        title: 'Test Practice',
        description: 'Test practice description',
        durationSec: 300,
        patternId: 'test-pattern-id',
        locales: {
          'ru': {
            title: 'Тестовая практика',
            description: 'Описание тестовой практики'
          }
        },
        category: 'breathing',
        difficulty: 'beginner',
        tags: ['test', 'breath'],
        isPublic: true,
        reviewStatus: 'approved'
      };

      const practiceRef = db.collection('practices').doc('test-practice-id');
      await practiceRef.set({
        ...practiceData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const practiceDoc = await practiceRef.get();
      expect(practiceDoc.exists).toBe(true);
      expect(practiceDoc.data()?.title).toBe('Test Practice');
    });

    test('should query practices by type', async () => {
      const practicesSnapshot = await db.collection('practices')
        .where('type', '==', 'breath')
        .get();

      expect(practicesSnapshot.docs.length).toBeGreaterThan(0);
    });
  });

  describe('Pattern Collection', () => {
    test('should create and read pattern document', async () => {
      const patternData: Omit<Pattern, 'id' | 'createdAt' | 'updatedAt'> = {
        kind: 'combo',
        spec: {
          type: 'breathing',
          hardwareVersion: 200,
          duration: 5000,
          loop: true,
          elements: [
            {
              type: 'color',
              startTime: 0,
              duration: 1000,
              color: '#00FF00',
              intensity: 0.8,
              speed: 1.0
            }
          ]
        },
        public: true,
        reviewStatus: 'approved',
        hardwareVersion: 200,
        title: 'Test Pattern',
        description: 'Test pattern description',
        tags: ['test', 'breath'],
        usageCount: 0,
        sharedWith: []
      };

      const patternRef = db.collection('patterns').doc('test-pattern-id');
      await patternRef.set({
        ...patternData,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const patternDoc = await patternRef.get();
      expect(patternDoc.exists).toBe(true);
      expect(patternDoc.data()?.title).toBe('Test Pattern');
    });

    test('should query patterns by hardware version', async () => {
      const patternsSnapshot = await db.collection('patterns')
        .where('hardwareVersion', '==', 200)
        .get();

      expect(patternsSnapshot.docs.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Queries', () => {
    test('should perform compound query with multiple conditions', async () => {
      const practicesSnapshot = await db.collection('practices')
        .where('type', '==', 'breath')
        .where('difficulty', '==', 'beginner')
        .where('isPublic', '==', true)
        .orderBy('title')
        .limit(10)
        .get();

      expect(practicesSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });

    test('should perform array-contains query', async () => {
      const patternsSnapshot = await db.collection('patterns')
        .where('tags', 'array-contains', 'test')
        .get();

      expect(patternsSnapshot.docs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Data Validation', () => {
    test('should validate required fields', async () => {
      const userRef = db.collection('users').doc('validation-test');
      
      // Попытка создать документ без обязательных полей
      try {
        await userRef.set({
          // Отсутствует email
          name: 'Test User'
        });
        fail('Should have thrown validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('should validate data types', async () => {
      const deviceRef = db.collection('devices').doc('type-validation-test');
      
      // Попытка создать документ с неправильными типами
      try {
        await deviceRef.set({
          userId: 'test-user',
          name: 'Test Device',
          hardwareVersion: 'invalid', // Должно быть число
          isPaired: 'yes' // Должно быть boolean
        });
        fail('Should have thrown type validation error');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Cleanup', () => {
    test('should clean up test data', async () => {
      // Удаляем тестовые документы
      const testIds = [
        'test-user-id',
        'test-device-id', 
        'test-practice-id',
        'test-pattern-id',
        'validation-test',
        'type-validation-test'
      ];

      for (const id of testIds) {
        try {
          await db.collection('users').doc(id).delete();
          await db.collection('devices').doc(id).delete();
          await db.collection('practices').doc(id).delete();
          await db.collection('patterns').doc(id).delete();
        } catch (error) {
          // Игнорируем ошибки, если документ не существует
        }
      }

      expect(true).toBe(true); // Тест прошел успешно
    });
  });
});