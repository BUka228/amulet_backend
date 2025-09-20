import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { db } from '../../core/firebase';
import { 
  logTokenRegistration, 
  logTokenDeactivation, 
  logTokenReactivation,
  logTokenCleanup,
  logTokenDeletion,
  getUserAuditLogs,
  getTokenAuditLogs,
  getAuditLogsByAction,
  TokenAuditContext 
} from '../../core/auditLogger';
import { Timestamp } from '../../types/firestore';

// Мокаем Firebase Functions
jest.mock('firebase-functions', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('auditLogger', () => {
  const testUserId = 'test_user_audit';
  const testTokenId = 'test_token_123';
  const testToken = 'test_fcm_token_123456789';

  beforeEach(async () => {
    // Очищаем тестовые данные
    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const batch = db.batch();
    auditLogsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  });

  afterEach(async () => {
    // Очищаем тестовые данные
    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const batch = db.batch();
    auditLogsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  });

  const createTestContext = (): TokenAuditContext => ({
    userId: testUserId,
    tokenId: testTokenId,
    token: testToken,
    platform: 'ios',
    appVersion: '1.0.0',
    reason: 'test',
    userAgent: 'TestAgent/1.0',
    ipAddress: '127.0.0.1',
    requestId: 'test-request-123',
    source: 'api',
  });

  const createTestState = (): { isActive: boolean; lastUsedAt: Timestamp } => ({
    isActive: true,
    lastUsedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 },
  });

  it('should log token registration', async () => {
    const context = createTestContext();
    const newState = createTestState();

    await logTokenRegistration(context, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(1);

    const auditLog = auditLogsSnapshot.docs[0].data();
    expect(auditLog.action).toBe('token_register');
    expect(auditLog.userId).toBe(testUserId);
    expect(auditLog.resourceId).toBe(testTokenId);
    expect(auditLog.resourceType).toBe('notification_token');
    expect(auditLog.details.token).toBe('test_fcm...'); // Маскированный токен
    expect(auditLog.details.platform).toBe('ios');
    expect(auditLog.details.appVersion).toBe('1.0.0');
    expect(auditLog.details.reason).toBe('test');
    expect(auditLog.details.newState).toEqual(newState);
    expect(auditLog.metadata.source).toBe('api');
    expect(auditLog.severity).toBe('info');
  });

  it('should log token deactivation', async () => {
    const context = createTestContext();
    const previousState = createTestState();
    const newState = { ...previousState, isActive: false };

    await logTokenDeactivation(context, previousState, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(1);

    const auditLog = auditLogsSnapshot.docs[0].data();
    expect(auditLog.action).toBe('token_deactivate');
    expect(auditLog.details.previousState).toEqual(previousState);
    expect(auditLog.details.newState).toEqual(newState);
  });

  it('should log token reactivation', async () => {
    const context = createTestContext();
    const previousState = { ...createTestState(), isActive: false };
    const newState = { ...previousState, isActive: true };

    await logTokenReactivation(context, previousState, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(1);

    const auditLog = auditLogsSnapshot.docs[0].data();
    expect(auditLog.action).toBe('token_reactivate');
    expect(auditLog.details.previousState).toEqual(previousState);
    expect(auditLog.details.newState).toEqual(newState);
  });

  it('should log token cleanup', async () => {
    const context = { ...createTestContext(), reason: 'cleanup_old_inactive' };
    const previousState = createTestState();

    await logTokenCleanup(context, previousState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(1);

    const auditLog = auditLogsSnapshot.docs[0].data();
    expect(auditLog.action).toBe('token_cleanup');
    expect(auditLog.details.previousState).toEqual(previousState);
    expect(auditLog.details.newState).toBeUndefined();
    expect(auditLog.details.reason).toBe('cleanup_old_inactive');
  });

  it('should log token deletion', async () => {
    const context = createTestContext();
    const previousState = createTestState();

    await logTokenDeletion(context, previousState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(1);

    const auditLog = auditLogsSnapshot.docs[0].data();
    expect(auditLog.action).toBe('token_delete');
    expect(auditLog.details.previousState).toEqual(previousState);
    expect(auditLog.details.newState).toBeUndefined();
    expect(auditLog.severity).toBe('warning');
  });

  it('should mask token correctly', async () => {
    const context = createTestContext();
    const newState = createTestState();

    await logTokenRegistration(context, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const auditLog = auditLogsSnapshot.docs[0].data();
    
    // Токен должен быть замаскирован
    expect(auditLog.details.token).toBe('test_fcm...');
    expect(auditLog.details.token).not.toContain(testToken);
  });

  it('should handle short tokens correctly', async () => {
    const shortTokenContext = { ...createTestContext(), token: 'short' };
    const newState = createTestState();

    await logTokenRegistration(shortTokenContext, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const auditLog = auditLogsSnapshot.docs[0].data();
    
    // Короткий токен должен быть полностью замаскирован
    expect(auditLog.details.token).toBe('*****');
  });

  it('should get user audit logs', async () => {
    // Создаем несколько аудит-логов
    const context1 = { ...createTestContext(), tokenId: 'token1' };
    const context2 = { ...createTestContext(), tokenId: 'token2' };
    const newState = createTestState();

    await logTokenRegistration(context1, newState);
    await logTokenDeactivation(context2, newState, { ...newState, isActive: false });

    const userLogs = await getUserAuditLogs(testUserId);
    expect(userLogs).toHaveLength(2);
    expect(userLogs[0].action).toBe('token_deactivate'); // Сортировка по дате desc
    expect(userLogs[1].action).toBe('token_register');
  });

  it('should get token audit logs', async () => {
    const context = createTestContext();
    const newState = createTestState();

    await logTokenRegistration(context, newState);
    await logTokenDeactivation(context, newState, { ...newState, isActive: false });

    const tokenLogs = await getTokenAuditLogs(testTokenId);
    expect(tokenLogs).toHaveLength(2);
    expect(tokenLogs[0].action).toBe('token_deactivate');
    expect(tokenLogs[1].action).toBe('token_register');
  });

  it('should get audit logs by action', async () => {
    const context1 = { ...createTestContext(), tokenId: 'token1' };
    const context2 = { ...createTestContext(), tokenId: 'token2' };
    const newState = createTestState();

    await logTokenRegistration(context1, newState);
    await logTokenRegistration(context2, newState);

    const registrationLogs = await getAuditLogsByAction('token_register');
    expect(registrationLogs).toHaveLength(2);
    expect(registrationLogs.every(log => log.action === 'token_register')).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    // Мокаем ошибку базы данных
    const originalAdd = db.collection('auditLogs').add;
    jest.spyOn(db.collection('auditLogs'), 'add').mockRejectedValueOnce(new Error('Database error'));

    const context = createTestContext();
    const newState = createTestState();

    // Функция не должна выбрасывать ошибку
    await expect(logTokenRegistration(context, newState)).resolves.not.toThrow();

    // Восстанавливаем оригинальный метод
    jest.restoreAllMocks();
  });

  it('should include metadata correctly', async () => {
    const context = createTestContext();
    const newState = createTestState();

    await logTokenRegistration(context, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    const auditLog = auditLogsSnapshot.docs[0].data();
    
    expect(auditLog.metadata.userAgent).toBe('TestAgent/1.0');
    expect(auditLog.metadata.ipAddress).toBe('127.0.0.1');
    expect(auditLog.metadata.requestId).toBe('test-request-123');
    expect(auditLog.metadata.source).toBe('api');
  });

  it('should handle different sources', async () => {
    const apiContext = { ...createTestContext(), source: 'api' as const };
    const backgroundContext = { ...createTestContext(), source: 'background' as const, tokenId: 'token2' };
    const adminContext = { ...createTestContext(), source: 'admin' as const, tokenId: 'token3' };
    const newState = createTestState();

    await logTokenRegistration(apiContext, newState);
    await logTokenRegistration(backgroundContext, newState);
    await logTokenRegistration(adminContext, newState);

    const auditLogsSnapshot = await db.collection('auditLogs').get();
    expect(auditLogsSnapshot.size).toBe(3);

    const sources = auditLogsSnapshot.docs.map(doc => doc.data().metadata.source);
    expect(sources).toContain('api');
    expect(sources).toContain('background');
    expect(sources).toContain('admin');
  });
});
