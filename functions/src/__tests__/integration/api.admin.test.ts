import { describe, test, expect, beforeEach } from '@jest/globals';
import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';

describe('Integration: /v1/admin/patterns/:id/review', () => {
  const adminUid = 'u_admin';
  const userUid = 'u_user';

  beforeEach(async () => {
    const now = new Date();
    await Promise.all([
      db.collection('users').doc(adminUid).set({ id: adminUid, createdAt: now, role: 'admin' }),
      db.collection('users').doc(userUid).set({ id: userUid, createdAt: now }),
      db.collection('patterns').doc('p_mod_1').set({ id: 'p_mod_1', ownerId: userUid, public: true, reviewStatus: 'pending', kind: 'light', hardwareVersion: 200, tags: ['calm'], createdAt: now, updatedAt: now, title: 'Pending Pattern' }),
    ]);
  });

  test('reject non-admin', async () => {
    await request(app)
      .post('/v1/admin/patterns/p_mod_1/review')
      .set('X-Test-Uid', userUid)
      .send({ action: 'approve' })
      .expect(403);
  });

  test('admin list/get/patch/delete patterns', async () => {
    // list with filters
    const list = await request(app)
      .get('/v1/admin/patterns')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .query({ reviewStatus: 'pending', hardwareVersion: 200, tags: 'calm' })
      .expect(200);
    const ids = (list.body.items as any[]).map(i => i.id);
    expect(ids).toContain('p_mod_1');

    // get
    const get = await request(app)
      .get('/v1/admin/patterns/p_mod_1')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .expect(200);
    expect(get.body?.pattern?.id).toBe('p_mod_1');

    // patch
    const patch = await request(app)
      .patch('/v1/admin/patterns/p_mod_1')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .send({ title: 'Updated by admin', public: true, reviewStatus: 'approved' })
      .expect(200);
    expect(patch.body?.pattern?.title).toBe('Updated by admin');
    expect(patch.body?.pattern?.reviewStatus).toBe('approved');

    // delete
    await request(app)
      .delete('/v1/admin/patterns/p_mod_1')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .expect(200);

    await request(app)
      .get('/v1/admin/patterns/p_mod_1')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .expect(404);
  });

  test('approve pattern as admin', async () => {
    const res = await request(app)
      .post('/v1/admin/patterns/p_mod_1/review')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .send({ action: 'approve' })
      .expect(200);
    expect(res.body?.pattern?.reviewStatus).toBe('approved');
    expect(res.body?.pattern?.reviewerId).toBe(adminUid);
  });

  test('reject pattern as admin with reason', async () => {
    const res = await request(app)
      .post('/v1/admin/patterns/p_mod_1/review')
      .set('X-Test-Uid', adminUid)
      .set('X-Test-Admin', '1')
      .send({ action: 'reject', reason: 'Low quality' })
      .expect(200);
    expect(res.body?.pattern?.reviewStatus).toBe('rejected');
    expect(res.body?.pattern?.reviewReason).toBe('Low quality');
  });
});


