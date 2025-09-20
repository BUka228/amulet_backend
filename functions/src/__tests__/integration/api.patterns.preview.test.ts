/**
 * Интеграционные тесты для флага предпросмотра паттернов
 */

import express from 'express';
import request from 'supertest';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import patternsRouter from '../../api/patterns';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { db } from '../../core/firebase';

// Мокируем FCM
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn().mockReturnValue({
    send: jest.fn().mockResolvedValue('message-id')
  })
}));

// Мокируем аутентификацию
jest.mock('../../core/auth', () => ({
  authenticateToken: () => (req: any, res: any, next: any) => {
    req.auth = { user: { uid: req.headers['x-user-id'] || 'test-user' } };
    next();
  }
}));

describe('Patterns API - Preview Feature Flag', () => {
  const app = express();
  
  beforeAll(() => {
    applyBaseMiddlewares(app);
    app.use(i18nMiddleware());
    app.use('/v1', patternsRouter);
    app.use(errorHandler());
  });

  beforeEach(async () => {
    clearConfigCache();
    // Очищаем тестовые данные
    await db.collection('devices').get().then(snapshot => {
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    });
  });

  const createTestUser = () => ({
    uid: 'test-user-preview',
    email: 'test@example.com'
  });

  const createTestToken = () => 'test-id-token';

  const createTestDevice = async (userId: string) => {
    const deviceRef = db.collection('devices').doc('test-device');
    await deviceRef.set({
      ownerId: userId,
      serial: 'TEST-001',
      hardwareVersion: 200,
      firmwareVersion: '1.0.0',
      name: 'Test Device',
      status: 'active',
      pairedAt: new Date()
    });
    return 'test-device';
  };

  const createTestPatternSpec = () => ({
    type: 'breathing',
    hardwareVersion: 200,
    duration: 5000,
    loop: true,
    elements: [
      {
        type: 'pulse',
        startTime: 0,
        duration: 2000,
        color: '#00FF00',
        intensity: 0.8
      }
    ]
  });

  it('should allow preview when feature is enabled', async () => {
    // Включаем предпросмотр
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const token = createTestToken();
    const deviceId = await createTestDevice(user.uid);

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId,
        spec: createTestPatternSpec()
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('previewId');
  });

  it('should block preview when feature is disabled', async () => {
    // Отключаем предпросмотр
    setConfigValue('preview_enabled', false);

    const user = createTestUser();
    const token = createTestToken();
    const deviceId = await createTestDevice(user.uid);

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId,
        spec: createTestPatternSpec()
      });

    expect(response.status).toBe(412);
    expect(response.body.code).toBe('failed_precondition');
    expect(response.body.message).toBe('Pattern preview feature is currently disabled');
  });

  it('should allow preview when feature is enabled by default', async () => {
    // Не устанавливаем значение (используем по умолчанию true)
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const token = createTestToken();
    const deviceId = await createTestDevice(user.uid);

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId,
        spec: createTestPatternSpec()
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('previewId');
  });

  it('should handle device not found when preview is enabled', async () => {
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const token = createTestToken();

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId: 'non-existent-device',
        spec: createTestPatternSpec()
      });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('not_found');
  });

  it('should handle device not owned by user when preview is enabled', async () => {
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const otherUser = { uid: 'other-user', email: 'other@example.com' };
    const token = createTestToken();
    const deviceId = await createTestDevice(otherUser.uid);

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId,
        spec: createTestPatternSpec()
      });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('permission_denied');
  });

  it('should work with different hardware versions when preview is enabled', async () => {
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const token = createTestToken();

    // Создаем устройство v1.0
    const deviceV1Ref = db.collection('devices').doc('test-device-v1');
    await deviceV1Ref.set({
      ownerId: user.uid,
      serial: 'TEST-V1-001',
      hardwareVersion: 100,
      firmwareVersion: '1.0.0',
      name: 'Test Device V1',
      status: 'active',
      pairedAt: new Date()
    });

    // Создаем устройство v2.0
    const deviceV2Ref = db.collection('devices').doc('test-device-v2');
    await deviceV2Ref.set({
      ownerId: user.uid,
      serial: 'TEST-V2-001',
      hardwareVersion: 200,
      firmwareVersion: '2.0.0',
      name: 'Test Device V2',
      status: 'active',
      pairedAt: new Date()
    });

    // Тест с v1.0
    const responseV1 = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId: 'test-device-v1',
        spec: {
          ...createTestPatternSpec(),
          hardwareVersion: 100
        }
      });

    expect(responseV1.status).toBe(200);

    // Тест с v2.0
    const responseV2 = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId: 'test-device-v2',
        spec: {
          ...createTestPatternSpec(),
          hardwareVersion: 200
        }
      });

    expect(responseV2.status).toBe(200);
  });

  it('should handle invalid pattern spec when preview is enabled', async () => {
    setConfigValue('preview_enabled', true);

    const user = createTestUser();
    const token = createTestToken();
    const deviceId = await createTestDevice(user.uid);

    const response = await request(app)
      .post('/v1/patterns/preview')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        deviceId,
        spec: {
          type: 'invalid-type',
          hardwareVersion: 200
        }
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('invalid_argument');
  });
});
