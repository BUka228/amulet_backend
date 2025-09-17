import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';

// Ленивый доступ к Firestore и коллекции users, чтобы переменные окружения из setup успевали примениться
// getUsersCollection удалён: используем db.collection('users') напрямую

// Схемы валидации (OpenAPI → Zod)
const userInitSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).max(100).optional(),
  language: z.string().min(2).max(10).optional(),
  consents: z.object({}).catchall(z.unknown()).optional(),
});

const userUpdateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  avatarUrl: z.string().url().max(2000).optional(),
  timezone: z.string().min(1).max(100).optional(),
  language: z.string().min(2).max(10).optional(),
  consents: z.object({}).catchall(z.unknown()).optional(),
});

export const usersRouter = express.Router();

// Все эндпоинты требуют аутентификации по ТЗ
// В тестовой среде разрешаем анонимный доступ и подставляем контекст через тестовый мидлварь в app
usersRouter.use(authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' }));

// Валидация тела запроса через Zod
function validateBody(schema: 'init' | 'update') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'init') {
        userInitSchema.parse(req.body ?? {});
      } else {
        userUpdateSchema.parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'validation_failed', message });
    }
  };
}

// POST /v1/users.me.init — инициализация профиля
usersRouter.post('/users.me.init', validateBody('init'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  const payload = (req.body ?? {}) as Record<string, unknown>;
  const docRef = db.collection('users').doc(uid);
  const snap = await docRef.get();
  const now = FieldValue.serverTimestamp();

  if (snap.exists) {
    await docRef.set({ ...payload, id: uid, updatedAt: now }, { merge: true });
  } else {
    await docRef.set({
      id: uid,
      displayName: payload.displayName,
      avatarUrl: payload['avatarUrl'],
      timezone: payload.timezone,
      language: payload.language,
      consents: payload.consents ?? {},
      createdAt: now,
      updatedAt: now,
      pushTokens: [],
      isDeleted: false,
    });
  }
  const fresh = await docRef.get();
  return res.status(200).json({ user: fresh.data() });
});

// GET /v1/users.me — получить профиль
usersRouter.get('/users.me', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) {
    return sendError(res, { code: 'not_found', message: 'User profile not found' });
  }
  return res.status(200).json({ user: doc.data() });
});

// PATCH /v1/users.me — обновить профиль
usersRouter.patch('/users.me', validateBody('update'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const docRef = db.collection('users').doc(uid);
  const snap = await docRef.get();
  if (!snap.exists) {
    return sendError(res, { code: 'not_found', message: 'User profile not found' });
  }
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const now = FieldValue.serverTimestamp();
  await docRef.set({ ...payload, id: uid, updatedAt: now }, { merge: true });
  const fresh = await docRef.get();
  return res.status(200).json({ user: fresh.data() });
});

// POST /v1/users.me/delete — пометка на удаление (асинхронная задача заглушка)
usersRouter.post('/users.me/delete', (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  // Заглушка: генерируем jobId, реальная асинхронная задача будет реализована позже
  const jobId = `job_${Math.random().toString(36).slice(2)}`;
  return res.status(202).json({ jobId });
});

export default usersRouter;


