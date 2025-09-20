import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { db } from '../../core/firebase';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { FieldValue } from 'firebase-admin/firestore';

describe('Notification tokens denormalization integration tests', () => {
  let testEnv: RulesTestEnvironment;
  const testUid = 'test-user-denormalization';

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test-denormalization',
      firestore: {
        rules: `
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              match /{document=**} {
                allow read, write: if true;
              }
            }
          }
        `,
      },
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    // Очищаем кэш конфигурации
    clearConfigCache();
    
    // Устанавливаем тестовые значения
    setConfigValue('max_notification_tokens', 5);
    
    // Создаем тестового пользователя
    await db.collection('users').doc(testUid).set({
      displayName: 'Test User Denormalization',
      consents: {
        analytics: true,
        marketing: true,
        telemetry: true,
      },
      pushTokens: [], // Изначально пустой массив
      isDeleted: false,
      createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
  });

  afterEach(async () => {
    // Очищаем тестовые данные
    const userRef = db.collection('users').doc(testUid);
    const tokensSnapshot = await userRef.collection('notificationTokens').get();
    const batch = db.batch();
    
    tokensSnapshot.docs.forEach(tokenDoc => {
      batch.delete(tokenDoc.ref);
    });
    
    await batch.commit();
    
    // Сбрасываем pushTokens массив
    await userRef.update({ pushTokens: [] });
  });

  it('should add token to pushTokens array when registering new token', async () => {
    const token = 'test-token-1';
    const platform = 'ios';
    
    // Регистрируем токен
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const now = new Date();
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    await tokensRef.add({
      userId: testUid,
      token,
      platform,
      isActive: true,
      lastUsedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    
    // Обновляем pushTokens массив (имитируем API)
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(token),
      updatedAt: timestamp,
    });
    
    // Проверяем, что токен добавлен в pushTokens
    const userDoc = await db.collection('users').doc(testUid).get();
    const userData = userDoc.data();
    
    expect(userData?.pushTokens).toContain(token);
    expect(userData?.pushTokens).toHaveLength(1);
  });

  it('should remove token from pushTokens array when deactivating token', async () => {
    const token = 'test-token-2';
    const platform = 'android';
    
    // Сначала добавляем токен
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const now = new Date();
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    await tokensRef.add({
      userId: testUid,
      token,
      platform,
      isActive: true,
      lastUsedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    
    // Добавляем в pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(token),
      updatedAt: timestamp,
    });
    
    // Проверяем, что токен добавлен
    let userDoc = await db.collection('users').doc(testUid).get();
    let userData = userDoc.data();
    expect(userData?.pushTokens).toContain(token);
    
    // Деактивируем токен
    const tokenSnapshot = await tokensRef.where('token', '==', token).get();
    const tokenDoc = tokenSnapshot.docs[0];
    
    await tokenDoc.ref.update({
      isActive: false,
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Удаляем из pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayRemove(token),
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Проверяем, что токен удален из pushTokens
    userDoc = await db.collection('users').doc(testUid).get();
    userData = userDoc.data();
    
    expect(userData?.pushTokens).not.toContain(token);
    expect(userData?.pushTokens).toHaveLength(0);
  });

  it('should handle multiple tokens correctly', async () => {
    const tokens = ['token-1', 'token-2', 'token-3'];
    const platform = 'web';
    
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const now = new Date();
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    // Добавляем все токены
    for (const token of tokens) {
      await tokensRef.add({
        userId: testUid,
        token,
        platform,
        isActive: true,
        lastUsedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    
    // Добавляем все токены в pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(...tokens),
      updatedAt: timestamp,
    });
    
    // Проверяем, что все токены добавлены
    let userDoc = await db.collection('users').doc(testUid).get();
    let userData = userDoc.data();
    
    expect(userData?.pushTokens).toHaveLength(3);
    expect(userData?.pushTokens).toContain('token-1');
    expect(userData?.pushTokens).toContain('token-2');
    expect(userData?.pushTokens).toContain('token-3');
    
    // Деактивируем один токен
    const tokenSnapshot = await tokensRef.where('token', '==', 'token-2').get();
    const tokenDoc = tokenSnapshot.docs[0];
    
    await tokenDoc.ref.update({
      isActive: false,
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Удаляем из pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayRemove('token-2'),
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Проверяем, что остались только активные токены
    userDoc = await db.collection('users').doc(testUid).get();
    userData = userDoc.data();
    
    expect(userData?.pushTokens).toHaveLength(2);
    expect(userData?.pushTokens).toContain('token-1');
    expect(userData?.pushTokens).toContain('token-3');
    expect(userData?.pushTokens).not.toContain('token-2');
  });

  it('should handle reactivation of deactivated token', async () => {
    const token = 'test-token-reactivation';
    const platform = 'ios';
    
    // Добавляем токен
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const now = new Date();
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    await tokensRef.add({
      userId: testUid,
      token,
      platform,
      isActive: true,
      lastUsedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    
    // Добавляем в pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(token),
      updatedAt: timestamp,
    });
    
    // Деактивируем токен
    const tokenSnapshot = await tokensRef.where('token', '==', token).get();
    const tokenDoc = tokenSnapshot.docs[0];
    
    await tokenDoc.ref.update({
      isActive: false,
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Удаляем из pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayRemove(token),
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Проверяем, что токен удален
    let userDoc = await db.collection('users').doc(testUid).get();
    let userData = userDoc.data();
    expect(userData?.pushTokens).not.toContain(token);
    
    // Реактивируем токен
    await tokenDoc.ref.update({
      isActive: true,
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Добавляем обратно в pushTokens
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(token),
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
    
    // Проверяем, что токен снова добавлен
    userDoc = await db.collection('users').doc(testUid).get();
    userData = userDoc.data();
    
    expect(userData?.pushTokens).toContain(token);
    expect(userData?.pushTokens).toHaveLength(1);
  });

  it('should maintain consistency between subcollection and pushTokens array', async () => {
    const tokens = [
      { token: 'active-token-1', platform: 'ios', isActive: true },
      { token: 'active-token-2', platform: 'android', isActive: true },
      { token: 'inactive-token-1', platform: 'web', isActive: false },
      { token: 'inactive-token-2', platform: 'ios', isActive: false },
    ];
    
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const now = new Date();
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    // Добавляем все токены в подколлекцию
    for (const tokenData of tokens) {
      await tokensRef.add({
        userId: testUid,
        token: tokenData.token,
        platform: tokenData.platform,
        isActive: tokenData.isActive,
        lastUsedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    
    // Добавляем только активные токены в pushTokens
    const activeTokens = tokens.filter(t => t.isActive).map(t => t.token);
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(...activeTokens),
      updatedAt: timestamp,
    });
    
    // Проверяем консистентность
    const userDoc = await db.collection('users').doc(testUid).get();
    const userData = userDoc.data();
    
    const activeTokensFromSubcollection = await tokensRef.where('isActive', '==', true).get();
    const activeTokensFromArray = userData?.pushTokens || [];
    
    expect(activeTokensFromSubcollection.size).toBe(2);
    expect(activeTokensFromArray).toHaveLength(2);
    
    // Проверяем, что массивы содержат одинаковые токены
    const subcollectionTokens = activeTokensFromSubcollection.docs.map(doc => doc.data().token);
    expect(subcollectionTokens.sort()).toEqual(activeTokensFromArray.sort());
  });

  it('should handle cleanup of old tokens with denormalization', async () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 дня назад
    
    const tokens = [
      { token: 'old-inactive-token', platform: 'ios', isActive: false, date: oldDate },
      { token: 'recent-inactive-token', platform: 'android', isActive: false, date: recentDate },
      { token: 'old-active-token', platform: 'web', isActive: true, date: oldDate },
      { token: 'recent-active-token', platform: 'ios', isActive: true, date: recentDate },
    ];
    
    const tokensRef = db.collection('users').doc(testUid).collection('notificationTokens');
    const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
    
    // Добавляем все токены
    for (const tokenData of tokens) {
      const tokenTimestamp = { 
        seconds: Math.floor(tokenData.date.getTime() / 1000), 
        nanoseconds: (tokenData.date.getTime() % 1000) * 1000000 
      };
      
      await tokensRef.add({
        userId: testUid,
        token: tokenData.token,
        platform: tokenData.platform,
        isActive: tokenData.isActive,
        lastUsedAt: tokenTimestamp,
        createdAt: tokenTimestamp,
        updatedAt: tokenTimestamp,
      });
    }
    
    // Добавляем только активные токены в pushTokens
    const activeTokens = tokens.filter(t => t.isActive).map(t => t.token);
    await db.collection('users').doc(testUid).update({
      pushTokens: FieldValue.arrayUnion(...activeTokens),
      updatedAt: timestamp,
    });
    
    // Имитируем очистку старых неактивных токенов (7 дней)
    const cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oldInactiveTokens = await tokensRef
      .where('isActive', '==', false)
      .where('updatedAt', '<', cutoffDate)
      .get();
    
    // Удаляем старые неактивные токены
    const tokensToRemove: string[] = [];
    for (const tokenDoc of oldInactiveTokens.docs) {
      const tokenData = tokenDoc.data();
      tokensToRemove.push(tokenData.token);
      await tokenDoc.ref.delete();
    }
    
    // Обновляем pushTokens массив
    if (tokensToRemove.length > 0) {
      await db.collection('users').doc(testUid).update({
        pushTokens: FieldValue.arrayRemove(...tokensToRemove),
        updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      });
    }
    
    // Проверяем результат
    const userDoc = await db.collection('users').doc(testUid).get();
    const userData = userDoc.data();
    const remainingTokens = userData?.pushTokens || [];
    
    // Должны остаться только активные токены
    expect(remainingTokens).toHaveLength(2);
    expect(remainingTokens).toContain('old-active-token');
    expect(remainingTokens).toContain('recent-active-token');
    expect(remainingTokens).not.toContain('old-inactive-token');
    expect(remainingTokens).not.toContain('recent-inactive-token');
    
    // Проверяем подколлекцию
    const remainingTokensInSubcollection = await tokensRef.get();
    expect(remainingTokensInSubcollection.size).toBe(4); // 2 активных + 2 недавних неактивных
  });
});
