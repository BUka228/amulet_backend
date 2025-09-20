/**
 * Middleware для ограничения частоты запросов (Rate Limiting)
 * 
 * Поддерживает различные стратегии лимитирования:
 * - По IP адресу
 * - По пользователю (если аутентифицирован)
 * - По комбинации IP + пользователь
 * 
 * Использует Firestore для распределенного хранения счетчиков.
 * Поддерживает конфигурацию через Remote Config.
 */

import { Request, Response, NextFunction } from 'express';
import * as logger from 'firebase-functions/logger';
import { db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { sendError } from './http';
import { 
  getDefaultRateLimitConfig,
  getMobileRateLimitConfig,
  getAdminRateLimitConfig,
  getHugsRateLimitConfig,
  getWebhooksRateLimitConfig,
  getPublicRateLimitConfig
} from './remoteConfig';

export interface RateLimitOptions {
  /** Максимальное количество запросов в окне */
  limit?: number;
  /** Размер окна в секундах */
  windowSec?: number;
  /** Стратегия идентификации клиента */
  strategy?: 'ip' | 'user' | 'ip-user';
  /** Префикс для ключей в Firestore */
  keyPrefix?: string;
  /** Включить заголовки Rate-Limit в ответ */
  includeHeaders?: boolean;
  /** Кастомная функция для извлечения ключа */
  keyExtractor?: (req: Request) => string;
}

export interface RateLimitResult {
  /** Можно ли выполнить запрос */
  allowed: boolean;
  /** Оставшееся количество запросов */
  remaining: number;
  /** Время сброса счетчика в секундах */
  resetTime: number;
  /** Общее ограничение */
  limit: number;
}

const DEFAULT_OPTIONS: Required<RateLimitOptions> = {
  limit: 60,
  windowSec: 60,
  strategy: 'ip-user',
  keyPrefix: 'rate_limit',
  includeHeaders: true,
  keyExtractor: (req: Request) => {
    // По умолчанию используем стратегию ip-user
    const forwardedFor = (req.headers['x-forwarded-for'] as string) || '';
    const clientIp = forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
    const userId = (req as unknown as { auth?: { user?: { uid?: string } } }).auth?.user?.uid;
    
    if (userId) {
      return `${clientIp}:${userId}`;
    }
    return clientIp;
  }
};

/**
 * Middleware для ограничения частоты запросов
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Получаем конфигурацию из Remote Config
      const remoteConfig = await getDefaultRateLimitConfig();
      
      // Объединяем с переданными опциями (переданные опции имеют приоритет)
      const opts = { 
        ...DEFAULT_OPTIONS, 
        limit: remoteConfig.limit,
        windowSec: remoteConfig.windowSec,
        ...options 
      };
      
      const key = opts.keyExtractor(req);
      const result = await checkRateLimit(key, opts);
      
      // Добавляем заголовки в ответ
      if (opts.includeHeaders) {
        res.setHeader('X-RateLimit-Limit', String(opts.limit));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
        res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetTime / 1000)));
        res.setHeader('Retry-After', String(Math.ceil((result.resetTime - Date.now()) / 1000)));
      }
      
      if (!result.allowed) {
        logger.warn('Rate limit exceeded', {
          key,
          limit: opts.limit,
          windowSec: opts.windowSec,
          requestId: req.headers['x-request-id'],
          ip: req.ip,
          userId: (req as unknown as { auth?: { user?: { uid?: string } } }).auth?.user?.uid
        });
        
        return sendError(res, {
          code: 'rate_limit_exceeded',
          message: 'Too many requests',
          details: {
            limit: opts.limit,
            windowSec: opts.windowSec,
            retryAfter: Math.ceil((result.resetTime - Date.now()) / 1000)
          }
        });
      }
      
      next();
    } catch (error) {
      logger.error('Rate limit check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId: req.headers['x-request-id']
      });
      
      // В случае ошибки продолжаем выполнение запроса
      next();
    }
  };
}

/**
 * Проверка лимита запросов для конкретного ключа
 */
async function checkRateLimit(
  key: string, 
  options: Required<RateLimitOptions>
): Promise<RateLimitResult> {
  const rateLimitRef = db.collection('rateLimits').doc(`${options.keyPrefix}:${key}`);
  const now = new Date();
  const windowMs = options.windowSec * 1000;
  const expiresAt = new Date(now.getTime() + windowMs);

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(rateLimitRef);
    
    if (!snap.exists) {
      // Создаем новую запись
      transaction.set(rateLimitRef, {
        count: 1,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        lastRequestAt: FieldValue.serverTimestamp()
      });
      
      return {
        allowed: true,
        remaining: options.limit - 1,
        resetTime: expiresAt.getTime(),
        limit: options.limit
      };
    }
    
    const data = snap.data() as {
      count?: number;
      expiresAt?: FirebaseFirestore.Timestamp;
      createdAt?: FirebaseFirestore.Timestamp;
    };
    
    const existingExpiresDate = data?.expiresAt?.toDate();
    
    // Проверяем, не истекло ли окно
    if (!existingExpiresDate || existingExpiresDate < now) {
      // Создаем новое окно
      transaction.set(rateLimitRef, {
        count: 1,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        lastRequestAt: FieldValue.serverTimestamp()
      });
      
      return {
        allowed: true,
        remaining: options.limit - 1,
        resetTime: expiresAt.getTime(),
        limit: options.limit
      };
    }
    
    const currentCount = data?.count || 0;
    
    // Проверяем, не превышен ли лимит
    if (currentCount >= options.limit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: existingExpiresDate.getTime(),
        limit: options.limit
      };
    }
    
    // Увеличиваем счетчик
    transaction.update(rateLimitRef, {
      count: FieldValue.increment(1),
      lastRequestAt: FieldValue.serverTimestamp()
    });
    
    return {
      allowed: true,
      remaining: options.limit - (currentCount + 1),
      resetTime: existingExpiresDate.getTime(),
      limit: options.limit
    };
  });
}

