/**
 * Базовая HTTP-инфраструктура: middleware и утилиты
 * - requestId/correlation-id
 * - логирование
 * - CORS и JSON
 * - ETag/кеширование GET
 * - простой rate-limit (in-memory)
 * - идемпотентность (in-memory TTL) для небезопасных методов
 * - единый формат ошибок
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import * as logger from 'firebase-functions/logger';

// --- Redis (Cloud Memorystore) lazy client ---
type RedisClient = {
  incr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, mode?: string, duration?: number) => Promise<'OK' | null>;
};

let redis: RedisClient | null = null;

function shouldUseRedis(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.USE_INMEMORY === 'true') return false;
  return Boolean(process.env.REDIS_URL || process.env.REDIS_HOST);
}

async function getRedis(): Promise<RedisClient | null> {
  if (!shouldUseRedis()) return null;
  if (redis) return redis;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis');
  const url = process.env.REDIS_URL;
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : 6379;
  const tls = process.env.REDIS_TLS === 'true' ? { rejectUnauthorized: false } : undefined;
  const client = url ? new IORedis(url, { tls }) : new IORedis(port, host, { tls });

  redis = client;
  return redis;
}

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
  | 'validation_failed';

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
      return 503;
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
    const requestId = (req.headers['x-request-id'] as string) || '';
    logger.info('HTTP request', {
      requestId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.on('finish', () => {
      const durationMs = Date.now() - start;
      logger.info('HTTP response', { requestId, status: res.statusCode, durationMs });
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

// Простой in-memory rate limiter per IP за окно 60 секунд
interface Counter { count: number; resetAt: number }
const rateStore: Map<string, Counter> = new Map();

export function rateLimitMiddleware(limit = 60, windowSec = 60) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const forwardedFor = (req.headers['x-forwarded-for'] as string) || '';
      const clientIp = forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
      const keyIp = clientIp;
      const now = Date.now();
      const windowMs = windowSec * 1000;
      const redisClient = await getRedis();

      let current = 0;
      let resetAt = now + windowMs;

      if (redisClient) {
        const bucketKey = `rl:${keyIp}:${Math.floor(now / windowMs)}`;
        current = await redisClient.incr(bucketKey);
        if (current === 1) {
          await redisClient.expire(bucketKey, windowSec);
        }
        // вычислим реальный reset по границе окна
        resetAt = (Math.floor(now / windowMs) + 1) * windowMs;
      } else {
        let ctr = rateStore.get(keyIp);
        if (!ctr || now > ctr.resetAt) {
          ctr = { count: 0, resetAt: now + windowMs };
          rateStore.set(keyIp, ctr);
        }
        ctr.count += 1;
        current = ctr.count;
        resetAt = ctr.resetAt;
      }

      const remaining = Math.max(0, limit - current);
      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((resetAt - now) / 1000)));
      if (current > limit) {
        res.setHeader('Retry-After', String(Math.ceil((resetAt - now) / 1000)));
        return sendError(res, { code: 'rate_limit_exceeded', message: 'Too many requests' });
      }
      next();
    })();
  };
}

// Идемпотентность для небезопасных методов с TTL (сек)
interface IdemEntry { status: number; body: unknown; storedAt: number; ttlMs: number }
const idemStore: Map<string, IdemEntry> = new Map();

// Тестовые утилиты для сброса in-memory хранилищ
export function __resetRateLimitStoreForTests(): void {
  rateStore.clear();
}

export function __resetIdempotencyStoreForTests(): void {
  idemStore.clear();
}

export function idempotencyMiddleware(ttlSec = 3600) {
  return (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next();

    const keyHeader = (req.headers['idempotency-key'] as string) || '';
    if (!keyHeader) return next();

    // Ключ учитывает маршрут и тело
    const bodyHash = crypto.createHash('sha1').update(JSON.stringify(req.body || {})).digest('hex');
    const cacheKey = `${keyHeader}:${method}:${req.path}:${bodyHash}`;
    void (async () => {
      const now = Date.now();
      const redisClient = await getRedis();
      if (redisClient) {
        const cached = await redisClient.get(`idem:${cacheKey}`);
        if (cached) {
          try {
            const value = JSON.parse(cached) as { status: number; body: unknown };
            res.status(value.status).json(value.body as Record<string, unknown>);
            return;
          } catch {
            // ignore parse error
          }
        }
        // Пытаемся поставить маркер обработки, чтобы конкуренты ждали/получали кеш
        const setRes = await redisClient.set(
          `idem:${cacheKey}`,
          JSON.stringify({ processing: true, ts: now }),
          'NX',
          ttlSec
        );

        if (setRes !== 'OK') {
          // Мы проиграли гонку. Подождём коротко, вдруг уже готов итог
          const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
          for (let i = 0; i < 5; i++) {
            const again = await redisClient.get(`idem:${cacheKey}`);
            if (again) {
              try {
                const v = JSON.parse(again) as { status?: number; body?: unknown; processing?: boolean };
                if (typeof v.status === 'number') {
                  res.status(v.status).json(v.body as Record<string, unknown>);
                  return;
                }
              } catch {
                // ignore
              }
            }
            await sleep(50);
          }
          // Результат ещё не готов — попросим клиента повторить позже
          res.setHeader('Retry-After', '1');
          return sendError(res, { code: 'failed_precondition', message: 'Request is being processed, retry later' });
        }

        const originalJson = res.json.bind(res);
        (res as Response & { json: (body: unknown) => Response }).json = (body: unknown) => {
          const status = res.statusCode || 200;
          void redisClient.set(`idem:${cacheKey}`, JSON.stringify({ status, body }), 'EX', ttlSec);
          return originalJson(body as Record<string, unknown>);
        };
        next();
        return;
      }

      // Fallback: in-memory (для тестов/локально)
      const existing = idemStore.get(cacheKey);
      if (existing && now - existing.storedAt < existing.ttlMs) {
        res.status(existing.status).json(existing.body as Record<string, unknown>);
        return;
      }
      const originalJson = res.json.bind(res);
      (res as Response & { json: (body: unknown) => Response }).json = (body: unknown) => {
        const status = res.statusCode || 200;
        idemStore.set(cacheKey, { status, body, storedAt: now, ttlMs: ttlSec * 1000 });
        return originalJson(body as Record<string, unknown>);
      };
      next();
    })();
  };
}

// Единый обработчик ошибок
export function errorHandler() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.headers['x-request-id'];
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Unhandled error', { requestId, error: message });
    if (err && typeof err === 'object' && 'code' in (err as Record<string, unknown>) && 'message' in (err as Record<string, unknown>)) {
      const apiErr = err as unknown as ApiError;
      return sendError(res, apiErr);
    }
    return sendError(res, { code: 'internal', message: 'Internal server error' });
  };
}

// Конструктор стандартного набора middleware для API
export function applyBaseMiddlewares(app: express.Express) {
  app.use(requestIdMiddleware());
  app.use(loggingMiddleware());
  app.use(corsMiddleware());
  app.use(jsonMiddleware());
  app.use(etagMiddleware());
  app.use(rateLimitMiddleware());
  app.use(idempotencyMiddleware());
}


