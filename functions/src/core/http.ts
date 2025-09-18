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
import { db } from './firebase';
import { FieldValue } from 'firebase-admin/firestore';

// Redis client removed: using Firestore for distributed coordination

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
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const forwardedFor = (req.headers['x-forwarded-for'] as string) || '';
      const clientIp = forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
      const key = (req as unknown as { auth?: { user?: { uid?: string } } }).auth?.user?.uid || clientIp;

      const now = new Date();
      const rateLimitRef = db.collection('rateLimits').doc(key);

      const { remaining, resetSeconds } = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(rateLimitRef);
        const expiresAt = new Date(now.getTime() + windowSec * 1000);
        if (!snap.exists) {
          transaction.set(rateLimitRef, { count: 1, expiresAt });
          return { remaining: limit - 1, resetSeconds: windowSec };
        }
        const data = snap.data() as { count?: number; expiresAt?: FirebaseFirestore.Timestamp } | undefined;
        const existingExpiresDate = data?.expiresAt?.toDate();
        if (!existingExpiresDate || existingExpiresDate < now) {
          transaction.set(rateLimitRef, { count: 1, expiresAt });
          return { remaining: limit - 1, resetSeconds: windowSec };
        }
        const countValue = data?.count;
        const currentCount = typeof countValue === 'number' ? countValue : 0;
        if (currentCount >= limit) {
          const secondsLeft = Math.max(1, Math.ceil((existingExpiresDate.getTime() - now.getTime()) / 1000));
          return { remaining: -1, resetSeconds: secondsLeft };
        }
        transaction.update(rateLimitRef, { count: FieldValue.increment(1) });
        const secondsLeft = Math.max(1, Math.ceil((existingExpiresDate.getTime() - now.getTime()) / 1000));
        return { remaining: limit - (currentCount + 1), resetSeconds: secondsLeft };
      });

      res.setHeader('X-RateLimit-Limit', String(limit));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, remaining)));
      res.setHeader('Retry-After', String(resetSeconds));

      if (remaining < 0) {
        return sendError(res, { code: 'rate_limit_exceeded', message: 'Too many requests' });
      }
      next();
    } catch (error) {
      logger.error('Rate limit check failed', { error });
      next();
    }
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
  return async (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return next();

    const keyHeader = (req.headers['idempotency-key'] as string) || '';
    if (!keyHeader) return next();

    // Ключ формируем из заголовка; тело может меняться, но ключ определяет идемпотентность
    const keyHash = crypto.createHash('sha256').update(keyHeader).digest('hex');
    const idempotencyRef = db.collection('idempotencyKeys').doc(keyHash);
    const now = new Date();

    try {
      const result = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(idempotencyRef);
        if (doc.exists) {
          const data = doc.data() as {
            status?: string;
            responseBody?: string;
            responseStatus?: number;
            expiresAt?: FirebaseFirestore.Timestamp;
          };
          const existingExpiresDate = data?.expiresAt?.toDate();
          if (existingExpiresDate && existingExpiresDate < now) {
            transaction.delete(idempotencyRef);
            return 'proceed' as const;
          }
          if (data?.status === 'pending') {
            return 'retry' as const;
          }
          if (data?.status === 'completed' && typeof data.responseStatus === 'number' && typeof data.responseBody === 'string') {
            return { status: data.responseStatus, body: JSON.parse(data.responseBody) } as const;
          }
        }
        transaction.set(idempotencyRef, {
          status: 'pending',
          createdAt: FieldValue.serverTimestamp(),
          expiresAt: new Date(now.getTime() + ttlSec * 1000),
        });
        return 'proceed' as const;
      });

      if (result === 'retry') {
        res.setHeader('Retry-After', '1');
        return sendError(res, { code: 'failed_precondition', message: 'Request is being processed, retry later' });
      }

      if (typeof result === 'object') {
        return res.status(result.status).json(result.body as Record<string, unknown>);
      }

      const originalJson = res.json.bind(res);
      (res as Response & { json: (body: unknown) => Response }).json = (body: unknown) => {
        const responseToSave = {
          status: 'completed',
          responseStatus: res.statusCode || 200,
          responseBody: JSON.stringify(body),
          completedAt: FieldValue.serverTimestamp(),
        };
        void idempotencyRef.set(responseToSave, { merge: true }).catch((err) => {
          logger.error('Failed to save idempotency response', { key: keyHash, error: err });
        });
        return originalJson(body as Record<string, unknown>);
      };
      next();
    } catch (error) {
      logger.error('Idempotency check failed', { error });
      next();
    }
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


