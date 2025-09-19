import request from 'supertest';
import { app } from '../../api/test';

describe('Notifications tokens API', () => {
  const route = '/v1/notifications.tokens';
  const testUid = 'u_notifications_test';
  const tokenA = 'fcm_token_A_'.padEnd(24, 'x');
  const tokenB = 'fcm_token_B_'.padEnd(24, 'y');

  beforeAll(async () => {
    // Инициализируем профиль пользователя, чтобы /notifications.tokens не возвращал 404
    await request(app)
      .post('/v1/users.me.init')
      .set('X-Test-Uid', testUid)
      .send({ displayName: 'Notif Tester' })
      .expect(200);
  });

  it('registers a token (POST)', async () => {
    const res = await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('deduplicates and limits tokens', async () => {
    // register same token again
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(200);

    // register second token
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenB, platform: 'android' })
      .expect(200);
  });

  it('unregisters a token (DELETE)', async () => {
    const res = await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('requires authentication', async () => {
    const res = await request(app)
      .post(route)
      .send({ token: tokenA, platform: 'web' })
      .expect(401);

    expect(res.body.code).toBe('unauthenticated');
  });
});


