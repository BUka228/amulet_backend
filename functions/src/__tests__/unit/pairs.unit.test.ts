import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Мокаем модуль БД, чтобы изолировать логику роутера
jest.mock('../../core/firebase', () => ({
  db: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

import { db } from '../../core/firebase';
import pairsRouter from '../../api/pairs';
import { errorHandler } from '../../core/http';

describe('pairsRouter unit', () => {
  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const testUid = (req.headers['x-test-uid'] as string) || '';
      if (!req.auth && testUid) {
        (req as unknown as { auth: unknown }).auth = {
          user: { uid: testUid, customClaims: {} },
          token: 'test-token',
          isAuthenticated: true,
        };
      }
      next();
    });
    app.use('/v1', pairsRouter);
    app.use(errorHandler());
    return app;
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('validation: POST /v1/pairs.invite returns 400 for missing method', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': 'u1' })
      .send({})
      .expect(400);
    expect(res.body.code).toBe('invalid_argument');
    // не должно обращаться к БД
    expect((db.collection as unknown as jest.Mock).mock.calls.length).toBe(0);
  });

  it('POST /v1/pairs.accept returns 412 for expired invite (TTL)', async () => {
    const app = createApp();

    // Настраиваем mock runTransaction для проверки TTL
    const inviteData = {
      fromUserId: 'u_alice',
      expiresAt: new Date(Date.now() - 1000),
      status: 'pending',
    };

    // Заглушки ссылок на документы
    const inviteDocRef = { id: 'inv1' } as unknown as FirebaseFirestore.DocumentReference;

    (db.collection as unknown as jest.Mock).mockImplementation((name: string) => {
      if (name === 'invites') {
        return {
          doc: (id?: string) => ({ id: id || 'inv1', set: jest.fn() }),
        };
      }
      if (name === 'pairs') {
        return {
          where: jest.fn().mockReturnValue({ limit: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ docs: [] }) }) }),
          doc: jest.fn().mockReturnValue({ id: 'pair1' }),
        };
      }
      return { doc: jest.fn() };
    });

    (db.runTransaction as unknown as jest.Mock).mockImplementation(async (fn: (tx: any) => any) => {
      const tx = {
        get: async (ref: unknown) => {
          // имитируем существующий инвайт
          return {
            exists: true,
            data: () => inviteData,
          };
        },
        set: jest.fn(),
        update: jest.fn(),
      };
      return await fn(tx);
    });

    const res = await request(app)
      .post('/v1/pairs.accept')
      .set({ 'X-Test-Uid': 'u_bob' })
      .send({ inviteId: inviteDocRef.id })
      .expect(412);
    expect(res.body.code).toBe('failed_precondition');
  });

  it('POST /v1/pairs/:id/block returns 403 if requester not a member', async () => {
    const app = createApp();

    (db.runTransaction as unknown as jest.Mock).mockImplementation(async (fn: (tx: any) => any) => {
      const tx = {
        get: async (_ref: unknown) => ({
          exists: true,
          data: () => ({ memberIds: ['other1', 'other2'], status: 'active' }),
        }),
        update: jest.fn(),
      };
      return await fn(tx);
    });

    // collection('pairs').doc(...) вызывается до транзакции
    (db.collection as unknown as jest.Mock).mockImplementation((name: string) => {
      if (name === 'pairs') {
        return { doc: jest.fn().mockReturnValue({ id: 'pair_x' }) };
      }
      return { doc: jest.fn() };
    });

    const res = await request(app)
      .post('/v1/pairs/pair_x/block')
      .set({ 'X-Test-Uid': 'u_not_member' })
      .expect(403);
    expect(res.body.code).toBe('permission_denied');
  });
});


