import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import usersRouter from '../../api/users';

// Эмулируем Pub/Sub через мок, чтобы интеграционный тест не требовал реальные креды
jest.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: jest.fn().mockImplementation(() => ({
      topic: jest.fn().mockReturnValue({
        // Избегаем жесткой типизации mockResolvedValue<never>
        publishMessage: async () => 'mocked-message-id'
      })
    }))
  };
});

describe('Users API (/v1/users.me*)', () => {
  const app = express();
  applyBaseMiddlewares(app);
  app.use(i18nMiddleware());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const testUid = (req.headers['x-test-uid'] as string) || '';
    if (!req.auth && testUid) {
      (req as unknown as { auth: unknown }).auth = {
        user: { uid: testUid, customClaims: {} },
        token: 'test-token',
        isAuthenticated: true
      };
    }
    next();
  });
  app.use('/v1', usersRouter);
  app.use(errorHandler());
  const agent = request(app);
  const headers = { 'X-Test-Uid': 'u_integration_1' } as Record<string, string>;

  beforeAll(() => {
    // Убедимся, что приложение Firebase Admin инициализировано
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'amulet-test' });
    }
  });

  beforeEach(async () => {
    // Firestore очищается глобальным setup между тестами → создаём профиль заново
    await agent
      .post('/v1/users.me.init')
      .set(headers)
      .send({ displayName: 'Alice', timezone: 'Europe/Moscow', language: 'ru-RU', consents: { marketing: false } })
      .expect(200);
  });

  it('POST /v1/users.me.init creates or updates profile', async () => {
    const res = await agent
      .post('/v1/users.me.init')
      .set(headers)
      .send({ displayName: 'Alice', timezone: 'Europe/Moscow', language: 'ru-RU', consents: { marketing: false } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.id).toBe('u_integration_1');
    expect(res.body.user.displayName).toBe('Alice');
  });

  it('GET /v1/users.me returns current profile', async () => {
    // Ensure profile exists for this test
    await agent
      .post('/v1/users.me.init')
      .set(headers)
      .send({ displayName: 'Alice', timezone: 'Europe/Moscow', language: 'ru-RU', consents: { marketing: false } })
      .expect(200);
    const res = await agent.get('/v1/users.me').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.id).toBe('u_integration_1');
  });

  it('PATCH /v1/users.me updates profile fields', async () => {
    // Ensure profile exists for this test
    await agent
      .post('/v1/users.me.init')
      .set(headers)
      .send({ displayName: 'Alice', timezone: 'Europe/Moscow', language: 'ru-RU', consents: { marketing: false } })
      .expect(200);
    const res = await agent
      .patch('/v1/users.me')
      .set(headers)
      .send({ displayName: 'Alice Updated', avatarUrl: 'https://example.com/a.png' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Alice Updated');
    expect(res.body.user.avatarUrl).toBe('https://example.com/a.png');
  });

  it('POST /v1/users.me/delete returns 202 with jobId', async () => {
    const res = await agent.post('/v1/users.me/delete').set(headers).send({});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(typeof res.body.jobId).toBe('string');
  });

  it('Validates unexpected fields (400 invalid_argument)', async () => {
    const res = await agent.post('/v1/users.me.init').set(headers).send({ unexpected: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_argument');
  });
});




