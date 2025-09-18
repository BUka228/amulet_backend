/**
 * Тестовый API endpoint для демонстрации middleware аутентификации
 */

import { onRequest } from 'firebase-functions/https';
import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken, verifyAppCheck } from '../core/auth';
import { applyBaseMiddlewares, errorHandler } from '../core/http';
import { i18nMiddleware } from '../core/i18n';
import { usersRouter } from './users';
import { devicesRouter } from './devices';
import { hugsRouter } from './hugs';
import { pairsRouter } from './pairs';
import { practicesRouter } from './practices';
import { patternsRouter } from './patterns';
import { adminRouter } from './admin';
// no-op

const app = express();

// Базовый набор общих middleware (request-id, логирование, CORS, JSON, ETag, rate-limit, идемпотентность)
applyBaseMiddlewares(app);

// Middleware для интернационализации
app.use(i18nMiddleware());

// Тестовый мидлварь для эмуляции аутентификации
if (process.env.NODE_ENV === 'test') {
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const testUid = (req.headers['x-test-uid'] as string) || '';
    const testAdmin = (req.headers['x-test-admin'] as string) || '';
    if (!req.auth && testUid) {
      // Эмулируем аутентификацию тестового пользователя только при наличии X-Test-Uid
      (req as unknown as { auth: unknown }).auth = {
        user: {
          uid: testUid,
          email: 'test@example.com',
          displayName: 'Test User',
          photoURL: '',
          emailVerified: true,
          disabled: false,
          metadata: {},
          customClaims: testAdmin === '1' ? { admin: true } : {}
        },
        token: 'test-token',
        isAuthenticated: true
      };
    }
    next();
  });
}

// Публичный endpoint (не требует аутентификации)
app.get('/public', (req: Request, res: Response) => {
  res.json({
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString()
  });
});

// Версионированный префикс /v1
app.use('/v1', usersRouter);
app.use('/v1', devicesRouter);
app.use('/v1', hugsRouter);
app.use('/v1', pairsRouter);
app.use('/v1', practicesRouter);
app.use('/v1', patternsRouter);
app.use('/v1', adminRouter);

// Защищенный endpoint (требует аутентификации)
app.get('/protected', authenticateToken(), (req: Request, res: Response) => {
  res.json({
    message: 'This is a protected endpoint',
    user: req.auth?.user,
    timestamp: new Date().toISOString()
  });
});

// Endpoint с проверкой App Check
app.get('/app-check', verifyAppCheck, (req: Request, res: Response) => {
  res.json({
    message: 'This endpoint requires App Check',
    appCheck: req.appCheck,
    timestamp: new Date().toISOString()
  });
});

// Endpoint с проверкой роли
app.get('/admin', 
  authenticateToken({ requireCustomClaim: 'admin' }),
  (req: Request, res: Response) => {
    res.json({
      message: 'This is an admin-only endpoint',
      user: req.auth?.user,
      timestamp: new Date().toISOString()
    });
  }
);

// Endpoint с проверкой подтверждения email
app.get('/verified', 
  authenticateToken({ requireEmailVerified: true }),
  (req: Request, res: Response) => {
    res.json({
      message: 'This endpoint requires verified email',
      user: req.auth?.user,
      timestamp: new Date().toISOString()
    });
  }
);

// Endpoint с анонимным доступом
app.get('/optional-auth', 
  authenticateToken({ allowAnonymous: true }),
  (req: Request, res: Response) => {
    res.json({
      message: 'This endpoint allows anonymous access',
      user: req.auth?.user ?? null,
      isAuthenticated: req.auth?.isAuthenticated ?? false,
      timestamp: new Date().toISOString()
    });
  }
);

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    code: 'not_found',
    message: 'Endpoint not found'
  });
});

// Единый обработчик ошибок (последним)
app.use(errorHandler());

// Экспорт Cloud Function
export const api = onRequest(app);

// Экспортируем app для тестов
export { app };
