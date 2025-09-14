/**
 * Тестовый API endpoint для демонстрации middleware аутентификации
 */

import { onRequest } from 'firebase-functions/https';
import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken, verifyAppCheck } from '../core/auth';
import * as logger from 'firebase-functions/logger';

const app = express();

// Middleware для парсинга JSON
app.use(express.json());

// Middleware для логирования запросов
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info('Request received', {
    method: req.method,
    path: req.path,
    requestId: req.headers['x-request-id']
  });
  next();
});

// Публичный endpoint (не требует аутентификации)
app.get('/public', (req: Request, res: Response) => {
  res.json({
    message: 'This is a public endpoint',
    timestamp: new Date().toISOString()
  });
});

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

// Обработчик ошибок (должен быть последним)
app.use((err: Error, req: express.Request, res: express.Response) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId: req.headers['x-request-id']
  });
  
  res.status(500).json({
    code: 'internal',
    message: 'Internal server error'
  });
});

// Экспорт Cloud Function
export const api = onRequest(app);

// Экспортируем app для тестов
export { app };
