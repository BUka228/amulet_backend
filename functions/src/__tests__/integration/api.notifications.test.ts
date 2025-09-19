import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';
import { setConfigValue, clearConfigCache } from '../../core/remoteConfig';

describe('Notifications tokens API', () => {
  const route = '/v1/notifications.tokens';
  const testUid = 'u_notifications_test';
  const tokenA = 'fcm_token_A_'.padEnd(24, 'x');
  const tokenB = 'fcm_token_B_'.padEnd(24, 'y');
  const tokenC = 'fcm_token_C_'.padEnd(24, 'z');

  beforeAll(async () => {
    // Инициализируем профиль пользователя, чтобы /notifications.tokens не возвращал 404
    const initResponse = await request(app)
      .post('/v1/users.me.init')
      .set('X-Test-Uid', testUid)
      .send({ displayName: 'Notif Tester' });
    
    console.log('User init response:', initResponse.status, initResponse.body);
    
    // Проверяем, что пользователь действительно создался
    const userDoc = await db.collection('users').doc(testUid).get();
    console.log('User document exists:', userDoc.exists);
    if (userDoc.exists) {
      console.log('User document data:', userDoc.data());
    }
  });

  beforeEach(async () => {
    // Очищаем кэш Remote Config и устанавливаем тестовые значения
    clearConfigCache();
    setConfigValue('max_notification_tokens', 20);
    
    // Убеждаемся, что профиль пользователя существует перед каждым тестом
    const userDoc = await db.collection('users').doc(testUid).get();
    if (!userDoc.exists) {
      console.log('User profile missing, reinitializing...');
      await request(app)
        .post('/v1/users.me.init')
        .set('X-Test-Uid', testUid)
        .send({ displayName: 'Notif Tester' });
    }
  });

  afterEach(async () => {
    // Очищаем токены после каждого теста
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.get();
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    
    // Сбрасываем Remote Config кэш
    clearConfigCache();
  });

  afterAll(async () => {
    // Очищаем профиль пользователя после всех тестов
    await db.collection('users').doc(testUid).delete();
  });

  it('registers a token with metadata (POST)', async () => {
    const res = await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios', appVersion: '1.0.0' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    // Verify token was created in subcollection with metadata
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('token', '==', tokenA).get();
    expect(snapshot.size).toBe(1);
    
    const tokenDoc = snapshot.docs[0].data();
    expect(tokenDoc).toMatchObject({
      userId: testUid,
      token: tokenA,
      platform: 'ios',
      isActive: true,
    });
    expect(tokenDoc.createdAt).toBeDefined();
    expect(tokenDoc.lastUsedAt).toBeDefined();
    expect(tokenDoc.updatedAt).toBeDefined();
  });

  it('reactivates existing token and updates lastUsedAt', async () => {
    // Register token first time
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(200);

    // Get initial lastUsedAt
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    let snapshot = await tokensRef.where('token', '==', tokenA).get();
    const initialLastUsed = snapshot.docs[0].data().lastUsedAt;

    // Wait a bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Register same token again (should reactivate)
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(200);

    // Verify lastUsedAt was updated
    snapshot = await tokensRef.where('token', '==', tokenA).get();
    const updatedLastUsed = snapshot.docs[0].data().lastUsedAt;
    expect(updatedLastUsed.seconds).toBeGreaterThan(initialLastUsed.seconds);
  });

  it('respects token limit (max 20)', async () => {
    // Register 20 tokens
    for (let i = 0; i < 20; i++) {
      await request(app)
        .post(route)
        .set('X-Test-Uid', testUid)
        .send({ token: `token_${i}_`.padEnd(24, 'x'), platform: 'web' })
        .expect(200);
    }

    // 21st token should fail
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenC, platform: 'web' })
      .expect(429);

    // Verify exactly 20 active tokens
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('isActive', '==', true).get();
    expect(snapshot.size).toBe(20);
  });

  it('deactivates token instead of deleting (DELETE)', async () => {
    // Register token
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'android' })
      .expect(200);

    // Unregister token
    const res = await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA })
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    // Verify token is deactivated but still exists
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('token', '==', tokenA).get();
    expect(snapshot.size).toBe(1);
    
    const tokenDoc = snapshot.docs[0].data();
    expect(tokenDoc.isActive).toBe(false);
    expect(tokenDoc.updatedAt).toBeDefined();
  });

  it('handles unregistering non-existent token gracefully', async () => {
    const res = await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token: 'non_existent_token' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('defaults platform to web when not specified', async () => {
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA })
      .expect(200);

    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('token', '==', tokenA).get();
    const tokenDoc = snapshot.docs[0].data();
    expect(tokenDoc.platform).toBe('web');
  });

  it('returns 401 without auth', async () => {
    await request(app)
      .post(route)
      .send({ token: tokenA, platform: 'ios' })
      .expect(401);
  });

  it('returns 404 when user profile not initialized', async () => {
    const uninitializedUid = 'u_uninitialized_test';
    
    const res = await request(app)
      .post(route)
      .set('X-Test-Uid', uninitializedUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(404);
    
    expect(res.body.message).toContain('User profile not initialized');
    expect(res.body.message).toContain('/v1/users.me.init');
  });

  it('returns 404 for DELETE when user profile not initialized', async () => {
    const uninitializedUid = 'u_uninitialized_delete_test';
    
    const res = await request(app)
      .delete(route)
      .set('X-Test-Uid', uninitializedUid)
      .send({ token: tokenA })
      .expect(404);
    
    expect(res.body.message).toContain('User profile not initialized');
    expect(res.body.message).toContain('/v1/users.me.init');
  });

  it('respects dynamic token limit from Remote Config', async () => {
    // Устанавливаем лимит в 3 токена
    setConfigValue('max_notification_tokens', 3);

    // Регистрируем 3 токена (должно работать)
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post(route)
        .set('X-Test-Uid', testUid)
        .send({ token: `token_${i}_`.padEnd(24, 'x'), platform: 'web' })
        .expect(200);
    }

    // 4-й токен должен быть отклонен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenC, platform: 'web' })
      .expect(429);

    // Проверяем, что точно 3 активных токена
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('isActive', '==', true).get();
    expect(snapshot.size).toBe(3);
  });

  it('updates limit dynamically when Remote Config changes', async () => {
    // Начинаем с лимита 2
    setConfigValue('max_notification_tokens', 2);

    // Регистрируем 2 токена
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenA, platform: 'ios' })
      .expect(200);

    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenB, platform: 'android' })
      .expect(200);

    // 3-й токен должен быть отклонен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenC, platform: 'web' })
      .expect(429);

    // Увеличиваем лимит до 5
    setConfigValue('max_notification_tokens', 5);

    // Теперь 3-й токен должен пройти
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: tokenC, platform: 'web' })
      .expect(200);

    // Проверяем, что теперь 3 активных токена
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const snapshot = await tokensRef.where('isActive', '==', true).get();
    expect(snapshot.size).toBe(3);
  });
});