/**
 * Специализированные middleware для разных типов лимитов
 */

/**
 * Лимит для мобильных приложений (конфигурируется через Remote Config)
 */
export function mobileRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getMobileRateLimitConfig();
      const middleware = rateLimitMiddleware({
        limit: config.limit,
        windowSec: config.windowSec,
        strategy: 'user',
        keyPrefix: 'mobile'
      });
      return middleware(req, res, next);
    } catch (error) {
      logger.error('Mobile rate limit config error', { error });
      next();
    }
  };
}

/**
 * Лимит для админки (конфигурируется через Remote Config)
 */
export function adminRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getAdminRateLimitConfig();
      const middleware = rateLimitMiddleware({
        limit: config.limit,
        windowSec: config.windowSec,
        strategy: 'user',
        keyPrefix: 'admin'
      });
      return middleware(req, res, next);
    } catch (error) {
      logger.error('Admin rate limit config error', { error });
      next();
    }
  };
}

/**
 * Строгий лимит для отправки "объятий" (конфигурируется через Remote Config)
 */
export function hugsRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getHugsRateLimitConfig();
      const middleware = rateLimitMiddleware({
        limit: config.limit,
        windowSec: config.windowSec,
        strategy: 'user',
        keyPrefix: 'hugs'
      });
      return middleware(req, res, next);
    } catch (error) {
      logger.error('Hugs rate limit config error', { error });
      next();
    }
  };
}

/**
 * Лимит для вебхуков (конфигурируется через Remote Config)
 */
export function webhooksRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getWebhooksRateLimitConfig();
      const middleware = rateLimitMiddleware({
        limit: config.limit,
        windowSec: config.windowSec,
        strategy: 'ip',
        keyPrefix: 'webhooks'
      });
      return middleware(req, res, next);
    } catch (error) {
      logger.error('Webhooks rate limit config error', { error });
      next();
    }
  };
}

/**
 * Лимит для публичных эндпоинтов (конфигурируется через Remote Config)
 */
export function publicRateLimit() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const config = await getPublicRateLimitConfig();
      const middleware = rateLimitMiddleware({
        limit: config.limit,
        windowSec: config.windowSec,
        strategy: 'ip',
        keyPrefix: 'public'
      });
      return middleware(req, res, next);
    } catch (error) {
      logger.error('Public rate limit config error', { error });
      next();
    }
  };
}

/**
 * Утилита для получения текущего статуса лимита
 */
export async function getRateLimitStatus(
  key: string, 
  options: Required<RateLimitOptions>
): Promise<RateLimitResult | null> {
  const rateLimitRef = db.collection('rateLimits').doc(`${options.keyPrefix}:${key}`);
  const snap = await rateLimitRef.get();
  
  if (!snap.exists) {
    return null;
  }
  
  const data = snap.data() as {
    count?: number;
    expiresAt?: FirebaseFirestore.Timestamp;
  };
  
  const now = new Date();
  const existingExpiresDate = data?.expiresAt?.toDate();
  
  if (!existingExpiresDate || existingExpiresDate < now) {
    return null;
  }
  
  const currentCount = data?.count || 0;
  
  return {
    allowed: currentCount < options.limit,
    remaining: Math.max(0, options.limit - currentCount),
    resetTime: existingExpiresDate.getTime(),
    limit: options.limit
  };
}

/**
 * Утилита для очистки истекших записей лимитов
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  const now = new Date();
  const expiredLimitsQuery = db.collection('rateLimits')
    .where('expiresAt', '<', now)
    .limit(100); // Ограничиваем количество для избежания таймаутов
  
  const snapshot = await expiredLimitsQuery.get();
  
  if (snapshot.empty) {
    return 0;
  }
  
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  
  logger.info('Cleaned up expired rate limits', {
    count: snapshot.docs.length
  });
  
  return snapshot.docs.length;
}

/**
 * Утилита для получения статистики по лимитам
 */
export async function getRateLimitStats(): Promise<{
  total: number;
  byPrefix: Record<string, number>;
  expired: number;
}> {
  const now = new Date();
  
  const [totalSnapshot, expiredSnapshot] = await Promise.all([
    db.collection('rateLimits').count().get(),
    db.collection('rateLimits').where('expiresAt', '<', now).count().get()
  ]);
  
  // Получаем статистику по префиксам
  const prefixes = ['rate_limit', 'mobile', 'admin', 'hugs', 'webhooks', 'public'];
  const byPrefix: Record<string, number> = {};
  
  for (const prefix of prefixes) {
    const snapshot = await db.collection('rateLimits')
      .where('__name__', '>=', `${prefix}:`)
      .where('__name__', '<', `${prefix}:~`)
      .count()
      .get();
    byPrefix[prefix] = snapshot.data().count;
  }
  
  return {
    total: totalSnapshot.data().count,
    byPrefix,
    expired: expiredSnapshot.data().count
  };
}

/**
 * Утилита для сброса лимита для конкретного ключа
 */
export async function resetRateLimit(
  key: string, 
  prefix = 'rate_limit'
): Promise<void> {
  const rateLimitRef = db.collection('rateLimits').doc(`${prefix}:${key}`);
  await rateLimitRef.delete();
  
  logger.info('Rate limit reset', { key, prefix });
}

/**
 * Тестовые утилиты для сброса состояния
 */
export async function __resetRateLimitStoreForTests(): Promise<void> {
  const snapshot = await db.collection('rateLimits').get();
  const batch = db.batch();
  
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  
  if (!snapshot.empty) {
    await batch.commit();
  }
}


