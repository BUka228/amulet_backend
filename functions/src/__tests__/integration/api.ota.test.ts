/**
 * Интеграционные тесты для OTA API
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import request from 'supertest';
import { app } from '../../api/test';

let testEnv: RulesTestEnvironment;
let db: FirebaseFirestore.Firestore;

beforeAll(async () => {
  // Инициализация тестовой среды
  testEnv = await initializeTestEnvironment({
    projectId: 'amulet-test',
    firestore: {
      rules: `
        rules_version = '2';
        service cloud.firestore {
          match /databases/{database}/documents {
            // Разрешаем чтение прошивок всем аутентифицированным пользователям
            match /firmware/{firmwareId} {
              allow read: if request.auth != null;
            }
            
            // Разрешаем создание отчётов о прошивке владельцам устройств
            match /firmwareReports/{reportId} {
              allow create: if request.auth != null 
                && request.auth.uid == resource.data.ownerId;
            }
            
            // Разрешаем чтение и обновление устройств владельцам
            match /devices/{deviceId} {
              allow read, update: if request.auth != null 
                && request.auth.uid == resource.data.ownerId;
            }
          }
        }
      `,
      host: 'localhost',
      port: 8080,
    },
  });

  // Используем существующее подключение к Firestore
  db = getFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  // Очистка данных перед каждым тестом
  await testEnv.clearFirestore();
  
  // Создаём тестовые данные прошивок напрямую
  const firmwareData = [
    {
      version: '1.1.0',
      hardwareVersion: 100,
      downloadUrl: 'https://storage.googleapis.com/amulet-firmware/v1.1.0/firmware.bin',
      checksum: 'def4567890123456def4567890123456def45678',
      size: 1124000,
      releaseNotes: 'Обновление с исправлениями ошибок',
      locales: {
        'ru': { releaseNotes: 'Обновление с исправлениями ошибок' }
      },
      isActive: true,
      minFirmwareVersion: '1.0.0',
      maxFirmwareVersion: '1.1.0',
      rolloutPercentage: 100,
      publishedAt: Timestamp.now(),
      publishedBy: 'system',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    },
    {
      version: '2.2.0',
      hardwareVersion: 200,
      downloadUrl: 'https://storage.googleapis.com/amulet-firmware/v2.2.0/firmware.bin',
      checksum: '9876543210fedcba9876543210fedcba98765432',
      size: 2248000,
      releaseNotes: 'Экспериментальная версия с новыми функциями',
      locales: {
        'ru': { releaseNotes: 'Экспериментальная версия с новыми функциями' }
      },
      isActive: true,
      minFirmwareVersion: '2.1.0',
      maxFirmwareVersion: '2.2.0',
      rolloutPercentage: 10,
      publishedAt: Timestamp.now(),
      publishedBy: 'system',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    }
  ];

  for (const fw of firmwareData) {
    await db.collection('firmware').add(fw);
  }
});

describe('GET /v1/ota/firmware/latest', () => {
  it('должен возвращать последнюю прошивку для v1.0', async () => {
    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 100, currentFirmware: '1.0.0' })
      .set('X-Test-Uid', 'test-user-1')
      .expect(200);

    expect(response.body).toMatchObject({
      version: '1.1.0',
      notes: 'Обновление с исправлениями ошибок',
      url: expect.stringContaining('v1.1.0'),
      checksum: expect.stringMatching(/^[a-f0-9]{40}$/),
      size: expect.any(Number),
      updateAvailable: true
    });
  });

  it('должен возвращать последнюю прошивку для v2.0', async () => {
    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 200, currentFirmware: '2.1.0' })
      .set('X-Test-Uid', 'test-user-1');

    // Может вернуть либо 200 (если попал в rollout), либо 204 (если не попал)
    expect([200, 204]).toContain(response.status);
    
    if (response.status === 200) {
      expect(response.body).toMatchObject({
        version: '2.2.0',
        notes: expect.stringContaining('Экспериментальная версия'),
        url: expect.stringContaining('v2.2.0'),
        checksum: expect.stringMatching(/^[a-f0-9]{40}$/),
        size: expect.any(Number),
        updateAvailable: true
      });
    } else {
      expect(response.body).toEqual({});
    }
  });

  it('должен возвращать 204 No Content для самой новой версии', async () => {
    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 100, currentFirmware: '1.1.0' })
      .set('X-Test-Uid', 'test-user-1')
      .expect(204);

    expect(response.body).toEqual({});
  });

  it('должен возвращать 404 если нет прошивки для версии железа', async () => {
    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 300, currentFirmware: '1.0.0' })
      .set('X-Test-Uid', 'test-user-1')
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'not_found',
      message: 'No firmware available for this hardware version'
    });
  });

  it('должен возвращать 400 при отсутствии параметров', async () => {
    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .set('X-Test-Uid', 'test-user-1')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('Missing required parameters')
    });
  });

  it('должен возвращать 401 без аутентификации', async () => {
    await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 100, currentFirmware: '1.0.0' })
      .expect(401);
  });

  it('должен учитывать rollout percentage', async () => {
    // Создаём прошивку с 0% rollout
    await db.collection('firmware').add({
      version: '1.2.0',
      hardwareVersion: 100,
      downloadUrl: 'https://storage.googleapis.com/amulet-firmware/v1.2.0/firmware.bin',
      checksum: 'test12345678901234567890123456789012345678',
      size: 1200000,
      releaseNotes: 'Test firmware with 0% rollout',
      locales: {
        'ru': { releaseNotes: 'Тестовая прошивка с 0% rollout' }
      },
      isActive: true,
      minFirmwareVersion: '1.1.0',
      maxFirmwareVersion: '1.2.0',
      rolloutPercentage: 0,
      publishedAt: Timestamp.now(),
      publishedBy: 'system',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    const response = await request(app)
      .get('/v1/ota/firmware/latest')
      .query({ hardware: 100, currentFirmware: '1.1.0' })
      .set('X-Test-Uid', 'test-user-1')
      .expect(204);

    expect(response.body).toEqual({});
  });
});

describe('POST /v1/devices/:id/firmware/report', () => {
  let deviceId: string;

  beforeEach(async () => {
    // Создаём тестовое устройство
    const deviceRef = await db.collection('devices').add({
      ownerId: 'test-user-1',
      serial: 'TEST-001',
      hardwareVersion: 200,
      firmwareVersion: '2.0.0',
      name: 'Test Device',
      batteryLevel: 100,
      status: 'online',
      pairedAt: Timestamp.now(),
      settings: { brightness: 50, haptics: 50, gestures: {} },
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    deviceId = deviceRef.id;
  });

  it('должен принимать успешный отчёт об установке', async () => {
    const response = await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true
    });

    // Проверяем, что версия прошивки обновилась
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    expect(deviceDoc.data()?.firmwareVersion).toBe('2.1.0');
  });

  it('должен принимать отчёт об ошибке установки', async () => {
    const response = await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'failed',
        errorCode: 'FLASH_ERROR',
        errorMessage: 'Failed to write to flash memory'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true
    });

    // Проверяем, что версия прошивки НЕ обновилась
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    expect(deviceDoc.data()?.firmwareVersion).toBe('2.0.0');
  });

  it('должен принимать отчёт об отмене установки', async () => {
    const response = await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'cancelled'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true
    });
  });

  it('должен возвращать 404 для несуществующего устройства', async () => {
    const response = await request(app)
      .post('/v1/devices/nonexistent/firmware/report')
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(404);

    expect(response.body).toMatchObject({
      code: 'not_found',
      message: 'Device not found'
    });
  });

  it('должен возвращать 403 для чужого устройства', async () => {
    const response = await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .set('X-Test-Uid', 'test-user-2')
      .expect(403);

    expect(response.body).toMatchObject({
      code: 'permission_denied',
      message: 'Access denied'
    });
  });

  it('должен возвращать 400 при неверных данных', async () => {
    const response = await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'invalid_status'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'invalid_argument',
      message: expect.stringContaining('Invalid option')
    });
  });

  it('должен возвращать 401 без аутентификации', async () => {
    await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .expect(401);
  });

  it('должен создавать запись в firmwareReports', async () => {
    await request(app)
      .post(`/v1/devices/${deviceId}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(200);

    // Проверяем, что отчёт создался
    const reportsSnap = await db.collection('firmwareReports')
      .where('deviceId', '==', deviceId)
      .where('ownerId', '==', 'test-user-1')
      .get();

    expect(reportsSnap.size).toBe(1);
    
    const report = reportsSnap.docs[0].data();
    expect(report).toMatchObject({
      deviceId,
      ownerId: 'test-user-1',
      hardwareVersion: 200,
      fromVersion: '2.0.0',
      toVersion: '2.1.0',
      status: 'success',
      errorCode: null,
      errorMessage: null
    });
  });

  it('должен возвращать 412 если у устройства отсутствует hardwareVersion', async () => {
    // Создаём устройство без hardwareVersion
    const deviceWithoutHwRef = await db.collection('devices').add({
      ownerId: 'test-user-1',
      serial: 'TEST-NO-HW',
      firmwareVersion: '2.0.0',
      name: 'Test Device No HW',
      batteryLevel: 100,
      status: 'online',
      pairedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    const response = await request(app)
      .post(`/v1/devices/${deviceWithoutHwRef.id}/firmware/report`)
      .send({
        fromVersion: '2.0.0',
        toVersion: '2.1.0',
        status: 'success'
      })
      .set('X-Test-Uid', 'test-user-1')
      .expect(412);

    expect(response.body).toMatchObject({
      code: 'failed_precondition',
      message: 'Device hardware version not found'
    });
  });
});
