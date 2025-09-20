/**
 * Middleware для обеспечения идемпотентности запросов
 * 
 * Поддерживает заголовок Idempotency-Key для мутационных операций (POST, PATCH, PUT, DELETE).
 * Повторные запросы с тем же ключом возвращают кэшированный ответ в течение TTL.
 * 
 * Использует Firestore для распределенного хранения ключей идемпотентности.
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { sendError } from './http';

export interface IdempotencyOptions {
  /** TTL для ключей идемпотентности в секундах (по умолчанию 1 час) */
  ttlSec?: number;
  /** Максимальная длина ключа идемпотентности */
  maxKeyLength?: number;
  /** Минимальная длина ключа идемпотентности */
  minKeyLength?: number;
  /** Разрешенные методы для идемпотентности */
  allowedMethods?: string[];
}

export interface IdempotencyResult {
  /** Статус обработки ключа */
  status: 'proceed' | 'cached' | 'retry' | 'invalid';
  /** Кэшированный ответ (если status === 'cached') */
  cachedResponse?: {
    status: number;
    body: unknown;
  };
  /** Время до истечения TTL в секундах */
  retryAfter?: number;
}

const DEFAULT_OPTIONS: Required<IdempotencyOptions> = {
  ttlSec: 3600, // 1 час
  maxKeyLength: 128,
  minKeyLength: 8,
  allowedMethods: ['POST', 'PATCH', 'PUT', 'DELETE']
};

/**
 * Middleware для обработки идемпотентности запросов
 */
export function idempotencyMiddleware(options: IdempotencyOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return async (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    
    // Проверяем, поддерживается ли метод для идемпотентности
    if (!opts.allowedMethods.includes(method)) {
      return next();
    }

    const keyHeader = (req.headers['idempotency-key'] as string) || '';
    
    // Если ключ не предоставлен, пропускаем middleware
    if (!keyHeader) {
      return next();
    }

    // Валидация ключа
    if (keyHeader.length < opts.minKeyLength || keyHeader.length > opts.maxKeyLength) {
      return sendError(res, {
        code: 'invalid_argument',
        message: `Idempotency key must be between ${opts.minKeyLength} and ${opts.maxKeyLength} characters`,
        details: { keyLength: keyHeader.length }
      });
    }

    // Проверяем формат ключа (должен быть безопасным для использования в URL)
    if (!/^[a-zA-Z0-9_-]+$/.test(keyHeader)) {
      return sendError(res, {
        code: 'invalid_argument',
        message: 'Idempotency key contains invalid characters',
        details: { allowedChars: 'a-z, A-Z, 0-9, _, -' }
      });
    }

    try {
      const result = await processIdempotencyKey(keyHeader, opts.ttlSec);
      
      switch (result.status) {
        case 'cached':
          logger.info('Returning cached response for idempotency key', {
            key: keyHeader,
            status: result.cachedResponse?.status,
            requestId: req.headers['x-request-id']
          });
          return res.status(result.cachedResponse?.status || 200).json(result.cachedResponse?.body);
          
        case 'retry':
          res.setHeader('Retry-After', String(result.retryAfter || 1));
          return sendError(res, {
            code: 'failed_precondition',
            message: 'Request is being processed, retry later',
            details: { retryAfter: result.retryAfter }
          });
          
        case 'invalid':
          return sendError(res, {
            code: 'invalid_argument',
            message: 'Invalid idempotency key'
          });
          
        case 'proceed':
        default:
          // Перехватываем ответ для сохранения в кэш
          interceptResponseForCaching(req, res, keyHeader, opts.ttlSec);
          return next();
      }
    } catch (error) {
      logger.error('Idempotency processing failed', {
        key: keyHeader,
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.headers['x-request-id']
      });
      
      // В случае ошибки продолжаем выполнение запроса
      return next();
    }
  };
}

/**
 * Обработка ключа идемпотентности в Firestore
 */
