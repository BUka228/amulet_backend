import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import hugsRouter from '../../api/hugs';

// Мокаем FCM, чтобы не требовать реальный доступ к Firebase Cloud Messaging
jest.mock('firebase-admin/messaging', () => {
  return {
    getMessaging: jest.fn().mockReturnValue({
      sendEachForMulticast: jest.fn(async () => ({ successCount: 1, failureCount: 0, responses: [] }))
    })
  };
});

describe('Hugs API (/v1/hugs*)', () => {
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
  app.use('/v1', hugsRouter);
  app.use(errorHandler());
  const agent = request(app);

  const alice = { uid: 'u_hugs_alice' };
  const bob = { uid: 'u_hugs_bob' };

  beforeAll(() => {
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'amulet-test' });
    }
  });

  beforeEach(async () => {
    // Создаём пару и FCM токен перед каждым тестом
    const db = admin.firestore();
    const pairRef = db.collection('pairs').doc('pair_ab');
    await pairRef.set({ id: 'pair_ab', memberIds: [alice.uid, bob.uid], status: 'active', createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    const tokenRef = db.collection('notificationTokens').doc('tok_bob');
    await tokenRef.set({ id: 'tok_bob', userId: bob.uid, token: 'fcm_token_bob', isActive: true, createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });

  it('POST /v1/hugs.send sends and returns hugId with delivered=true', async () => {
    const res = await agent
      .post('/v1/hugs.send')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ pairId: 'pair_ab', emotion: { color: '#FFAA00', patternId: 'pat_warm' } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hugId');
    expect(res.body.delivered).toBe(true);
  });

  it('GET /v1/hugs?direction=received returns list for receiver', async () => {
    // отправим одно объятие
    await agent
      .post('/v1/hugs.send')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ pairId: 'pair_ab', emotion: { color: '#00FF00', patternId: 'pat_calm' } })
      .expect(200);
    const res = await agent.get('/v1/hugs?direction=received').set({ 'X-Test-Uid': bob.uid });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/hugs/:id returns specific hug when member', async () => {
    const send = await agent
      .post('/v1/hugs.send')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ pairId: 'pair_ab', emotion: { color: '#112233', patternId: 'pat_x' } })
      .expect(200);
    const hugId = send.body.hugId as string;
    const res = await agent.get(`/v1/hugs/${hugId}`).set({ 'X-Test-Uid': bob.uid });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hug');
    expect(res.body.hug.id).toBe(hugId);
  });
});


