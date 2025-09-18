import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';
import * as admin from 'firebase-admin';

describe('Integration: /v1/patterns', () => {
  const uid = 'u_test';

  beforeEach(async () => {
    const now = new Date();
    await Promise.all([
      db.collection('users').doc(uid).set({ id: uid, createdAt: now }),
      db.collection('devices').doc('d1').set({ id: 'd1', ownerId: uid, hardwareVersion: 100, createdAt: now }),
      db.collection('patterns').doc('pub1').set({ id: 'pub1', public: true, kind: 'light', hardwareVersion: 200, reviewStatus: 'approved', createdAt: now, updatedAt: now, title: 'Северное сияние' }),
      db.collection('patterns').doc('pend1').set({ id: 'pend1', public: true, kind: 'light', hardwareVersion: 200, reviewStatus: 'pending', createdAt: now, updatedAt: now, title: 'Черновик' }),
      db.collection('notificationTokens').doc('t1').set({ userId: uid, token: 'fcm-1', isActive: true }),
    ]);
  });

  test('POST /v1/patterns creates pattern', async () => {
    const payload = {
      kind: 'light',
      hardwareVersion: 200,
      spec: {
        type: 'gradient',
        hardwareVersion: 200,
        duration: 2000,
        elements: [{ type: 'gradient', startTime: 0, duration: 2000, colors: ['#FF0000', '#00FF00'] }]
      },
      title: 'My pattern',
      description: 'desc',
      tags: ['calm'],
      public: false
    };
    const res = await request(app)
      .post('/v1/patterns')
      .set('X-Test-Uid', uid)
      .send(payload)
      .expect(201);
    expect(res.body).toHaveProperty('pattern');
    expect(res.body.pattern.ownerId).toBe(uid);
  });

  test('spec validation: pulse requires color and gradient requires colors', async () => {
    // pulse без color → 400
    const badPulse = {
      kind: 'light',
      hardwareVersion: 200,
      spec: {
        type: 'pulse',
        hardwareVersion: 200,
        duration: 1000,
        elements: [{ type: 'pulse', startTime: 0, duration: 500 }],
      },
    };
    await request(app).post('/v1/patterns').set('X-Test-Uid', uid).send(badPulse).expect(400);

    // gradient без colors → 400
    const badGradient = {
      kind: 'light',
      hardwareVersion: 200,
      spec: {
        type: 'gradient',
        hardwareVersion: 200,
        duration: 1000,
        elements: [{ type: 'gradient', startTime: 0, duration: 500 }],
      },
    };
    await request(app).post('/v1/patterns').set('X-Test-Uid', uid).send(badGradient).expect(400);

    // корректный pulse
    const okPulse = {
      kind: 'light',
      hardwareVersion: 200,
      spec: {
        type: 'pulse',
        hardwareVersion: 200,
        duration: 1200,
        elements: [{ type: 'pulse', startTime: 0, duration: 600, color: '#00FF00' }],
      },
    };
    await request(app).post('/v1/patterns').set('X-Test-Uid', uid).send(okPulse).expect(201);
  });

  test('GET /v1/patterns lists public patterns with filters', async () => {
    const res = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ hardwareVersion: 200, kind: 'light' })
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    // pending не должны вернуться в публичном списке
    const ids = (res.body.items as any[]).map((i) => i.id);
    expect(ids).toContain('pub1');
    expect(ids).not.toContain('pend1');
  });

  test('Stable cursor pagination: no duplicates when item inserted between pages', async () => {
    // подготовим 3 approved public паттерна
    const now = Date.now();
    await Promise.all(['a','b','c'].map(async (s, idx) => {
      const id = `pub_${s}`;
      await db.collection('patterns').doc(id).set({ id, public: true, reviewStatus: 'approved', kind: 'light', hardwareVersion: 200, createdAt: new Date(now - idx * 1000), updatedAt: new Date(now - idx * 1000) });
    }));

    // первая страница limit=2
    const page1 = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ limit: 2 })
      .expect(200);
    const items1 = page1.body.items as any[];
    const cursor = page1.body.nextCursor as string;
    expect(items1.length).toBe(2);

    // Между запросами добавляется новый документ в начало
    await db.collection('patterns').doc('pub_new').set({ id: 'pub_new', public: true, reviewStatus: 'approved', kind: 'light', hardwareVersion: 200, createdAt: new Date(Date.now() + 1000), updatedAt: new Date(Date.now() + 1000) });

    // вторая страница по курсору
    const page2 = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ cursor, limit: 2 })
      .expect(200);
    const items2 = page2.body.items as any[];

    const allIds = new Set([...items1, ...items2].map((i) => i.id));
    expect(allIds.size).toBe(items1.length + items2.length);
  });

  test('Pagination edges: last page and empty page', async () => {
    // ensure small dataset
    const now = Date.now();
    await Promise.all(['e1','e2'].map(async (s, idx) => {
      const id = `edge_${s}`;
      await db.collection('patterns').doc(id).set({ id, public: true, reviewStatus: 'approved', kind: 'light', hardwareVersion: 200, createdAt: new Date(now - idx * 1000) });
    }));

    const p1 = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ limit: 2 })
      .expect(200);
    expect((p1.body.items as any[]).length).toBeLessThanOrEqual(2);
    const cursor = p1.body.nextCursor as string | undefined;

    if (cursor) {
      const p2 = await request(app)
        .get('/v1/patterns')
        .set('X-Test-Uid', uid)
        .query({ cursor, limit: 2 })
        .expect(200);
      // last page may be empty
      expect(Array.isArray(p2.body.items)).toBe(true);
    }
  });

  test('Invalid cursor returns first page (graceful)', async () => {
    const res = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ cursor: 'invalid_cursor_value', limit: 2 })
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('Filter combinations: hardwareVersion + tags', async () => {
    const now = new Date();
    await Promise.all([
      db.collection('patterns').doc('combo1').set({ id: 'combo1', public: true, reviewStatus: 'approved', kind: 'light', hardwareVersion: 200, tags: ['calm','focus'], createdAt: now }),
      db.collection('patterns').doc('combo2').set({ id: 'combo2', public: true, reviewStatus: 'approved', kind: 'light', hardwareVersion: 100, tags: ['calm'], createdAt: now }),
    ]);
    const res = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ hardwareVersion: 200, tags: 'calm' })
      .expect(200);
    const ids = (res.body.items as any[]).map(i => i.id);
    expect(ids).toContain('combo1');
    expect(ids).not.toContain('combo2');
  });

  test('Negative: share to non-existent user returns 404', async () => {
    // ensure pattern owned by uid and approved
    await db.collection('patterns').doc('p-share-neg').set({ id: 'p-share-neg', ownerId: uid, title: 'Test', public: false, reviewStatus: 'approved', kind: 'light', hardwareVersion: 200, createdAt: new Date(), updatedAt: new Date() });
    const res = await request(app)
      .post('/v1/patterns/p-share-neg/share')
      .set('X-Test-Uid', uid)
      .send({ toUserId: 'no_such_user' })
      .expect(404);
    expect(res.body.code).toBe('not_found');
    expect(typeof res.body.message).toBe('string');
  });

  test('Negative: preview to foreign device denied', async () => {
    await db.collection('devices').doc('d2').set({ id: 'd2', ownerId: 'other', hardwareVersion: 100, createdAt: new Date() });
    const payload = {
      deviceId: 'd2',
      duration: 1000,
      spec: { type: 'pulse', hardwareVersion: 200, duration: 1000, elements: [{ type: 'pulse', startTime: 0, duration: 1000, color: '#FFFFFF' }] }
    };
    await request(app)
      .post('/v1/patterns/preview')
      .set('X-Test-Uid', uid)
      .send(payload)
      .expect(403);
  });

  test('More spec negatives: unknown element type and invalid ranges', async () => {
    const badUnknown = {
      kind: 'light',
      hardwareVersion: 200,
      spec: { type: 'custom', hardwareVersion: 200, duration: 500, elements: [{ type: 'unknown', startTime: 0, duration: 100 }] },
    } as any;
    await request(app)
      .post('/v1/patterns')
      .set('X-Test-Uid', uid)
      .send(badUnknown)
      .expect(400);

    const badRange = {
      kind: 'light',
      hardwareVersion: 200,
      spec: { type: 'pulse', hardwareVersion: 200, duration: 500, elements: [{ type: 'pulse', startTime: -1, duration: 0, color: '#fff' }] },
    } as any;
    await request(app)
      .post('/v1/patterns')
      .set('X-Test-Uid', uid)
      .send(badRange)
      .expect(400);
  });

  test('GET /v1/patterns.mine lists own patterns', async () => {
    await db.collection('patterns').add({ id: 'mine1', ownerId: uid, kind: 'light', public: false, hardwareVersion: 200, reviewStatus: 'pending', createdAt: new Date(), updatedAt: new Date() });
    const res = await request(app)
      .get('/v1/patterns.mine')
      .set('X-Test-Uid', uid)
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  test('POST /v1/patterns/preview performs down-level for HW=100 device', async () => {
    const sendMock = jest.spyOn((admin as any).messaging.Messaging.prototype, 'sendEachForMulticast').mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] } as any);
    const payload = {
      deviceId: 'd1',
      spec: {
        type: 'gradient',
        hardwareVersion: 200,
        duration: 2000,
        elements: [{ type: 'gradient', startTime: 0, duration: 2000, colors: ['#FF0000', '#00FF00'], direction: 'clockwise', leds: [0,1,2] }]
      }
    };
    const res = await request(app)
      .post('/v1/patterns/preview')
      .set('X-Test-Uid', uid)
      .send(payload)
      .expect(200);
    expect(res.body).toHaveProperty('previewId');
    expect(sendMock).toHaveBeenCalled();
    const args = (sendMock.mock.calls[0] || [])[0] as any;
    expect(Array.isArray(args.tokens)).toBe(true);
    expect(args.data.type).toBe('pattern.preview');
    expect(() => JSON.parse(args.data.spec)).not.toThrow();
    sendMock.mockRestore();
  });

  test('POST /v1/patterns/:id/share enqueues outbox for recipient', async () => {
    const recipientId = 'u_recipient';
    await Promise.all([
      db.collection('users').doc(recipientId).set({ id: recipientId }),
      db.collection('notificationTokens').doc('t2').set({ userId: recipientId, token: 'fcm-2', isActive: true }),
      db.collection('patterns').doc('p-share').set({ id: 'p-share', ownerId: uid, title: 'Северное сияние', public: false, kind: 'light', hardwareVersion: 200, reviewStatus: 'approved', createdAt: new Date(), updatedAt: new Date() }),
    ]);

    const res = await request(app)
      .post('/v1/patterns/p-share/share')
      .set('X-Test-Uid', uid)
      .send({ toUserId: recipientId })
      .expect(200);
    expect(res.body).toHaveProperty('shared', true);
    const outboxSnap = await db.collection('outbox').where('payload.toUserId', '==', recipientId).where('payload.patternId', '==', 'p-share').get();
    expect(outboxSnap.empty).toBe(false);
  });

  test('Transactional outbox created for share request', async () => {
    const recipientId = 'u_recipient3';
    await Promise.all([
      db.collection('users').doc(recipientId).set({ id: recipientId }),
      db.collection('patterns').doc('p-share-2').set({ id: 'p-share-2', ownerId: uid, title: 'Северное сияние', public: false, kind: 'light', hardwareVersion: 200, reviewStatus: 'approved', createdAt: new Date(), updatedAt: new Date() }),
    ]);

    await request(app)
      .post('/v1/patterns/p-share-2/share')
      .set('X-Test-Uid', uid)
      .send({ toUserId: recipientId })
      .expect(200);

    const outboxSnap = await db.collection('outbox').where('payload.toUserId', '==', recipientId).where('payload.patternId', '==', 'p-share-2').get();
    expect(outboxSnap.empty).toBe(false);
    const doc = outboxSnap.docs[0].data() as any;
    expect(doc.type).toBe('pattern.shared');
    expect(doc.status === 'pending' || doc.status === 'processing' || doc.status === 'delivered').toBe(true);
  });

  test('POST /v1/patterns/:id/share blocks pending pattern sharing', async () => {
    const recipientId = 'u_recipient2';
    await Promise.all([
      db.collection('users').doc(recipientId).set({ id: recipientId }),
      db.collection('patterns').doc('p-pending').set({ id: 'p-pending', ownerId: uid, title: 'Черновик', public: false, kind: 'light', hardwareVersion: 200, reviewStatus: 'pending', createdAt: new Date(), updatedAt: new Date() }),
    ]);
    await request(app)
      .post('/v1/patterns/p-pending/share')
      .set('X-Test-Uid', uid)
      .send({ toUserId: recipientId })
      .expect(412); // failed_precondition
  });
});


