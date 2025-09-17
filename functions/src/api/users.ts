import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';

// Заглушечная in-memory реализация вместо Firestore до подключения БД
// (соответствует API спецификации и позволяет пройти первые интеграционные тесты роутинга)
type UserDoc = {
  id: string;
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  language?: string;
  consents?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

const usersMem: Map<string, UserDoc> = new Map();

function getNowIso(): string {
  return new Date().toISOString();
}

export const usersRouter = express.Router();

// Все эндпоинты требуют аутентификации по ТЗ
// В тестовой среде разрешаем анонимный доступ и подставляем контекст через тестовый мидлварь в app
usersRouter.use(authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' }));

// Простейшая валидация по OpenAPI-схемам (минимум полей и типов)
function validateBody(schema: 'init' | 'update') {
  return (req: Request, res: Response, next: NextFunction) => {
    const body = req.body;
    if (body == null || typeof body !== 'object') {
      return sendError(res, { code: 'invalid_argument', message: 'Body must be a JSON object' });
    }
    const allowedFields = schema === 'init' ?
      ['displayName', 'timezone', 'language', 'consents'] :
      ['displayName', 'avatarUrl', 'timezone', 'language', 'consents'];
    for (const key of Object.keys(body)) {
      if (!allowedFields.includes(key)) {
        return sendError(res, { code: 'invalid_argument', message: `Unexpected field: ${key}` });
      }
    }
    if (body.displayName != null && typeof body.displayName !== 'string') {
      return sendError(res, { code: 'invalid_argument', message: 'displayName must be string' });
    }
    if (body.avatarUrl != null && typeof body.avatarUrl !== 'string') {
      return sendError(res, { code: 'invalid_argument', message: 'avatarUrl must be string' });
    }
    if (body.timezone != null && typeof body.timezone !== 'string') {
      return sendError(res, { code: 'invalid_argument', message: 'timezone must be string' });
    }
    if (body.language != null && typeof body.language !== 'string') {
      return sendError(res, { code: 'invalid_argument', message: 'language must be string' });
    }
    if (body.consents != null && typeof body.consents !== 'object') {
      return sendError(res, { code: 'invalid_argument', message: 'consents must be object' });
    }
    next();
  };
}

// POST /v1/users.me.init — инициализация профиля
usersRouter.post('/users.me.init', validateBody('init'), (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  const existing = usersMem.get(uid);
  const now = getNowIso();
  const payload = req.body ?? {};

  const user: UserDoc = existing ?
    {
      ...existing,
      ...payload,
      id: uid,
      updatedAt: now,
    } :
    {
      id: uid,
      displayName: payload.displayName,
      avatarUrl: payload.avatarUrl,
      timezone: payload.timezone,
      language: payload.language,
      consents: payload.consents,
      createdAt: now,
      updatedAt: now,
    };

  usersMem.set(uid, user);
  return res.status(200).json({ user });
});

// GET /v1/users.me — получить профиль
usersRouter.get('/users.me', (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const user = usersMem.get(uid);
  if (!user) {
    return sendError(res, { code: 'not_found', message: 'User profile not found' });
  }
  return res.status(200).json({ user });
});

// PATCH /v1/users.me — обновить профиль
usersRouter.patch('/users.me', validateBody('update'), (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const existing = usersMem.get(uid);
  if (!existing) {
    return sendError(res, { code: 'not_found', message: 'User profile not found' });
  }
  const now = getNowIso();
  const payload = req.body ?? {};
  const updated: UserDoc = {
    ...existing,
    ...payload,
    id: uid,
    updatedAt: now,
  };
  usersMem.set(uid, updated);
  return res.status(200).json({ user: updated });
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


