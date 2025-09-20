/**
 * Интеграционные тесты для кулдауна объятий
 */

import express from 'express';
import request from 'supertest';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import hugsRouter from '../../api/hugs';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { db } from '../../core/firebase';
import { FieldValue } from 'firebase-admin/firestore';

// Мокируем FCM
jest.mock('../../core/pushNotifications', () => ({
  sendNotification: jest.fn().mockResolvedValue({ delivered: true })
}));

// Мокируем аутентификацию
jest.mock('../../core/auth', () => ({
  authenticateToken: () => (req: any, res: any, next: any) => {
    req.auth = { user: { uid: req.headers['x-user-id'] || 'test-user' } };
    next();
  }
}));

describe('Hugs API - Cooldown Integration', () => {
  const app = express();
  
  beforeAll(() => {
    applyBaseMiddlewares(app);
    app.use(i18nMiddleware());
    app.use('/v1', hugsRouter);
    app.use(errorHandler());
  });

  beforeEach(async () => {
    clearConfigCache();
    // Очищаем тестовые данные
    await db.collection('hugs').get().then(snapshot => {
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      return batch.commit();
    });
  });

  const createTestUser = () => ({
    uid: 'test-user-cooldown',
    email: 'test@example.com'
  });

  const createTestToken = () => 'test-id-token';

  it('should allow first hug without cooldown', async () => {
    // Устанавливаем кулдаун 60 секунд
    setConfigValue('hugs_cooldown_ms', 60000);

    const user = createTestUser();
    const token = createTestToken();

    const response = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('hugId');
    expect(response.body).toHaveProperty('delivered');
  });

  it('should block second hug within cooldown period', async () => {
    // Устанавливаем кулдаун 60 секунд
    setConfigValue('hugs_cooldown_ms', 60000);

    const user = createTestUser();
    const token = createTestToken();

    // Отправляем первое объятие
    const firstResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-1',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(firstResponse.status).toBe(200);

    // Сразу пытаемся отправить второе объятие
    const secondResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-2',
        emotion: { color: '#00FF00', patternId: 'test-pattern-2' }
      });

    expect(secondResponse.status).toBe(429);
    expect(secondResponse.body.code).toBe('resource_exhausted');
    expect(secondResponse.body.message).toContain('Please wait');
    expect(secondResponse.body.details).toHaveProperty('retryAfter');
  });

  it('should allow hug after cooldown period', async () => {
    // Устанавливаем очень короткий кулдаун (100ms)
    setConfigValue('hugs_cooldown_ms', 100);

    const user = createTestUser();
    const token = createTestToken();

    // Отправляем первое объятие
    const firstResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-1',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(firstResponse.status).toBe(200);

    // Ждем окончания кулдауна
    await new Promise(resolve => setTimeout(resolve, 150));

    // Отправляем второе объятие
    const secondResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-2',
        emotion: { color: '#00FF00', patternId: 'test-pattern-2' }
      });

    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toHaveProperty('hugId');
  });

  it('should use different cooldown values from Remote Config', async () => {
    const user = createTestUser();
    const token = createTestToken();

    // Тест с кулдауном 30 секунд
    setConfigValue('hugs_cooldown_ms', 30000);

    const response1 = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-1',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(response1.status).toBe(200);

    const response2 = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        toUserId: 'recipient-user-2',
        emotion: { color: '#00FF00', patternId: 'test-pattern-2' }
      });

    expect(response2.status).toBe(429);
    expect(response2.body.details.retryAfter).toBeGreaterThan(25); // Около 30 секунд
  });

  it('should handle cooldown with pairs', async () => {
    setConfigValue('hugs_cooldown_ms', 60000);

    const user = createTestUser();
    const token = createTestToken();

    // Создаем тестовую пару
    const pairRef = db.collection('pairs').doc('test-pair');
    await pairRef.set({
      memberIds: [user.uid, 'partner-user'],
      status: 'active',
      createdAt: FieldValue.serverTimestamp()
    });

    // Отправляем первое объятие через пару
    const firstResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        pairId: 'test-pair',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(firstResponse.status).toBe(200);

    // Пытаемся отправить второе объятие через пару
    const secondResponse = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user.uid)
      .send({
        pairId: 'test-pair',
        emotion: { color: '#00FF00', patternId: 'test-pattern-2' }
      });

    expect(secondResponse.status).toBe(429);
  });

  it('should not apply cooldown to different users', async () => {
    setConfigValue('hugs_cooldown_ms', 60000);

    const user1 = { uid: 'user1', email: 'user1@example.com' };
    const user2 = { uid: 'user2', email: 'user2@example.com' };
    const token = createTestToken();

    // User1 отправляет объятие
    const response1 = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user1.uid)
      .send({
        toUserId: 'recipient-user',
        emotion: { color: '#FF0000', patternId: 'test-pattern' }
      });

    expect(response1.status).toBe(200);

    // User2 сразу отправляет объятие (не должно быть кулдауна)
    const response2 = await request(app)
      .post('/v1/hugs.send')
      .set('Authorization', `Bearer ${token}`)
      .set('X-User-Id', user2.uid)
      .send({
        toUserId: 'recipient-user',
        emotion: { color: '#00FF00', patternId: 'test-pattern-2' }
      });

    expect(response2.status).toBe(200);
  });
});
