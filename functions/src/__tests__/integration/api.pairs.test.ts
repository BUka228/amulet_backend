import request from 'supertest';
import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import pairsRouter from '../../api/pairs';
import hugsRouter from '../../api/hugs';

describe('Pairs API (/v1/pairs*)', () => {
  const app = express();
  applyBaseMiddlewares(app);
  app.use(i18nMiddleware());
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
  // Подключаем hugsRouter, чтобы проверить, что блокировка пары предотвращает «объятия»
  app.use('/v1', hugsRouter);
  app.use(errorHandler());
  const agent = request(app);

  const alice = { uid: 'u_pairs_alice' };
  const bob = { uid: 'u_pairs_bob' };

  beforeAll(() => {
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'amulet-test' });
    }
  });

  beforeEach(async () => {
    // очистка коллекций, которые используем в тестах
    const db = admin.firestore();
    const collections = ['invites', 'pairs', 'hugs', 'notificationTokens'];
    for (const col of collections) {
      const snap = await db.collection(col).get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  });

  it('POST /v1/pairs.invite creates invite with url and TTL', async () => {
    const res = await agent
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ method: 'link' })
      .expect(200);
    expect(res.body).toHaveProperty('inviteId');
    expect(res.body).toHaveProperty('url');

    const db = admin.firestore();
    const doc = await db.collection('invites').doc(res.body.inviteId).get();
    expect(doc.exists).toBe(true);
    const expiresAt = (doc.get('expiresAt') as FirebaseFirestore.Timestamp | undefined)?.toDate();
    expect(expiresAt instanceof Date).toBe(true);
  });

  it('POST /v1/pairs.accept activates pair for inviter and accepter', async () => {
    const invite = await agent
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ method: 'link' })
      .expect(200);

    const accept = await agent
      .post('/v1/pairs.accept')
      .set({ 'X-Test-Uid': bob.uid })
      .send({ inviteId: invite.body.inviteId })
      .expect(200);
    expect(accept.body).toHaveProperty('pair');
    expect(Array.isArray(accept.body.pair.memberIds)).toBe(true);

    const listAlice = await agent.get('/v1/pairs').set({ 'X-Test-Uid': alice.uid }).expect(200);
    const listBob = await agent.get('/v1/pairs').set({ 'X-Test-Uid': bob.uid }).expect(200);
    expect(listAlice.body.pairs.length).toBe(1);
    expect(listBob.body.pairs.length).toBe(1);
  });

  it('Cannot accept own invite', async () => {
    const invite = await agent
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ method: 'link' })
      .expect(200);
    const res = await agent
      .post('/v1/pairs.accept')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ inviteId: invite.body.inviteId });
    expect(res.status).toBe(412);
  });

  it('Invite expiration prevents acceptance', async () => {
    // создаём инвайт вручную с просроченной датой
    const db = admin.firestore();
    const invRef = db.collection('invites').doc('inv_expired');
    await invRef.set({
      id: 'inv_expired',
      inviteId: 'inv_expired',
      fromUserId: alice.uid,
      method: 'link',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() - 1000),
      status: 'pending',
    });
    const res = await agent
      .post('/v1/pairs.accept')
      .set({ 'X-Test-Uid': bob.uid })
      .send({ inviteId: 'inv_expired' });
    expect(res.status).toBe(412);
  });

  it('POST /v1/pairs/:id/block blocks pair and prevents hugs', async () => {
    // создаём пару через инвайт
    const invite = await agent
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ method: 'link' })
      .expect(200);
    const accept = await agent
      .post('/v1/pairs.accept')
      .set({ 'X-Test-Uid': bob.uid })
      .send({ inviteId: invite.body.inviteId })
      .expect(200);
    const pairId = accept.body.pair.id as string;

    // блокируем
    const blocked = await agent
      .post(`/v1/pairs/${pairId}/block`)
      .set({ 'X-Test-Uid': alice.uid })
      .expect(200);
    expect(blocked.body.pair.status).toBe('blocked');

    // пробуем отправить объятие через заблокированную пару
    const hug = await agent
      .post('/v1/hugs.send')
      .set({ 'X-Test-Uid': alice.uid })
      .send({ pairId, emotion: { color: '#123', patternId: 'p' } });
    expect(hug.status).toBe(412);
  });

  it('Validation: 400 for invalid invite payload', async () => {
    const res = await agent
      .post('/v1/pairs.invite')
      .set({ 'X-Test-Uid': alice.uid })
      // method обязателен
      .send({})
      .expect(400);
    expect(res.body.code).toBe('invalid_argument');
  });

  it('401 when unauthenticated', async () => {
    const res = await agent.post('/v1/pairs.invite').send({ method: 'link' });
    expect(res.status).toBe(401);
  });
});


