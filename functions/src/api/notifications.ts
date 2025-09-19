import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';

const registerSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ios', 'android', 'web']).optional(),
}).strict();

const unregisterSchema = z.object({
  token: z.string().min(10).max(4096),
}).strict();

function validateBody(schema: 'register' | 'unregister') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'register') {
        registerSchema.parse(req.body ?? {});
      } else {
        unregisterSchema.parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

export const notificationsRouter = express.Router();

notificationsRouter.use(authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' }));

notificationsRouter.post('/notifications.tokens', validateBody('register'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { token, platform } = (req.body ?? {}) as { token: string; platform?: 'ios' | 'android' | 'web' };
  try {
    const userRef = db.collection('users').doc(uid);
    let snap = await userRef.get();
    if (!snap.exists) {
      // Автоинициализация профиля для регистрации токена (упрощает первый запуск клиента)
      await userRef.set({ id: uid, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pushTokens: [] }, { merge: true });
      snap = await userRef.get();
    }
    const current = (snap.data()?.pushTokens ?? []) as string[];
    const tokens = new Set(current);
    tokens.add(token);
    if (tokens.size > 20) {
      return sendError(res, { code: 'resource_exhausted', message: 'Too many tokens registered' });
    }
    await userRef.update({ pushTokens: Array.from(tokens) });
    logger.info('FCM token registered', { userId: uid, platform, tokensCount: tokens.size });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Failed to register FCM token', {
      userId: uid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

notificationsRouter.delete('/notifications.tokens', validateBody('unregister'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { token } = (req.body ?? {}) as { token: string };
  try {
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      // Нечего отвязывать — считаем успешным
      return res.status(200).json({ ok: true });
    }
    const current = (snap.data()?.pushTokens ?? []) as string[];
    const tokens = new Set(current);
    tokens.delete(token);
    await userRef.update({ pushTokens: Array.from(tokens) });
    logger.info('FCM token unregistered', { userId: uid, tokensCount: tokens.size });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Failed to unregister FCM token', {
      userId: uid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default notificationsRouter;