async function processIdempotencyKey(key: string, ttlSec: number): Promise<IdempotencyResult> {
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  const idempotencyRef = db.collection('idempotencyKeys').doc(keyHash);
  const now = new Date();

  return await db.runTransaction(async (transaction) => {
    const doc = await transaction.get(idempotencyRef);
    
    if (doc.exists) {
      const data = doc.data() as {
        status?: string;
        responseBody?: string;
        responseStatus?: number;
        expiresAt?: FirebaseFirestore.Timestamp;
        createdAt?: FirebaseFirestore.Timestamp;
      };
      
      const existingExpiresDate = data?.expiresAt?.toDate();
      
      // Проверяем, не истек ли ключ
      if (!existingExpiresDate || existingExpiresDate < now) {
        transaction.delete(idempotencyRef);
        return { status: 'proceed' };
      }
      
      // Проверяем статус обработки
      if (data?.status === 'pending') {
        const retryAfter = Math.max(1, Math.ceil((existingExpiresDate.getTime() - now.getTime()) / 1000));
        return { status: 'retry', retryAfter };
      }
      
      // Возвращаем кэшированный ответ
      if (data?.status === 'completed' && 
          typeof data.responseStatus === 'number' && 
          typeof data.responseBody === 'string') {
        try {
          const body = JSON.parse(data.responseBody);
          return {
            status: 'cached',
            cachedResponse: {
              status: data.responseStatus,
              body
            }
          };
        } catch (parseError) {
          logger.error('Failed to parse cached response', { key, error: parseError });
          transaction.delete(idempotencyRef);
          return { status: 'proceed' };
        }
      }
    }
    
    // Создаем новую запись для обработки
    transaction.set(idempotencyRef, {
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now.getTime() + ttlSec * 1000),
    });
    
    return { status: 'proceed' };
  });
}

/**
 * Перехватывает ответ для сохранения в кэш идемпотентности
 */
function interceptResponseForCaching(
  req: Request, 
  res: Response, 
  key: string, 
  ttlSec: number
): void {
  const keyHash = crypto.createHash('sha256').update(key).digest('hex');
  // Создаем ссылку на документ для кэширования
  db.collection('idempotencyKeys').doc(keyHash);
  
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);
  
  // Перехватываем JSON ответы
  (res as Response & { json: (body: unknown) => Response }).json = (body: unknown) => {
    saveResponseToCache(keyHash, res.statusCode || 200, body, ttlSec);
    return originalJson(body as Record<string, unknown>);
  };
  
  // Перехватываем текстовые ответы
  (res as Response & { send: (body: unknown) => Response }).send = (body: unknown) => {
    saveResponseToCache(keyHash, res.statusCode || 200, body, ttlSec);
    return originalSend(body);
  };
  
  // Перехватываем завершение ответа
  (res as Response & { end: (body?: unknown) => Response }).end = (body?: unknown) => {
    if (body !== undefined) {
      saveResponseToCache(keyHash, res.statusCode || 200, body, ttlSec);
    }
    return originalEnd(body);
  };
}

/**
 * Сохранение ответа в кэш идемпотентности
 */
async function saveResponseToCache(
  keyHash: string, 
  statusCode: number, 
  body: unknown, 
  ttlSec: number
): Promise<void> {
  try {
    const idempotencyRef = db.collection('idempotencyKeys').doc(keyHash);
    const now = new Date();
    
    const responseToSave = {
      status: 'completed',
      responseStatus: statusCode,
      responseBody: JSON.stringify(body),
      completedAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now.getTime() + ttlSec * 1000),
    };
    
    await idempotencyRef.set(responseToSave, { merge: true });
    
    logger.info('Response cached for idempotency', {
      keyHash,
      statusCode,
      ttlSec
    });
  } catch (error) {
    logger.error('Failed to save idempotency response', {
      keyHash,
      statusCode,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Утилита для очистки истекших ключей идемпотентности
 * Может использоваться в scheduled функциях
 */
export async function cleanupExpiredIdempotencyKeys(): Promise<number> {
  const now = new Date();
  const expiredKeysQuery = db.collection('idempotencyKeys')
    .where('expiresAt', '<', now)
    .limit(100); // Ограничиваем количество для избежания таймаутов
  
  const snapshot = await expiredKeysQuery.get();
  
  if (snapshot.empty) {
    return 0;
  }
  
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  
  logger.info('Cleaned up expired idempotency keys', {
    count: snapshot.docs.length
  });
  
  return snapshot.docs.length;
}

/**
 * Утилита для получения статистики по ключам идемпотентности
 */
export async function getIdempotencyStats(): Promise<{
  total: number;
  pending: number;
  completed: number;
  expired: number;
}> {
  const now = new Date();
  
  const [totalSnapshot, pendingSnapshot, completedSnapshot, expiredSnapshot] = await Promise.all([
    db.collection('idempotencyKeys').count().get(),
    db.collection('idempotencyKeys').where('status', '==', 'pending').count().get(),
    db.collection('idempotencyKeys').where('status', '==', 'completed').count().get(),
    db.collection('idempotencyKeys').where('expiresAt', '<', now).count().get()
  ]);
  
  return {
    total: totalSnapshot.data().count,
    pending: pendingSnapshot.data().count,
    completed: completedSnapshot.data().count,
    expired: expiredSnapshot.data().count
  };
}

/**
 * Тестовые утилиты для сброса состояния
 */
export async function __resetIdempotencyStoreForTests(): Promise<void> {
  const snapshot = await db.collection('idempotencyKeys').get();
  const batch = db.batch();
  
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  if (!snapshot.empty) {
    await batch.commit();
  }
}


