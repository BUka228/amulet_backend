import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
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

    // Транзакция: проверяем пару и создаём документ «объятия» атомарно
    const now = FieldValue.serverTimestamp();
    const hugDocRef = db.collection('hugs').doc();
    const trxResult = await db.runTransaction(async (tx) => {
      let computedToUserId = toUserIdRaw;
      if (pairIdRaw) {
        const pairRef = db.collection('pairs').doc(pairIdRaw);
        const pairSnap = await tx.get(pairRef);
        if (!pairSnap.exists) {
          return { error: { code: 'not_found', message: 'Pair not found' } } as const;
        }
        const pair = pairSnap.data() as { memberIds?: string[]; status?: string };
        const members = Array.isArray(pair.memberIds) ? pair.memberIds : [];
        if (!members.includes(fromUserId)) {
          return { error: { code: 'permission_denied', message: 'You are not a member of this pair' } } as const;
        }
        if (pair.status === 'blocked') {
          return { error: { code: 'failed_precondition', message: 'Pair is blocked' } } as const;
        }
        computedToUserId = members.find((m) => m !== fromUserId);
        if (!computedToUserId) {
          return { error: { code: 'invalid_argument', message: 'Invalid pair members' } } as const;
        }
      }

      if (!computedToUserId) {
        return { error: { code: 'invalid_argument', message: 'Recipient is required' } } as const;
      }

      // Запрет на отправку самому себе
      if (computedToUserId === fromUserId) {
        return { error: { code: 'failed_precondition', message: 'Cannot send hug to yourself' } } as const;
      }

      const docData = {
        id: hugDocRef.id,
        fromUserId,
        toUserId: computedToUserId,
        pairId: pairIdRaw || null,
        emotion,
        payload: payload ?? null,
        inReplyToHugId: inReplyToHugId ?? null,
        createdAt: now,
        updatedAt: now,
      } as unknown as Record<string, unknown>;
      tx.set(hugDocRef, docData);
      return { toUserId: computedToUserId } as const;
    });

    if ('error' in trxResult) {
      const { code, message } = (trxResult as { error: { code: string; message: string } }).error;
      return sendError(res, { code, message });
    }

    const resolvedToUserId = (trxResult as { toUserId: string }).toUserId;

    // Отправляем FCM пуш всем активным токенам получателя
    let delivered = false;
    try {
      const { sendNotification } = await import('../core/pushNotifications');
      const result = await sendNotification(
        resolvedToUserId,
        'hug.received',
        {
          type: 'hug.received',
          hugId: hugDocRef.id,
          fromUserId,
          color: emotion.color,
          patternId: emotion.patternId,
        },
        req.headers['accept-language'] as string
      );
      delivered = result.delivered;
    } catch (err) {
      logger.error('Failed to send FCM for hug', {
        hugId: hugDocRef.id,
        error: err instanceof Error ? err.message : String(err),
        requestId: req.headers['x-request-id'],
      });
    }

    // Если доставили — обновляем deliveredAt
    if (delivered) {
      await hugDocRef.set({ deliveredAt: now }, { merge: true });
    }

    return res.status(200).json({ hugId: hugDocRef.id, delivered });
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

    if (direction !== 'sent' && direction !== 'received') {
      return sendError(res, { code: 'invalid_argument', message: 'Query param "direction" is required (sent|received)' });
    }

    let q = db.collection('hugs').orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    q = direction === 'sent' ? q.where('fromUserId', '==', uid) : q.where('toUserId', '==', uid);

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


