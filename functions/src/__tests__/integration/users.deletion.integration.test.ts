import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { db } from '../../core/firebase';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import usersRouter from '../../api/users';

// Эмулируем Pub/Sub через мок, чтобы интеграционный тест не требовал реальный эмуль
jest.mock('@google-cloud/pubsub', () => {
  return {
    PubSub: jest.fn().mockImplementation(() => ({
      topic: jest.fn().mockReturnValue({
        publishMessage: jest.fn().mockResolvedValue('mocked-message-id')
      })
    }))
  };
});

describe('Integration: /v1/users.me/delete', () => {
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
  const headers = { 'X-Test-Uid': 'u_delete_integration_1' } as Record<string, string>;

  beforeEach(async () => {
    // Тестовая среда очищает Firestore между тестами, поэтому создаём юзера перед каждым тестом
    await db.collection('users').doc(headers['X-Test-Uid']).set({
      id: headers['X-Test-Uid'],
      displayName: 'User For Deletion INT',
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      pushTokens: []
    });
  });

  afterEach(async () => {
    await db.collection('users').doc(headers['X-Test-Uid']).delete();
  });

  it('should create deletion job doc and set isDeleting flag', async () => {
    const res = await agent.post('/v1/users.me/delete').set(headers).send({});
    expect(res.status).toBe(202);
    const jobId = res.body.jobId as string;
    const jobSnap = await db.collection('deletionJobs').doc(jobId).get();
    expect(jobSnap.exists).toBe(true);
    const userSnap = await db.collection('users').doc(headers['X-Test-Uid']).get();
    expect(userSnap.data()?.isDeleting).toBe(true);
    expect(userSnap.data()?.deletionJobId).toBe(jobId);
  });
});


