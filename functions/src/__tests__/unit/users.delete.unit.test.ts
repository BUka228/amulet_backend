import request from 'supertest';
import express from 'express';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import usersRouter from '../../api/users';
import { db } from '../../core/firebase';

// Мокаем Pub/Sub, чтобы не требовался реальный Pub/Sub/эмулятор
jest.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: jest.fn().mockImplementation(() => ({
      topic: jest.fn().mockReturnValue({
        publishMessage: jest.fn().mockResolvedValue('mocked-message-id')
      })
    }))
  };
});

describe('POST /v1/users.me/delete', () => {
  const app = express();
  applyBaseMiddlewares(app);
  app.use(i18nMiddleware());
  // тестовый миддлварь для auth из api/test.ts
  app.use((req, _res, next) => {
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
  const headers = { 'X-Test-Uid': 'u_delete_unit_1' } as Record<string, string>;

  beforeEach(async () => {
    await db.collection('users').doc(headers['X-Test-Uid']).set({
      id: headers['X-Test-Uid'],
      displayName: 'User For Deletion',
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      pushTokens: []
    });
  });

  afterEach(async () => {
    await db.collection('users').doc(headers['X-Test-Uid']).delete();
  });

  it('returns 202, creates deletionJobs doc and marks user as deleting (en)', async () => {
    const res = await agent.post('/v1/users.me/delete').set(headers).send({});
    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe('string');

    const jobSnap = await db.collection('deletionJobs').doc(res.body.jobId).get();
    expect(jobSnap.exists).toBe(true);

    const userSnap = await db.collection('users').doc(headers['X-Test-Uid']).get();
    expect(userSnap.data()?.isDeleting).toBe(true);
    expect(userSnap.data()?.deletionJobId).toBe(res.body.jobId);
  });

  it('localizes message by Accept-Language header (ru)', async () => {
    const res = await agent
      .post('/v1/users.me/delete')
      .set(headers)
      .set('Accept-Language', 'ru-RU')
      .send({});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
    // сообщение должно быть на русском (простая проверка подстроки)
    expect(res.body.message.toLowerCase()).toContain('запрос на удаление');
  });
});


