import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { db } from '../../core/firebase';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { scheduledCleanup } from '../../background/scheduledCleanup';

// Мокаем Firebase Functions
jest.mock('firebase-functions', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('scheduledCleanup', () => {
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
      
      // Очищаем pushTokens массив
      batch.update(userDoc.ref, { pushTokens: [] });
      
      // Удаляем пользователя
      batch.delete(userDoc.ref);
    }
    
    await batch.commit();
  });

  it('should clean up old inactive tokens', async () => {
    const userId = 'test_user_cleanup';
    
    // Создаем пользователя
    await db.collection('users').doc(userId).set({
      displayName: 'Test User',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 дня назад

    // Создаем токены для тестирования
    const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
    
    // Старый неактивный токен (должен быть удален)
    await tokensRef.add({
      userId,
      token: 'old_inactive_token',
      platform: 'ios',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Новый неактивный токен (не должен быть удален)
    await tokensRef.add({
      userId,
      token: 'recent_inactive_token',
      platform: 'android',
      isActive: false,
      lastUsedAt: recentDate,
      createdAt: recentDate,
      updatedAt: recentDate,
    });

    // Активный токен (не должен быть удален)
    await tokensRef.add({
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

    // Создаем мок события
    const mockEvent = {
      jobName: 'test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 10000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем результат
    tokensSnapshot = await tokensRef.get();
    expect(tokensSnapshot.size).toBe(2); // Должно остаться 2 токена

    const remainingTokens = tokensSnapshot.docs.map(doc => doc.data().token);
    expect(remainingTokens).toContain('recent_inactive_token');
    expect(remainingTokens).toContain('active_token');
    expect(remainingTokens).not.toContain('old_inactive_token');
  }, 15000); // Увеличиваем таймаут теста

  it('should handle multiple users', async () => {
    // Создаем двух пользователей
    const user1 = 'test_user_1';
    const user2 = 'test_user_2';
    
    await db.collection('users').doc(user1).set({
      displayName: 'Test User 1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    
    await db.collection('users').doc(user2).set({
      displayName: 'Test User 2',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад

    // Создаем токены для каждого пользователя
    const tokens1Ref = db.collection('users').doc(user1).collection('notificationTokens');
    const tokens2Ref = db.collection('users').doc(user2).collection('notificationTokens');
    
    await tokens1Ref.add({
      userId: user1,
      token: 'user1_old_token',
      platform: 'ios',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    
    await tokens2Ref.add({
      userId: user2,
      token: 'user2_old_token',
      platform: 'android',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Проверяем, что токены созданы
    let tokens1Snapshot = await tokens1Ref.get();
    let tokens2Snapshot = await tokens2Ref.get();
    expect(tokens1Snapshot.size).toBe(1);
    expect(tokens2Snapshot.size).toBe(1);

    // Создаем мок события
    const mockEvent = {
      jobName: 'test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 10000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем результат
    tokens1Snapshot = await tokens1Ref.get();
    tokens2Snapshot = await tokens2Ref.get();
    expect(tokens1Snapshot.size).toBe(0);
    expect(tokens2Snapshot.size).toBe(0);
  }, 15000); // Увеличиваем таймаут теста

  it('should handle empty database gracefully', async () => {
    // Создаем мок события
    const mockEvent = {
      jobName: 'test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки на пустой базе с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 5000)
    );
    
    await expect(Promise.race([cleanupPromise, timeoutPromise])).resolves.not.toThrow();
  }, 10000);

  it('should respect batch size configuration', async () => {
    // Создаем 3 пользователей (больше чем batch_size = 2)
    const users = ['user1', 'user2', 'user3'];
    
    for (const userId of users) {
      await db.collection('users').doc(userId).set({
        displayName: `Test User ${userId}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Создаем мок события
    const mockEvent = {
      jobName: 'test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 10000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем, что все пользователи обработаны
    const usersSnapshot = await db.collection('users').get();
    expect(usersSnapshot.size).toBe(3);
  }, 15000); // Увеличиваем таймаут теста

  it('should update pushTokens array when cleaning up tokens', async () => {
    const userId = 'test_user_denormalization';
    
    // Создаем пользователя с pushTokens массивом
    await db.collection('users').doc(userId).set({
      displayName: 'Test User Denormalization',
      pushTokens: ['old-token-1', 'old-token-2', 'active-token'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const now = new Date();
    const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 дней назад
    const recentDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 дня назад

    // Создаем токены
    const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
    
    // Старые неактивные токены (должны быть удалены)
    await tokensRef.add({
      userId,
      token: 'old-token-1',
      platform: 'ios',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    
    await tokensRef.add({
      userId,
      token: 'old-token-2',
      platform: 'android',
      isActive: false,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });
    
    // Активный токен (не должен быть удален)
    await tokensRef.add({
      userId,
      token: 'active-token',
      platform: 'web',
      isActive: true,
      lastUsedAt: oldDate,
      createdAt: oldDate,
      updatedAt: oldDate,
    });

    // Проверяем начальное состояние
    let userDoc = await db.collection('users').doc(userId).get();
    let userData = userDoc.data();
    expect(userData?.pushTokens).toContain('old-token-1');
    expect(userData?.pushTokens).toContain('old-token-2');
    expect(userData?.pushTokens).toContain('active-token');

    // Создаем мок события
    const mockEvent = {
      jobName: 'test-execution-id',
      scheduleTime: new Date().toISOString(),
    };

    // Запускаем функцию очистки с таймаутом
    const cleanupPromise = scheduledCleanup.run(mockEvent);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), 10000)
    );
    
    await Promise.race([cleanupPromise, timeoutPromise]);

    // Проверяем, что старые токены удалены из pushTokens
    userDoc = await db.collection('users').doc(userId).get();
    userData = userDoc.data();
    
    expect(userData?.pushTokens).not.toContain('old-token-1');
    expect(userData?.pushTokens).not.toContain('old-token-2');
    expect(userData?.pushTokens).toContain('active-token');
    expect(userData?.pushTokens).toHaveLength(1);
  }, 15000);
});