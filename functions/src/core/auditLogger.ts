import { db } from './firebase';
import { AuditLog, Timestamp } from '../types/firestore';
import * as logger from 'firebase-functions/logger';

/**
 * Утилиты для аудит-логирования изменений токенов уведомлений
 */

export interface TokenAuditContext {
  userId: string;
  tokenId: string;
  token: string;
  platform?: 'ios' | 'android' | 'web';
  appVersion?: string;
  reason?: string;
  userAgent?: string;
  ipAddress?: string;
  requestId?: string;
  source: 'api' | 'background' | 'admin';
}

export interface TokenState {
  isActive: boolean;
  lastUsedAt: Timestamp;
}

/**
 * Маскирует токен для безопасности (показывает только первые 8 символов)
 */
function maskToken(token: string): string {
  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }
  return token.substring(0, 8) + '...';
}

/**
 * Создает аудит-запись для изменения токена
 */
export async function logTokenChange(
  action: AuditLog['action'],
  context: TokenAuditContext,
  previousState?: TokenState,
  newState?: TokenState,
  severity: 'info' | 'warning' | 'error' = 'info'
): Promise<void> {
  try {
    const now = new Date();
    const timestamp: Timestamp = {
      seconds: Math.floor(now.getTime() / 1000),
      nanoseconds: (now.getTime() % 1000) * 1000000,
    };

    // Фильтруем undefined значения для Firestore
    const details: AuditLog['details'] = {
      token: maskToken(context.token),
      ...(context.platform && { platform: context.platform }),
      ...(context.appVersion && { appVersion: context.appVersion }),
      ...(context.reason && { reason: context.reason }),
      ...(previousState && { previousState }),
      ...(newState && { newState }),
    };

    const metadata: AuditLog['metadata'] = {
      source: context.source,
      ...(context.userAgent && { userAgent: context.userAgent }),
      ...(context.ipAddress && { ipAddress: context.ipAddress }),
      ...(context.requestId && { requestId: context.requestId }),
    };

    const auditLog: Omit<AuditLog, 'id'> = {
      userId: context.userId,
      action,
      resourceType: 'notification_token',
      resourceId: context.tokenId,
      details,
      metadata,
      severity,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await db.collection('auditLogs').add(auditLog);

    // Дублируем в обычные логи для мониторинга
    logger.info('Token audit logged', {
      action,
      userId: context.userId,
      tokenId: context.tokenId,
      maskedToken: maskToken(context.token),
      platform: context.platform,
      source: context.source,
      severity,
    });

  } catch (error) {
    // Не прерываем основную операцию из-за ошибки аудита
    logger.error('Failed to log token audit', {
      action,
      userId: context.userId,
      tokenId: context.tokenId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Логирует регистрацию нового токена
 */
export async function logTokenRegistration(
  context: TokenAuditContext,
  newState: TokenState
): Promise<void> {
  await logTokenChange('token_register', context, undefined, newState, 'info');
}

/**
 * Логирует деактивацию токена
 */
export async function logTokenDeactivation(
  context: TokenAuditContext,
  previousState: TokenState,
  newState: TokenState
): Promise<void> {
  await logTokenChange('token_deactivate', context, previousState, newState, 'info');
}

/**
 * Логирует реактивацию токена
 */
export async function logTokenReactivation(
  context: TokenAuditContext,
  previousState: TokenState,
  newState: TokenState
): Promise<void> {
  await logTokenChange('token_reactivate', context, previousState, newState, 'info');
}

/**
 * Логирует удаление токена при очистке
 */
export async function logTokenCleanup(
  context: TokenAuditContext,
  previousState: TokenState
): Promise<void> {
  await logTokenChange('token_cleanup', context, previousState, undefined, 'info');
}

/**
 * Логирует принудительное удаление токена
 */
export async function logTokenDeletion(
  context: TokenAuditContext,
  previousState: TokenState
): Promise<void> {
  await logTokenChange('token_delete', context, previousState, undefined, 'warning');
}

/**
 * Получает аудит-логи для пользователя
 */
export async function getUserAuditLogs(
  userId: string,
  limit = 50,
  startAfter?: string
): Promise<AuditLog[]> {
  let query = db.collection('auditLogs')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (startAfter) {
    const startAfterDoc = await db.collection('auditLogs').doc(startAfter).get();
    if (startAfterDoc.exists) {
      query = query.startAfter(startAfterDoc);
    }
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as AuditLog));
}

/**
 * Получает аудит-логи для конкретного токена
 */
export async function getTokenAuditLogs(
  tokenId: string,
  limit = 20
): Promise<AuditLog[]> {
  const snapshot = await db.collection('auditLogs')
    .where('resourceId', '==', tokenId)
    .where('resourceType', '==', 'notification_token')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as AuditLog));
}

/**
 * Получает аудит-логи по действию
 */
export async function getAuditLogsByAction(
  action: AuditLog['action'],
  limit = 100,
  startAfter?: string
): Promise<AuditLog[]> {
  let query = db.collection('auditLogs')
    .where('action', '==', action)
    .orderBy('createdAt', 'desc')
    .limit(limit);

  if (startAfter) {
    const startAfterDoc = await db.collection('auditLogs').doc(startAfter).get();
    if (startAfterDoc.exists) {
      query = query.startAfter(startAfterDoc);
    }
  }

  const snapshot = await query.get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as AuditLog));
}
