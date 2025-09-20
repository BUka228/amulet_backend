import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { app } from '../../api/test';
import { db } from '../../core/firebase';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';
import { getUserAuditLogs, getTokenAuditLogs } from '../../core/auditLogger';

describe('Notification tokens audit logging integration tests', () => {
  let testEnv: RulesTestEnvironment;
  const testUid = 'test-user-audit';
  const route = '/v1/notifications.tokens';

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test-audit',
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
      displayName: 'Test User Audit',
      consents: {
        analytics: true,
        marketing: true,
        telemetry: true,
      },
      pushTokens: [],
      isDeleted: false,
      createdAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
      updatedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
    });
  });

  afterEach(async () => {
    // Очищаем тестовые данные
    const userRef = db.collection('users').doc(testUid);
    const tokensSnapshot = await userRef.collection('notificationTokens').get();
    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const batch = db.batch();
    
    tokensSnapshot.docs.forEach(tokenDoc => {
      batch.delete(tokenDoc.ref);
    });
    
    auditLogsSnapshot.docs.forEach(auditDoc => {
      batch.delete(auditDoc.ref);
    });
    
    await batch.commit();
    
    // Очищаем pushTokens массив
    await userRef.update({ pushTokens: [] });
  });

  it('should log token registration in audit logs', async () => {
    const token = 'audit-test-token-123456789';
    
    // Регистрируем токен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .set('User-Agent', 'TestApp/1.0.0')
      .set('X-Request-ID', 'test-request-123')
      .send({ token, platform: 'ios', appVersion: '1.0.0' })
      .expect(200);
    
    // Проверяем аудит-логи
    const auditLogs = await getUserAuditLogs(testUid);
    expect(auditLogs).toHaveLength(1);
    
    const auditLog = auditLogs[0];
    expect(auditLog.action).toBe('token_register');
    expect(auditLog.userId).toBe(testUid);
    expect(auditLog.resourceType).toBe('notification_token');
    expect(auditLog.details.token).toBe('audit-te...'); // Маскированный токен
    expect(auditLog.details.platform).toBe('ios');
    expect(auditLog.details.appVersion).toBe('1.0.0');
    expect(auditLog.details.reason).toBe('user_request');
    expect(auditLog.metadata.userAgent).toBe('TestApp/1.0.0');
    expect(auditLog.metadata.requestId).toBe('test-request-123');
    expect(auditLog.metadata.source).toBe('api');
    expect(auditLog.severity).toBe('info');
  });

  it('should log token deactivation in audit logs', async () => {
    const token = 'audit-test-token-deactivate';
    
    // Сначала регистрируем токен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'android' })
      .expect(200);
    
    // Получаем ID токена для проверки
    const tokensSnapshot = await db.collection('users').doc(testUid).collection('notificationTokens').get();
    const tokenId = tokensSnapshot.docs[0].id;
    
    // Деактивируем токен
    await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token })
      .expect(200);
    
    // Проверяем аудит-логи
    const auditLogs = await getUserAuditLogs(testUid);
    expect(auditLogs).toHaveLength(2); // Регистрация + деактивация
    
    const registrationLog = auditLogs.find(log => log.action === 'token_register');
    const deactivationLog = auditLogs.find(log => log.action === 'token_deactivate');
    
    expect(registrationLog).toBeDefined();
    expect(deactivationLog).toBeDefined();
    
    expect(deactivationLog?.resourceId).toBe(tokenId);
    expect(deactivationLog?.details.platform).toBe('android');
    expect(deactivationLog?.details.previousState?.isActive).toBe(true);
    expect(deactivationLog?.details.newState?.isActive).toBe(false);
  });

  it('should log token reactivation in audit logs', async () => {
    const token = 'audit-test-token-reactivate';
    
    // Регистрируем токен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'web' })
      .expect(200);
    
    // Деактивируем токен
    await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token })
      .expect(200);
    
    // Реактивируем токен (регистрируем снова)
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'web' })
      .expect(200);
    
    // Проверяем аудит-логи
    const auditLogs = await getUserAuditLogs(testUid);
    expect(auditLogs).toHaveLength(3); // Регистрация + деактивация + реактивация
    
    const reactivationLog = auditLogs.find(log => log.action === 'token_reactivate');
    expect(reactivationLog).toBeDefined();
    expect(reactivationLog?.details.platform).toBe('web');
    expect(reactivationLog?.details.previousState?.isActive).toBe(false);
    expect(reactivationLog?.details.newState?.isActive).toBe(true);
  });

  it('should include request metadata in audit logs', async () => {
    const token = 'audit-test-token-metadata';
    const userAgent = 'MyApp/2.0.0 (iOS 15.0)';
    const requestId = 'req-456-789';
    
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .set('User-Agent', userAgent)
      .set('X-Request-ID', requestId)
      .send({ token, platform: 'ios', appVersion: '2.0.0' })
      .expect(200);
    
    const auditLogs = await getUserAuditLogs(testUid);
    const auditLog = auditLogs[0];
    
    expect(auditLog.metadata.userAgent).toBe(userAgent);
    expect(auditLog.metadata.requestId).toBe(requestId);
    expect(auditLog.metadata.source).toBe('api');
  });

  it('should mask tokens correctly in audit logs', async () => {
    const shortToken = 'short-token-123'; // Минимум 10 символов для Firestore rules
    const longToken = 'very-long-token-12345678901234567890';
    
    // Тестируем короткий токен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: shortToken, platform: 'ios' })
      .expect(200);
    
    // Тестируем длинный токен
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: longToken, platform: 'android' })
      .expect(200);
    
    const auditLogs = await getUserAuditLogs(testUid);
    expect(auditLogs).toHaveLength(2);
    
    const shortTokenLog = auditLogs.find(log => log.details.token === 'short-to...');
    const longTokenLog = auditLogs.find(log => log.details.token === 'very-lon...');
    
    expect(shortTokenLog).toBeDefined();
    expect(longTokenLog).toBeDefined();
    
    // Убеждаемся, что оригинальные токены не попали в логи
    expect(auditLogs.every(log => !log.details.token?.includes(shortToken))).toBe(true);
    expect(auditLogs.every(log => !log.details.token?.includes(longToken))).toBe(true);
  });

  it('should get token-specific audit logs', async () => {
    const token1 = 'audit-token-1';
    const token2 = 'audit-token-2';
    
    // Регистрируем два токена
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: token1, platform: 'ios' })
      .expect(200);
    
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token: token2, platform: 'android' })
      .expect(200);
    
    // Получаем ID токенов
    const tokensSnapshot = await db.collection('users').doc(testUid).collection('notificationTokens').get();
    const token1Id = tokensSnapshot.docs.find(doc => doc.data().token === token1)?.id;
    const token2Id = tokensSnapshot.docs.find(doc => doc.data().token === token2)?.id;
    
    expect(token1Id).toBeDefined();
    expect(token2Id).toBeDefined();
    
    // Проверяем логи для конкретного токена
    const token1Logs = await getTokenAuditLogs(token1Id as string);
    const token2Logs = await getTokenAuditLogs(token2Id as string);
    
    expect(token1Logs).toHaveLength(1);
    expect(token2Logs).toHaveLength(1);
    
    expect(token1Logs[0].resourceId).toBe(token1Id);
    expect(token2Logs[0].resourceId).toBe(token2Id);
  });

  it('should handle multiple operations correctly', async () => {
    const token = 'audit-test-multiple-ops';
    
    // Регистрация
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'ios' })
      .expect(200);
    
    // Деактивация
    await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token })
      .expect(200);
    
    // Реактивация
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'ios' })
      .expect(200);
    
    // Еще одна деактивация
    await request(app)
      .delete(route)
      .set('X-Test-Uid', testUid)
      .send({ token })
      .expect(200);
    
    const auditLogs = await getUserAuditLogs(testUid);
    expect(auditLogs).toHaveLength(4);
    
    const actions = auditLogs.map(log => log.action);
    expect(actions).toEqual([
      'token_deactivate', // Последняя операция
      'token_reactivate',
      'token_deactivate',
      'token_register'     // Первая операция
    ]);
  });

  it('should maintain audit log integrity', async () => {
    const token = 'audit-test-integrity';
    
    await request(app)
      .post(route)
      .set('X-Test-Uid', testUid)
      .send({ token, platform: 'web', appVersion: '1.5.0' })
      .expect(200);
    
    const auditLogs = await getUserAuditLogs(testUid);
    const auditLog = auditLogs[0];
    
    // Проверяем целостность данных
    expect(auditLog.userId).toBe(testUid);
    expect(auditLog.action).toBe('token_register');
    expect(auditLog.resourceType).toBe('notification_token');
    expect(auditLog.resourceId).toBeTruthy();
    expect(auditLog.details.platform).toBe('web');
    expect(auditLog.details.appVersion).toBe('1.5.0');
    expect(auditLog.details.reason).toBe('user_request');
    expect(auditLog.details.newState?.isActive).toBe(true);
    expect(auditLog.metadata.source).toBe('api');
    expect(auditLog.severity).toBe('info');
    expect(auditLog.createdAt).toBeDefined();
    expect(auditLog.updatedAt).toBeDefined();
  });
});
