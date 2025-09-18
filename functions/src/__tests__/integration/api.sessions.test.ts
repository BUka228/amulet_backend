import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';

describe('Integration: Sessions & Stats', () => {
  const uid = 'u_sess_test';
  const deviceId = 'dev_sess_1';
  const practiceId = 'pr_sess_1';

  beforeEach(async () => {
    const now = new Date();
    // seed practice
    await db.collection('practices').doc(practiceId).set({
      id: practiceId,
      type: 'breath',
      title: 'Test Practice',
      durationSec: 120,
      patternId: 'pat_x',
      createdAt: now,
      supportedLocales: ['en'],
      locales: { en: { title: 'Test Practice', description: 'desc' } },
    });
    // seed device
    await db.collection('devices').doc(deviceId).set({
      id: deviceId,
      ownerId: uid,
      serial: 'AMU-200-TEST',
      hardwareVersion: 200,
      firmwareVersion: '200',
      name: 'My Amulet',
      batteryLevel: 80,
      status: 'online',
      pairedAt: now,
      settings: { brightness: 50, haptics: 50, gestures: {} },
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
  });

  test('POST /v1/practices/:id/start requires auth', async () => {
    await request(app).post(`/v1/practices/${practiceId}/start`).expect(401);
  });

  test('POST /v1/practices/:id/start returns 404 for missing practice', async () => {
    await request(app)
      .post(`/v1/practices/unknown/start`)
      .set('X-Test-Uid', uid)
      .expect(404);
  });

  test('POST /v1/practices/:id/start creates session and returns sessionId', async () => {
    const res = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({ deviceId, intensity: 0.6, brightness: 0.7 })
      .expect(200);
    expect(typeof res.body.sessionId).toBe('string');
    const sessionId = res.body.sessionId as string;
    const snap = await db.collection('sessions').doc(sessionId).get();
    expect(snap.exists).toBe(true);
    const data = snap.data() as any;
    expect(data.ownerId).toBe(uid);
    expect(data.practiceId).toBe(practiceId);
    expect(data.status).toBe('started');
  });

  test('POST /v1/practices.session/:id/stop completes session with provided duration and userFeedback, updates aggregates', async () => {
    const start = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({ deviceId })
      .expect(200);
    const sessionId = start.body.sessionId as string;

    const stop = await request(app)
      .post(`/v1/practices.session/${sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: true, durationSec: 42, userFeedback: { moodBefore: 2, moodAfter: 4, rating: 5, comment: 'good' } })
      .expect(200);
    expect(stop.body).toHaveProperty('summary');
    expect(stop.body.summary.durationSec).toBe(42);
    expect(stop.body.summary.completed).toBe(true);

    const snap = await db.collection('sessions').doc(sessionId).get();
    const data = snap.data() as any;
    expect(data.status).toBe('completed');
    expect(data.durationSec).toBe(42);
    expect(data.userFeedback).toEqual({ moodBefore: 2, moodAfter: 4, rating: 5, comment: 'good' });

    const dateKey = new Date().toISOString().slice(0, 10);
    const daily = await db.collection('users').doc(uid).collection('stats_daily').doc(dateKey).get();
    expect(daily.exists).toBe(true);
    const totals = (daily.data() as any)?.totals;
    expect(totals.sessionsCount).toBeGreaterThanOrEqual(1);
    expect(totals.totalDurationSec).toBeGreaterThanOrEqual(42);
    expect(totals.practicesCompleted).toBeGreaterThanOrEqual(1);
  });

  test('POST /v1/practices.session/:id/stop computes duration if not provided', async () => {
    const start = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({})
      .expect(200);
    const sessionId = start.body.sessionId as string;

    // small delay not necessary under emulator; duration is computed using server/client timestamps diff >= 0
    const stop = await request(app)
      .post(`/v1/practices.session/${sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: false })
      .expect(200);
    expect(stop.body.summary.completed).toBe(false);
    expect(typeof stop.body.summary.durationSec).toBe('number');
    expect(stop.body.summary.durationSec).toBeGreaterThanOrEqual(0);
  });

  test('GET /v1/stats/overview returns aggregated totals and streaks', async () => {
    // ensure at least one completed and one aborted session exists in range
    const s1 = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({})
      .expect(200);
    await request(app)
      .post(`/v1/practices.session/${s1.body.sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: true, durationSec: 10 })
      .expect(200);

    const s2 = await request(app)
      .post(`/v1/practices/${practiceId}/start`)
      .set('X-Test-Uid', uid)
      .send({})
      .expect(200);
    await request(app)
      .post(`/v1/practices.session/${s2.body.sessionId}/stop`)
      .set('X-Test-Uid', uid)
      .send({ completed: false, durationSec: 5 })
      .expect(200);

    const res = await request(app)
      .get('/v1/stats/overview')
      .set('X-Test-Uid', uid)
      .query({ range: 'week' })
      .expect(200);
    expect(res.body).toHaveProperty('totals');
    expect(res.body).toHaveProperty('streaks');
    expect(res.body).toHaveProperty('range');
    expect(res.body.totals.sessionsCount).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.totalDurationSec).toBeGreaterThanOrEqual(15);
    expect(res.body.totals.practicesCompleted).toBeGreaterThanOrEqual(1);
  });

  test('GET /v1/stats/overview validates range', async () => {
    await request(app)
      .get('/v1/stats/overview')
      .set('X-Test-Uid', uid)
      .query({ range: 'year' })
      .expect(400);
  });
});


