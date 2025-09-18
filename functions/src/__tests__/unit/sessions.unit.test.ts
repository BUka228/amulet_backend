import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';

describe('Unit: Sessions edge cases', () => {
  const uid = 'u_unit_1';
  const otherUid = 'u_unit_2';
  const deviceId = 'dev_unit_1';
  const practiceId = 'pr_unit_1';

  beforeEach(async () => {
    const now = new Date();
    await db.collection('practices').doc(practiceId).set({ id: practiceId, type: 'breath', title: 'P', durationSec: 60, patternId: 'pat', createdAt: now, supportedLocales: ['en'], locales: { en: { title: 'P' } } });
    await db.collection('devices').doc(deviceId).set({ id: deviceId, ownerId: uid, serial: 'S', hardwareVersion: 200, firmwareVersion: '200', name: 'D', batteryLevel: 90, status: 'online', pairedAt: now, settings: { brightness: 50, haptics: 50, gestures: {} }, lastSeenAt: now, createdAt: now, updatedAt: now });
  });

  test('repeat stop session -> failed_precondition', async () => {
    const start = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({ deviceId })
      .expect(200);
    const sessionId = start.body.sessionId as string;
    await request(app)
      .post(`/v1/practices.session/${sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: true, durationSec: 1 })
      .expect(200);
    const second = await request(app)
      .post(`/v1/practices.session/${sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: true, durationSec: 1 })
      .expect(412);
    expect(second.body.code).toBe('failed_precondition');
  });

  test('stop foreign session -> permission_denied', async () => {
    const start = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({})
      .expect(200);
    const sessionId = start.body.sessionId as string;
    const res = await request(app)
      .post(`/v1/practices.session/${sessionId}/stop`)
      .set('X-Test-Uid', otherUid)
      .send({ completed: true })
      .expect(403);
    expect(res.body.code).toBe('permission_denied');
  });

  test('start with foreign deviceId -> permission_denied', async () => {
    // device belongs to uid, try start as otherUid
    const res = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', otherUid)
      .send({ deviceId })
      .expect(403);
    expect(res.body.code).toBe('permission_denied');
  });

  test('stats overview invalid or empty range -> invalid_argument', async () => {
    // empty -> default is week, so send explicit invalid value
    const res = await request(app)
      .get('/v1/stats/overview')
      .set('X-Test-Uid', uid)
      .query({ range: 'invalid' })
      .expect(400);
    expect(res.body.code).toBe('invalid_argument');
  });

  test('stats overview reads from stats_daily aggregates', async () => {
    const dateKey = new Date().toISOString().slice(0, 10);
    await db.collection('users').doc(uid).collection('stats_daily').doc(dateKey).set({
      date: dateKey,
      totals: {
        sessionsCount: 3,
        totalDurationSec: 180,
        practicesCompleted: 2,
        hugsSent: 0,
        hugsReceived: 0,
        patternsCreated: 0,
        rulesTriggered: 1,
      }
    });

    const res = await request(app)
      .get('/v1/stats/overview')
      .set('X-Test-Uid', uid)
      .query({ range: 'day' })
      .expect(200);
    expect(res.body.totals.sessionsCount).toBeGreaterThanOrEqual(3);
    expect(res.body.totals.totalDurationSec).toBeGreaterThanOrEqual(180);
    expect(res.body.totals.practicesCompleted).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.rulesTriggered).toBeGreaterThanOrEqual(1);
  });
});


