import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { getMessaging } from 'firebase-admin/messaging';
import { z } from 'zod';
import * as logger from 'firebase-functions/logger';

// Валидация входа для /hugs.send
const hugSendSchema = z
  .object({
    toUserId: z.string().min(1).max(200).optional(),
    pairId: z.string().min(1).max(200).optional(),
    emotion: z
      .object({
        color: z.string().min(1).max(20),
        patternId: z.string().min(1).max(200),
      })
      .strict(),
    inReplyToHugId: z.string().min(1).max(200).optional(),
    payload: z.object({}).catchall(z.unknown()).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.toUserId || v.pairId), {
    message: 'Either toUserId or pairId must be provided',
    path: ['toUserId'],
  });

export const hugsRouter = express.Router();

// Разрешаем аноним только в тестах, как и в других роутерах
hugsRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

function validateBody(schema: 'send') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'send') hugSendSchema.parse(req.body ?? {});
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// Утилита для пагинации курсором
function parsePagination(req: Request) {
  const limitRaw = (req.query.limit as string) || '20';
  let limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(100, Math.max(1, limit));
  const cursor = (req.query.cursor as string) || '';
  return { limit, cursor };
}

// POST /v1/hugs.send — отправка «объятия»
hugsRouter.post('/hugs.send', validateBody('send'), async (req: Request, res: Response) => {
  const fromUserId = req.auth?.user.uid;
  if (!fromUserId) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  try {
    const { toUserId: toUserIdRaw, pairId: pairIdRaw, emotion, payload, inReplyToHugId } = req.body as {
      toUserId?: string;
      pairId?: string;
      emotion: { color: string; patternId: string };
      payload?: Record<string, unknown>;
      inReplyToHugId?: string;
    };

    let toUserId = toUserIdRaw;
    const pairId = pairIdRaw;

    // Если указан pairId — валидируем пару и получателя, учитываем блокировки
    if (pairId) {
      const pairDoc = await db.collection('pairs').doc(pairId).get();
      if (!pairDoc.exists) {
        return sendError(res, { code: 'not_found', message: 'Pair not found' });
      }
      const pair = pairDoc.data() as { memberIds?: string[]; status?: string };
      const members = Array.isArray(pair.memberIds) ? pair.memberIds : [];
      if (!members.includes(fromUserId)) {
        return sendError(res, { code: 'permission_denied', message: 'You are not a member of this pair' });
      }
      if (pair.status === 'blocked') {
        return sendError(res, { code: 'failed_precondition', message: 'Pair is blocked' });
      }
      toUserId = members.find((m) => m !== fromUserId);
      if (!toUserId) {
        return sendError(res, { code: 'invalid_argument', message: 'Invalid pair members' });
      }
    }

    // Если указали toUserId — можно дополнительно проверить, что существует активная пара
    if (!toUserId) {
      return sendError(res, { code: 'invalid_argument', message: 'Recipient is required' });
    }

    // Создаём документ «объятия»
    const now = FieldValue.serverTimestamp();
    const hugsRef = db.collection('hugs');
    const hugDoc = hugsRef.doc();
    const data = {
      id: hugDoc.id,
      fromUserId,
      toUserId,
      pairId: pairId || null,
      emotion,
      payload: payload ?? null,
      inReplyToHugId: inReplyToHugId ?? null,
      createdAt: now,
      updatedAt: now,
    } as unknown as Record<string, unknown>;
    await hugDoc.set(data);

    // Отправляем FCM пуш всем активным токенам получателя
    let delivered = false;
    try {
      const tokensSnap = await db
        .collection('notificationTokens')
        .where('userId', '==', toUserId)
        .where('isActive', '==', true)
        .get();
      const tokens = tokensSnap.docs
        .map((d) => (d.data() as { token?: string }).token)
        .filter(Boolean)
        .sort() as string[];
      if (tokens.length > 0) {
        const response = await getMessaging().sendEachForMulticast({
          tokens,
          notification: {
            title: 'You received a hug',
            body: 'Open the app to feel it',
          },
          data: {
            type: 'hug.received',
            hugId: hugDoc.id,
            fromUserId,
            color: emotion.color,
            patternId: emotion.patternId,
          },
        });
        delivered = response.successCount > 0;

        // Очистка невалидных FCM-токенов
        if (Array.isArray(response.responses) && response.responses.length === tokens.length) {
          const deadTokens: string[] = [];
          response.responses.forEach((r, idx) => {
            const tokenAtIndex = tokens[idx];
            if (
              !r.success &&
              r.error &&
              (r.error as { code?: string }).code === 'messaging/registration-token-not-registered' &&
              tokenAtIndex
            ) {
              deadTokens.push(tokenAtIndex);
            }
          });
          if (deadTokens.length > 0) {
            await Promise.all(
              deadTokens.map(async (t) => {
                try {
                  const q = await db.collection('notificationTokens').where('token', '==', t).limit(50).get();
                  await Promise.all(q.docs.map((d) => d.ref.delete()));
                  logger.info('Removed invalid FCM token', { token: t, userId: toUserId, hugId: hugDoc.id });
                } catch (cleanupErr) {
                  logger.error('Failed to cleanup invalid FCM token', {
                    token: t,
                    userId: toUserId,
                    hugId: hugDoc.id,
                    error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
                    requestId: req.headers['x-request-id'],
                  });
                }
              })
            );
          }
        }
      }
    } catch (err) {
      logger.error('Failed to send FCM for hug', {
        hugId: hugDoc.id,
        error: err instanceof Error ? err.message : String(err),
        requestId: req.headers['x-request-id'],
      });
    }

    // Если доставили — обновляем deliveredAt
    if (delivered) {
      await hugDoc.set({ deliveredAt: now }, { merge: true });
    }

    return res.status(200).json({ hugId: hugDoc.id, delivered });
  } catch (error) {
    logger.error('Hug send failed', {
      fromUserId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/hugs — история, с фильтрами и пагинацией
hugsRouter.get('/hugs', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const direction = (req.query.direction as string) || '';
    const { limit, cursor } = parsePagination(req);

    let q = db.collection('hugs').orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (direction === 'sent') {
      q = q.where('fromUserId', '==', uid);
    } else if (direction === 'received') {
      q = q.where('toUserId', '==', uid);
    } else {
      // по умолчанию возвращаем все связанные: отправленные или полученные
      // Firestore не поддерживает OR без композитного индекса/collection group, поэтому берём два запроса
      const [sentSnap, recvSnap] = await Promise.all([
        db.collection('hugs').where('fromUserId', '==', uid).orderBy('createdAt', 'desc').limit(limit).get(),
        db.collection('hugs').where('toUserId', '==', uid).orderBy('createdAt', 'desc').limit(limit).get(),
      ]);
      const merged = [...sentSnap.docs, ...recvSnap.docs]
        .sort((a, b) => (b.createTime.toMillis() - a.createTime.toMillis()))
        .slice(0, limit);
      const items = merged.map((d) => d.data());
      const nextCursor = merged.length === limit ? merged[merged.length - 1].id : undefined;
      return res.status(200).json({ items, nextCursor });
    }

    if (cursor) {
      const cursorDoc = await db.collection('hugs').doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }
    const snap = await q.limit(limit).get();
    const items = snap.docs.map((d) => d.data());
    const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : undefined;
    return res.status(200).json({ items, nextCursor });
  } catch (error) {
    logger.error('Hugs list failed', {
      uid,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/hugs/:id — детали «объятия»
hugsRouter.get('/hugs/:id', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('hugs').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Hug not found' });
    const data = snap.data() as Record<string, unknown>;
    if (data['fromUserId'] !== uid && data['toUserId'] !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }
    return res.status(200).json({ hug: data });
  } catch (error) {
    logger.error('Hug get failed', {
      uid,
      id: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default hugsRouter;


