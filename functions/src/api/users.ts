import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';
import { getErrorMessage } from '../core/i18n';
import { log } from '../core/structuredLogger';

// Ленивый доступ к Firestore и коллекции users, чтобы переменные окружения из setup успевали примениться
// getUsersCollection удалён: используем db.collection('users') напрямую

// Схемы валидации (OpenAPI → Zod)
const userInitSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  timezone: z.string().min(1).max(100).optional(),
  language: z.string().min(2).max(10).optional(),
  consents: z.object({}).catchall(z.unknown()).optional(),
}).strict();

const userUpdateSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  avatarUrl: z.string().url().max(2000).optional(),
  timezone: z.string().min(1).max(100).optional(),
  language: z.string().min(2).max(10).optional(),
  consents: z.object({}).catchall(z.unknown()).optional(),
}).strict();

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
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// Утилита: удалить поля со значением undefined (Firestore не принимает undefined)
function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const cleaned: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      // @ts-expect-error: assignment by key
      cleaned[key] = value;
    }
  }
  return cleaned;
}

// POST /v1/users.me.init — инициализация профиля
usersRouter.post('/users.me.init', validateBody('init'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: getErrorMessage(req, 'auth.required') });
  }

  try {
    const payload = omitUndefined((req.body ?? {}) as Record<string, unknown>);
    const docRef = db.collection('users').doc(uid);
    const snap = await docRef.get();
    const now = FieldValue.serverTimestamp();

    if (snap.exists) {
      await docRef.set(omitUndefined({ ...payload, id: uid, updatedAt: now }), { merge: true });
    } else {
      const data = omitUndefined({
        id: uid,
        displayName: payload.displayName as string | undefined,
        avatarUrl: (payload as Record<string, unknown>)['avatarUrl'] as string | undefined,
        timezone: payload.timezone as string | undefined,
        language: payload.language as string | undefined,
        consents: (payload.consents as Record<string, unknown> | undefined) ?? {},
        createdAt: now,
        updatedAt: now,
        pushTokens: [] as string[],
        isDeleted: false,
      });
      await docRef.set(data);
    }
    const fresh = await docRef.get();
    return res.status(200).json({ user: fresh.data() });
  } catch (error) {
    log.error('Failed to initialize user profile', {
      userId: uid,
      operation: 'user_init',
      resource: 'user_profile',
    });
    return sendError(res, { 
      code: 'unavailable', 
      message: getErrorMessage(req, 'error.database_unavailable') 
    });
  }
});

// GET /v1/users.me — получить профиль
usersRouter.get('/users.me', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: getErrorMessage(req, 'auth.required') });
  }

  try {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      return sendError(res, { code: 'not_found', message: getErrorMessage(req, 'user.not_found') });
    }
    return res.status(200).json({ user: doc.data() });
  } catch (error) {
    log.error('Failed to get user profile', {
      userId: uid,
      operation: 'user_get',
      resource: 'user_profile',
    });
    return sendError(res, { 
      code: 'unavailable', 
      message: getErrorMessage(req, 'error.database_unavailable') 
    });
  }
});

// PATCH /v1/users.me — обновить профиль
usersRouter.patch('/users.me', validateBody('update'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: getErrorMessage(req, 'auth.required') });
  }

  try {
    const docRef = db.collection('users').doc(uid);
    const snap = await docRef.get();
    if (!snap.exists) {
      return sendError(res, { code: 'not_found', message: getErrorMessage(req, 'user.not_found') });
    }
    const payload = omitUndefined((req.body ?? {}) as Record<string, unknown>);
    const now = FieldValue.serverTimestamp();
    await docRef.set(omitUndefined({ ...payload, id: uid, updatedAt: now }), { merge: true });
    const fresh = await docRef.get();
    return res.status(200).json({ user: fresh.data() });
  } catch (error) {
    log.error('Failed to update user profile', {
      userId: uid,
      operation: 'user_update',
      resource: 'user_profile',
    });
    return sendError(res, { 
      code: 'unavailable', 
      message: getErrorMessage(req, 'error.database_unavailable') 
    });
  }
});

// POST /v1/users.me/delete — запрос на удаление аккаунта (асинхронно)
usersRouter.post('/users.me/delete', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: getErrorMessage(req, 'auth.required') });
  }

  try {
    // Проверяем, что пользователь существует и не удален
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return sendError(res, { code: 'not_found', message: getErrorMessage(req, 'user.not_found') });
    }

    const userData = userDoc.data();
    if (userData?.isDeleted) {
      return sendError(res, { code: 'failed_precondition', message: getErrorMessage(req, 'user.already_deleted') });
    }

    // Генерируем уникальный jobId
    const jobId = `del_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Создаем задачу удаления
    const deletionJob = {
      jobId,
      userId: uid,
      requestedAt: new Date().toISOString(),
      priority: 'normal' as const,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp()
    };

    // Сохраняем задачу в Firestore
    await db.collection('deletionJobs').doc(jobId).set(deletionJob);

    // Публикуем сообщение в Pub/Sub для асинхронной обработки
    const { PubSub } = await import('@google-cloud/pubsub');
    const pubsub = new PubSub();
    const topic = pubsub.topic('user-deletion');
    
    const message = {
      data: Buffer.from(JSON.stringify({
        jobId,
        userId: uid,
        requestedAt: deletionJob.requestedAt,
        priority: 'normal'
      }))
    };

    await topic.publishMessage(message);

    // Помечаем пользователя как удаляемого
    await userRef.update({
      isDeleting: true,
      deletionRequestedAt: FieldValue.serverTimestamp(),
      deletionJobId: jobId
    });

    log.business('user_deletion_requested', 'user_profile', 'User deletion job created', { 
      jobId, 
      userId: uid,
    });

    return res.status(202).json({ 
      jobId,
      message: getErrorMessage(req, 'user.deletion_requested')
    });

  } catch (error) {
    log.error('Failed to create user deletion job', {
      userId: uid,
      operation: 'user_deletion_request',
      resource: 'user_profile',
    });

    return sendError(res, { 
      code: 'internal', 
      message: 'Failed to process deletion request' 
    });
  }
});

export default usersRouter;


