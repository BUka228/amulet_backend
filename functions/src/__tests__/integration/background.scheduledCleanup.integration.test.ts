import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { db } from '../../core/firebase';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { scheduledCleanup } from '../../background/scheduledCleanup';

describe('scheduledCleanup integration tests', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test-cleanup',
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
    setConfigValue('token_retention_days', 7); // 7 дней для тестов
    setConfigValue('cleanup_batch_size', 2); // Маленький батч для тестов
  });

  afterEach(async () => {
    // Очищаем тестовые данные
    const usersSnapshot = await db.collection('users').get();
    const batch = db.batch();
    
    for (const userDoc of usersSnapshot.docs) {
      // Удаляем подколлекцию токенов
      const tokensSnapshot = await userDoc.ref.collection('notificationTokens').get();
      tokensSnapshot.docs.forEach(tokenDoc => {
        batch.delete(tokenDoc.ref);
      });
      
      // Удаляем пользователя
      batch.delete(userDoc.ref);
    }
    
    await batch.commit();
  });

  it('should clean up tokens in real Firestore environment', async () => {
    const userId = 'integration_test_user';
    
    // Создаем пользователя
    await db.collection('users').doc(userId).set({
      displayName: 'Integration Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 дня назад

    // Создаем токены для тестирования
    const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
    
    // Старый неактивный токен (должен быть удален)
    const oldTokenRef = await tokensRef.add({
      userId,
      token: 'old_inactive_token',
      platform: 'ios',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Новый неактивный токен (не должен быть удален)
    const recentTokenRef = await tokensRef.add({
      userId,
      token: 'recent_inactive_token',
      platform: 'android',
      isActive: false,
      lastUsedAt: recentDate,
      createdAt: recentDate,
      updatedAt: recentDate,
    });

    // Активный токен (не должен быть удален)
    const activeTokenRef = await tokensRef.add({
      userId,
      token: 'active_token',
      platform: 'web',
      isActive: true,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Проверяем, что токены созданы
    let tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(3);

    // Проверяем, что старый токен существует
    const oldTokenDoc = await oldTokenRef.get();
    expect(oldTokenDoc.exists).toBe(true);

    // Создаем мок события
    const mockEvent = {
      jobName: 'integration-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 15000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем результат
    tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(2); // Должно остаться 2 токена

    // Проверяем, что старый токен удален
    const oldTokenDocAfter = await oldTokenRef.get();
    expect(oldTokenDocAfter.exists).toBe(false);

    // Проверяем, что остальные токены остались
    const recentTokenDoc = await recentTokenRef.get();
    const activeTokenDoc = await activeTokenRef.get();
    expect(recentTokenDoc.exists).toBe(true);
    expect(activeTokenDoc.exists).toBe(true);

    const remainingTokens = tokensSnapshot.docs.map(doc => doc.data().token);
    expect(remainingTokens).toContain('recent_inactive_token');
    expect(remainingTokens).toContain('active_token');
    expect(remainingTokens).not.toContain('old_inactive_token');
  }, 20000);

  it('should handle large number of tokens efficiently', async () => {
    const userId = 'bulk_test_user';
    
    // Создаем пользователя
    await db.collection('users').doc(userId).set({
      displayName: 'Bulk Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад

    // Создаем много токенов для тестирования
    const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
    const batch = db.batch();
    
    // Создаем 25 старых неактивных токенов (больше чем лимит в 20 на батч)
    for (let i = 0; i < 25; i++) {
      const tokenRef = tokensRef.doc();
      batch.set(tokenRef, {
        userId,
        token: `old_token_${i}`,
        platform: 'ios',
        isActive: false,
        lastUsedAt: oldDate,
        createdAt: oldDate,
        updatedAt: oldDate,
      });
    }
    
    await batch.commit();

    // Проверяем, что токены созданы
    let tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(25);

    // Создаем мок события
    const mockEvent = {
      jobName: 'bulk-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    const startTime = Date.now();

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 20000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    const endTime = Date.now();
    const executionTime = endTime - startTime;

    // Проверяем результат
    tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(0); // Все токены должны быть удалены

    // Проверяем, что выполнение заняло разумное время (менее 30 секунд)
    expect(executionTime).toBeLessThan(30000);
  }, 25000);

  it('should handle errors gracefully and continue processing', async () => {
    const userId1 = 'error_test_user_1';
    const userId2 = 'error_test_user_2';
    
    // Создаем двух пользователей
    await db.collection('users').doc(userId1).set({
      displayName: 'Error Test User 1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    await db.collection('users').doc(userId2).set({
      displayName: 'Error Test User 2',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад

    // Создаем токены для обоих пользователей
    const tokens1Ref = db.collection('users').doc(userId1).collection('notificationTokens');
    const tokens2Ref = db.collection('users').doc(userId2).collection('notificationTokens');
    
    await tokens1Ref.add({
      userId: userId1,
      token: 'user1_old_token',
      platform: 'ios',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    
    await tokens2Ref.add({
      userId: userId2,
      token: 'user2_old_token',
      platform: 'android',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Создаем мок события
    const mockEvent = {
      jobName: 'error-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 15000)
    );
    
    await expect(Promise.race([cleanupPromise, timeoutPromise])).resolves.not.toThrow();

    // Проверяем, что токены удалены (функция должна обработать оба пользователя)
    const tokens1Snapshot = await tokens1Ref.get();
    const tokens2Snapshot = await tokens2Ref.get();
    expect(tokens1Snapshot.size).toBe(0);
    expect(tokens2Snapshot.size).toBe(0);
  }, 20000);

  it('should respect batch size configuration', async () => {
    // Создаем 3 пользователей (больше чем batch_size = 2)
    const users = ['user1', 'user2', 'user3'];
    
    for (const userId of users) {
      await db.collection('users').doc(userId).set({
        displayName: `Test User ${userId}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Добавляем старые токены для каждого пользователя
      const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      
      await tokensRef.add({
        userId,
        token: `${userId}_old_token`,
        platform: 'ios',
        isActive: false,
        lastUsedAt: oldDate,
        createdAt: oldDate,
        updatedAt: oldDate,
      });
    }

    // Проверяем, что токены созданы
    for (const userId of users) {
      const tokensSnapshot = await db.collection('users').doc(userId).collection('notificationTokens').get();
      expect(tokensSnapshot.size).toBe(1);
    }

    // Создаем мок события
    const mockEvent = {
      jobName: 'batch-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 15000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем, что все токены удалены
    for (const userId of users) {
      const tokensSnapshot = await db.collection('users').doc(userId).collection('notificationTokens').get();
      expect(tokensSnapshot.size).toBe(0);
    }
  }, 20000);

  it('should handle empty database gracefully', async () => {
    // Создаем мок события
    const mockEvent = {
      jobName: 'empty-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки на пустой базе с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 10000)
    );
    
    await expect(Promise.race([cleanupPromise, timeoutPromise])).resolves.not.toThrow();
  }, 15000);

  it('should process users with mixed token states correctly', async () => {
    const userId = 'mixed_tokens_user';
    
    // Создаем пользователя
    await db.collection('users').doc(userId).set({
      displayName: 'Mixed Tokens User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 дня назад

    // Создаем различные типы токенов
    const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
    
    const tokens = [
      // Старые неактивные (должны быть удалены)
      { token: 'old_inactive_1', isActive: false, date: oldDate },
      { token: 'old_inactive_2', isActive: false, date: oldDate },
      
      // Новые неактивные (не должны быть удалены)
      { token: 'recent_inactive_1', isActive: false, date: recentDate },
      { token: 'recent_inactive_2', isActive: false, date: recentDate },
      
      // Активные (не должны быть удалены)
      { token: 'active_old', isActive: true, date: oldDate },
      { token: 'active_recent', isActive: true, date: recentDate },
    ];

    for (const tokenData of tokens) {
      await tokensRef.add({
        userId,
        token: tokenData.token,
        platform: 'ios',
        isActive: tokenData.isActive,
        lastUsedAt: tokenData.date,
        createdAt: tokenData.date,
        updatedAt: tokenData.date,
      });
    }

    // Проверяем, что все токены созданы
    let tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(6);

    // Создаем мок события
    const mockEvent = {
      jobName: 'mixed-tokens-test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 15000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем результат
    tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(4); // Должно остаться 4 токена

    const remainingTokens = tokensSnapshot.docs.map(doc => doc.data().token);
    
    // Проверяем, что удалены только старые неактивные токены
    expect(remainingTokens).toContain('recent_inactive_1');
    expect(remainingTokens).toContain('recent_inactive_2');
    expect(remainingTokens).toContain('active_old');
    expect(remainingTokens).toContain('active_recent');
    
    expect(remainingTokens).not.toContain('old_inactive_1');
    expect(remainingTokens).not.toContain('old_inactive_2');
  }, 20000);
});
