/**
 * Базовая HTTP-инфраструктура: middleware и утилиты
 * - requestId/correlation-id
 * - логирование
 * - CORS и JSON
 * - ETag/кеширование GET
 * - единый формат ошибок
 * 
 * Rate limiting и идемпотентность вынесены в отдельные модули:
 * - core/rateLimit.ts
 * - core/idempotency.ts
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { rateLimitMiddleware } from './rateLimit';
import { idempotencyMiddleware } from './idempotency';
import { log } from './structuredLogger';
import { tracingMiddleware } from './tracing';
import { metricsMiddleware } from './monitoring';
import { isMaintenanceMode, isApiV1Deprecated } from './remoteConfig';

type ErrorCode =
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_found'
  | 'invalid_argument'
  | 'failed_precondition'
  | 'already_exists'
  | 'resource_exhausted'
  | 'internal'
  | 'unavailable'
  | 'rate_limit_exceeded'
  | 'idempotency_key_conflict'
  | 'validation_failed'
  | 'maintenance_mode'
  | 'api_deprecated';

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

export function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'unauthenticated':
      return 401;
    case 'permission_denied':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid_argument':
    case 'validation_failed':
      return 400;
    case 'already_exists':
      return 409;
    case 'resource_exhausted':
    case 'rate_limit_exceeded':
      return 429;
    case 'failed_precondition':
      return 412;
    case 'unavailable':
    case 'maintenance_mode':
      return 503;
    case 'api_deprecated':
      return 410;
    default:
      return 500;
  }
}

export function sendError(res: Response, error: ApiError): void {
  res.status(mapErrorCodeToStatus(error.code)).json({ code: error.code, message: error.message, details: error.details });
}

export function requestIdMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const existing = (req.headers['x-request-id'] as string) || '';
    const requestId = existing.trim() || crypto.randomUUID();
    // присваиваем и возвращаем клиенту
    (req.headers as Record<string, string>)['x-request-id'] = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  };
}

export function loggingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    (req as Request & { startTime: number }).startTime = start;
    
    // Используем структурированное логирование
    log.request(req, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      log.response(req, res.statusCode, {
        latency: durationMs,
      });
    });

    next();
  };
}

export function corsMiddleware(allowOrigin = '*') {
  return (req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', allowOrigin);
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Firebase-AppCheck, X-Request-ID, Idempotency-Key, If-None-Match'
    );
    res.header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    next();
  };
}

export function jsonMiddleware() {
  return express.json({ limit: '1mb' });
}

// ETag/If-None-Match для GET ответов
export function etagMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') return next();

    const originalJson = res.json.bind(res);
    (res as Response & { json: (body: unknown) => Response }).json = (body: unknown) => {
      try {
        const payload = typeof body === 'string' ? body : JSON.stringify(body);
        const etag = 'W/"' + crypto.createHash('sha1').update(payload).digest('hex') + '"';
        const inm = req.headers['if-none-match'];
        res.setHeader('ETag', etag);
        if (inm && inm === etag) {
          res.status(304).end();
          return res as Response;
        }
      } catch (_) {
        // игнорируем ошибки генерации etag
      }
      return originalJson(body as Record<string, unknown>);
    };
    next();
  };
}

// Rate limiting теперь реализован в core/rateLimit.ts

// Идемпотентность теперь реализована в core/idempotency.ts

// Единый обработчик ошибок
export function errorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.headers['x-request-id'];
    const message = err instanceof Error ? err.message : String(err);
    
    // Логируем ошибку с полным контекстом
    log.error('Unhandled error', {
      requestId: requestId as string,
      error: {
        name: err instanceof Error ? err.name : 'UnknownError',
        message: message,
        stack: err instanceof Error ? err.stack : undefined,
      },
      route: `${req.method} ${req.path}`,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    if (err && typeof err === 'object' && 'code' in (err as Record<string, unknown>) && 'message' in (err as Record<string, unknown>)) {
      const apiErr = err as unknown as ApiError;
      return sendError(res, apiErr);
    }
    return sendError(res, { code: 'internal', message: 'Internal server error' });
  };
}

/**
 * Middleware для проверки режима технического обслуживания
 */
export function maintenanceModeMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const maintenanceMode = await isMaintenanceMode();
      if (maintenanceMode) {
        return sendError(res, {
          code: 'maintenance_mode',
          message: 'Service temporarily unavailable due to maintenance',
          details: { retryAfter: 3600 } // 1 час
        });
      }
      next();
    } catch (error) {
      // В случае ошибки получения конфигурации, продолжаем работу
      log.warn('Failed to check maintenance mode', { error: error instanceof Error ? error.message : 'Unknown error' });
      next();
    }
  };
}

/**
 * Middleware для проверки депрекации API v1
 */
export function apiDeprecationMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isDeprecated = await isApiV1Deprecated();
      if (isDeprecated && req.path.startsWith('/v1/')) {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', '2025-12-31T23:59:59Z'); // Пример даты окончания поддержки
        res.setHeader('Link', '</v2/>; rel="successor-version"'); // Ссылка на новую версию
      }
      next();
    } catch (error) {
      // В случае ошибки получения конфигурации, продолжаем работу
      log.warn('Failed to check API deprecation status', { error: error instanceof Error ? error.message : 'Unknown error' });
      next();
    }
  };
}

// Конструктор стандартного набора middleware для API
export function applyBaseMiddlewares(app: express.Express) {
  app.use(requestIdMiddleware());
  app.use(tracingMiddleware()); // Трейсинг должен быть первым
  app.use(metricsMiddleware()); // Метрики после трейсинга
  app.use(loggingMiddleware());
  app.use(maintenanceModeMiddleware()); // Проверка режима обслуживания
  app.use(apiDeprecationMiddleware()); // Проверка депрекации API
  app.use(corsMiddleware());
  app.use(jsonMiddleware());
  app.use(etagMiddleware());
  app.use(rateLimitMiddleware()); // Используем новый модуль
  app.use(idempotencyMiddleware()); // Используем новый модуль
}

// Экспорт тестовых функций для обратной совместимости
export { __resetRateLimitStoreForTests } from './rateLimit';
export { __resetIdempotencyStoreForTests } from './idempotency';

// Экспорт middleware для обратной совместимости
export { rateLimitMiddleware } from './rateLimit';
export { idempotencyMiddleware } from './idempotency';


