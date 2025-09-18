import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';

describe('Integration: /v1/practices', () => {
  const uid = 'u_test';

  beforeEach(async () => {
    // seed minimal practices
    const col = db.collection('practices');
    const now = new Date();
    await Promise.all([
      col.doc('p1').set({ id: 'p1', type: 'breath', title: 'Square breathing', durationSec: 300, patternId: 'pat1', createdAt: now, locales: { 'en': { title: 'Square' } } }),
      col.doc('p2').set({ id: 'p2', type: 'meditation', title: 'Calm mind', durationSec: 600, patternId: 'pat2', createdAt: now, locales: { 'ru': { title: 'Спокойствие' } } }),
    ]);
  });

  test('GET /v1/practices requires auth', async () => {
    await request(app).get('/v1/practices').expect(401);
  });

  test('GET /v1/practices returns list with filters', async () => {
    const res = await request(app)
      .get('/v1/practices')
      .set('X-Test-Uid', uid)
      .query({ type: 'breath', lang: 'en' })
      .expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  test('Stable cursor pagination for practices', async () => {
    const now = Date.now();
    await Promise.all(['x','y','z'].map(async (s, idx) => {
      const id = `pr_${s}`;
      await db.collection('practices').doc(id).set({ id, type: 'breath', title: id, durationSec: 60, patternId: 'pat', createdAt: new Date(now - idx * 1000) });
    }));

    const page1 = await request(app)
      .get('/v1/practices')
      .set('X-Test-Uid', uid)
      .query({ limit: 2 })
      .expect(200);
    const items1 = page1.body.items as any[];
    const cursor = page1.body.nextCursor as string;
    expect(items1.length).toBe(2);

    await db.collection('practices').doc('pr_new').set({ id: 'pr_new', type: 'breath', title: 'pr_new', durationSec: 60, patternId: 'pat', createdAt: new Date(Date.now() + 1000) });

    const page2 = await request(app)
      .get('/v1/practices')
      .set('X-Test-Uid', uid)
      .query({ cursor, limit: 2 })
      .expect(200);
    const items2 = page2.body.items as any[];
    const allIds = new Set([...items1, ...items2].map((i) => i.id));
    expect(allIds.size).toBe(items1.length + items2.length);
  });

  test('GET /v1/practices/:id returns document', async () => {
    const res = await request(app)
      .get('/v1/practices/p1')
      .set('X-Test-Uid', uid)
      .expect(200);
    expect(res.body).toHaveProperty('practice');
    expect(res.body.practice.id).toBe('p1');
  });
});


