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
      db.collection('patterns').doc('pub1').set({ id: 'pub1', public: true, kind: 'light', hardwareVersion: 200, reviewStatus: 'approved', createdAt: now, updatedAt: now }),
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

  test('GET /v1/patterns lists public patterns with filters', async () => {
    const res = await request(app)
      .get('/v1/patterns')
      .set('X-Test-Uid', uid)
      .query({ hardwareVersion: 200, kind: 'light' })
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
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
});


