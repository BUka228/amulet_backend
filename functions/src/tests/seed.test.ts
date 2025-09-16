/**
 * Тесты для скриптов сидов (начальных данных)
 */

import * as admin from 'firebase-admin';

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

describe('Seed Script Tests', () => {
  
  describe('Practices Seeding', () => {
    test('should create practice documents', async () => {
      const practicesSnapshot = await db.collection('practices').get();
      
      expect(practicesSnapshot.docs.length).toBeGreaterThan(0);
      
      // Проверяем структуру первого документа
      const firstPractice = practicesSnapshot.docs[0].data();
      expect(firstPractice).toHaveProperty('type');
      expect(firstPractice).toHaveProperty('title');
      expect(firstPractice).toHaveProperty('description');
      expect(firstPractice).toHaveProperty('durationSec');
    });

    test('should have different practice types', async () => {
      const practicesSnapshot = await db.collection('practices').get();
      const practices = practicesSnapshot.docs.map(doc => doc.data());
      
      const types = new Set(practices.map(p => p.type));
      expect(types.size).toBeGreaterThan(1);
      expect(types.has('breath')).toBe(true);
      expect(types.has('meditation')).toBe(true);
    });

    test('should have localized content', async () => {
      const practicesSnapshot = await db.collection('practices').get();
      const practices = practicesSnapshot.docs.map(doc => doc.data());
      
      const practiceWithLocales = practices.find(p => p.locales);
      expect(practiceWithLocales).toBeDefined();
      if (practiceWithLocales) {
        expect(practiceWithLocales.locales).toHaveProperty('ru');
        expect(practiceWithLocales.locales).toHaveProperty('en');
      }
    });

    test('should have valid difficulty levels', async () => {
      const practicesSnapshot = await db.collection('practices').get();
      const practices = practicesSnapshot.docs.map(doc => doc.data());
      
      const difficulties = practices.map(p => p.difficulty);
      const validDifficulties = ['beginner', 'intermediate', 'advanced'];
      
      difficulties.forEach(difficulty => {
        expect(validDifficulties).toContain(difficulty);
      });
    });
  });

  describe('Patterns Seeding', () => {
    test('should create pattern documents', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      
      expect(patternsSnapshot.docs.length).toBeGreaterThan(0);
      
      // Проверяем структуру первого документа
      const firstPattern = patternsSnapshot.docs[0].data();
      expect(firstPattern).toHaveProperty('kind');
      expect(firstPattern).toHaveProperty('spec');
      expect(firstPattern).toHaveProperty('hardwareVersion');
      expect(firstPattern).toHaveProperty('title');
    });

    test('should have patterns for different hardware versions', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      const hardwareVersions = new Set(patterns.map(p => p.hardwareVersion));
      expect(hardwareVersions.has(100)).toBe(true); // Amulet v1.0
      expect(hardwareVersions.has(200)).toBe(true); // Amulet v2.0
    });

    test('should have different pattern kinds', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      const kinds = new Set(patterns.map(p => p.kind));
      expect(kinds.has('light')).toBe(true);
      expect(kinds.has('haptic')).toBe(true);
      expect(kinds.has('combo')).toBe(true);
    });

    test('should have valid pattern specifications', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      patterns.forEach(pattern => {
        expect(pattern.spec).toHaveProperty('type');
        expect(pattern.spec).toHaveProperty('hardwareVersion');
        expect(pattern.spec).toHaveProperty('duration');
        expect(pattern.spec).toHaveProperty('elements');
        expect(Array.isArray(pattern.spec.elements)).toBe(true);
      });
    });

    test('should have valid pattern elements', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      patterns.forEach(pattern => {
        pattern.spec.elements.forEach((element: any) => {
          expect(element).toHaveProperty('type');
          expect(element).toHaveProperty('startTime');
          expect(element).toHaveProperty('duration');
          expect(element).toHaveProperty('params');
        });
      });
    });
  });

  describe('Firmware Seeding', () => {
    test('should create firmware documents', async () => {
      const firmwareSnapshot = await db.collection('firmware').get();
      
      expect(firmwareSnapshot.docs.length).toBeGreaterThan(0);
      
      // Проверяем структуру первого документа
      const firstFirmware = firmwareSnapshot.docs[0].data();
      expect(firstFirmware).toHaveProperty('version');
      expect(firstFirmware).toHaveProperty('hardwareVersion');
      expect(firstFirmware).toHaveProperty('downloadUrl');
      expect(firstFirmware).toHaveProperty('checksum');
    });

    test('should have firmware for different hardware versions', async () => {
      const firmwareSnapshot = await db.collection('firmware').get();
      const firmware = firmwareSnapshot.docs.map(doc => doc.data());
      
      const hardwareVersions = new Set(firmware.map(f => f.hardwareVersion));
      expect(hardwareVersions.has(100)).toBe(true);
      expect(hardwareVersions.has(200)).toBe(true);
    });

    test('should have valid firmware versions', async () => {
      const firmwareSnapshot = await db.collection('firmware').get();
      const firmware = firmwareSnapshot.docs.map(doc => doc.data());
      
      firmware.forEach(f => {
        expect(f.version).toMatch(/^\d+\.\d+\.\d+$/); // Semantic versioning
        expect(f.downloadUrl).toMatch(/^https?:\/\//); // Valid URL
        expect(f.checksum).toMatch(/^[a-f0-9]+$/i); // Hex checksum
        expect(typeof f.size).toBe('number');
        expect(f.size).toBeGreaterThan(0);
      });
    });

    test('should have localized release notes', async () => {
      const firmwareSnapshot = await db.collection('firmware').get();
      const firmware = firmwareSnapshot.docs.map(doc => doc.data());
      
      const firmwareWithLocales = firmware.find(f => f.locales);
      expect(firmwareWithLocales).toBeDefined();
      if (firmwareWithLocales) {
        expect(firmwareWithLocales.locales).toHaveProperty('ru');
        expect(firmwareWithLocales.locales).toHaveProperty('en');
      }
    });
  });

  describe('Data Consistency', () => {
    test('should have consistent practice-pattern relationships', async () => {
      const practicesSnapshot = await db.collection('practices').get();
      const patternsSnapshot = await db.collection('patterns').get();
      
      const practices = practicesSnapshot.docs.map(doc => doc.data());
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      const patternIds = new Set(patterns.map(p => p.id));
      
      practices.forEach(practice => {
        if (practice.patternId) {
          expect(patternIds.has(practice.patternId)).toBe(true);
        }
      });
    });

    test('should have consistent hardware versions', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const firmwareSnapshot = await db.collection('firmware').get();
      
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      const firmware = firmwareSnapshot.docs.map(doc => doc.data());
      
      const patternHardwareVersions = new Set(patterns.map(p => p.hardwareVersion));
      const firmwareHardwareVersions = new Set(firmware.map(f => f.hardwareVersion));
      
      // Проверяем, что все версии железа покрыты
      expect(patternHardwareVersions.size).toBeGreaterThan(0);
      expect(firmwareHardwareVersions.size).toBeGreaterThan(0);
    });

    test('should have valid timestamps', async () => {
      const collections = ['practices', 'patterns', 'firmware'];
      
      for (const collectionName of collections) {
        const snapshot = await db.collection(collectionName).get();
        const docs = snapshot.docs.map(doc => doc.data());
        
        docs.forEach(doc => {
          expect(doc.createdAt).toBeDefined();
          expect(doc.updatedAt).toBeDefined();
        });
      }
    });
  });

  describe('Data Quality', () => {
    test('should have non-empty titles and descriptions', async () => {
      const collections = ['practices', 'patterns'];
      
      for (const collectionName of collections) {
        const snapshot = await db.collection(collectionName).get();
        const docs = snapshot.docs.map(doc => doc.data());
        
        docs.forEach(doc => {
          expect(doc.title).toBeTruthy();
          expect(doc.description).toBeTruthy();
          expect(doc.title.length).toBeGreaterThan(0);
          expect(doc.description.length).toBeGreaterThan(0);
        });
      }
    });

    test('should have valid tags', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      patterns.forEach(pattern => {
        expect(Array.isArray(pattern.tags)).toBe(true);
        expect(pattern.tags.length).toBeGreaterThan(0);
        
        pattern.tags.forEach((tag: any) => {
          expect(typeof tag).toBe('string');
          expect(tag.length).toBeGreaterThan(0);
        });
      });
    });

    test('should have valid usage counts', async () => {
      const patternsSnapshot = await db.collection('patterns').get();
      const patterns = patternsSnapshot.docs.map(doc => doc.data());
      
      patterns.forEach(pattern => {
        expect(typeof pattern.usageCount).toBe('number');
        expect(pattern.usageCount).toBeGreaterThanOrEqual(0);
      });
    });
  });
});