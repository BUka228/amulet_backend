import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';
import * as logger from 'firebase-functions/logger';

// Схемы валидации тела запроса
const inviteSchema = z
  .object({
    method: z.enum(['link', 'qr', 'email']),
    target: z.string().min(1).max(320).optional(),
  })
  .strict();

const acceptSchema = z
  .object({
    inviteId: z.string().min(1).max(200),
  })
  .strict();

export const pairsRouter = express.Router();

pairsRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

function validateBody(schema: 'invite' | 'accept') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'invite') inviteSchema.parse(req.body ?? {});
      else acceptSchema.parse(req.body ?? {});
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// Конфиги TTL/ограничений
const INVITE_TTL_MS = 1000 * 60 * 60 * 24; // 24h

// POST /v1/pairs.invite — создать приглашение
pairsRouter.post('/pairs.invite', validateBody('invite'), async (req: Request, res: Response) => {
  const fromUserId = req.auth?.user.uid;
  if (!fromUserId) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const { method, target } = req.body as { method: 'link' | 'qr' | 'email'; target?: string };

    // Создаём документ инвайта
    const now = FieldValue.serverTimestamp();
    const expiresAtDate = new Date(Date.now() + INVITE_TTL_MS);
    const inviteRef = db.collection('invites').doc();

    const inviteDoc = {
      id: inviteRef.id,
      inviteId: inviteRef.id,
      fromUserId,
      method,
      target: target ?? null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAtDate,
    } as Record<string, unknown>;

    await inviteRef.set(inviteDoc);

    // Генерируем URL приглашения (заглушка, реальный базовый URL должен быть из конфигурации)
    const baseUrl = process.env.PAIR_INVITE_BASE_URL || 'https://amulet.app/invite';
    const url = `${baseUrl}/${inviteRef.id}`;

    return res.status(200).json({ inviteId: inviteRef.id, url });
  } catch (error) {
    logger.error('Failed to create pair invite', {
      userId: fromUserId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/pairs.accept — принять приглашение и создать пару (если нет)
pairsRouter.post('/pairs.accept', validateBody('accept'), async (req: Request, res: Response) => {
  const accepterId = req.auth?.user.uid;
  if (!accepterId) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const { inviteId } = req.body as { inviteId: string };
    const inviteRef = db.collection('invites').doc(inviteId);
    const pairsCol = db.collection('pairs');

    const result = await db.runTransaction(async (tx) => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) {
        return { error: { code: 'not_found', message: 'Invite not found' } } as const;
      }
      const invite = inviteSnap.data() as {
        fromUserId?: string;
        expiresAt?: FirebaseFirestore.Timestamp | Date;
        acceptedAt?: FirebaseFirestore.Timestamp;
        acceptedBy?: string;
        status?: string;
      };

      if (invite.status === 'accepted' || invite.acceptedAt) {
        return { error: { code: 'already_exists', message: 'Invite already accepted' } } as const;
      }

      // Проверяем TTL
      const expiresAtDate = invite.expiresAt instanceof Date ? invite.expiresAt : invite.expiresAt?.toDate();
      if (!expiresAtDate || expiresAtDate.getTime() < Date.now()) {
        return { error: { code: 'failed_precondition', message: 'Invite expired' } } as const;
      }

      const fromUserId = invite.fromUserId;
      if (!fromUserId) {
        return { error: { code: 'invalid_argument', message: 'Invalid invite' } } as const;
      }
      if (fromUserId === accepterId) {
        return { error: { code: 'failed_precondition', message: 'Cannot accept own invite' } } as const;
      }

      // Находим существующую пару пользователей (в любом порядке)
      // Храним memberIds в отсортированном порядке для детерминизма
      const memberIds = [fromUserId, accepterId].sort();
      const existing = await tx.get(
        pairsCol.where('memberIds', 'array-contains', memberIds[0]).limit(50)
      );
      let pairDocRef: FirebaseFirestore.DocumentReference | null = null;
      existing.docs.forEach((d) => {
        const data = d.data() as { memberIds?: string[] };
        if (Array.isArray(data.memberIds) && data.memberIds.length === 2) {
          const sorted = [...data.memberIds].sort();
          if (sorted[0] === memberIds[0] && sorted[1] === memberIds[1]) {
            pairDocRef = d.ref;
          }
        }
      });

      const now = FieldValue.serverTimestamp();
      if (!pairDocRef) {
        pairDocRef = pairsCol.doc();
        tx.set(pairDocRef, {
          id: pairDocRef.id,
          memberIds,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          invitedBy: fromUserId,
          acceptedAt: now,
        });
      } else {
        tx.set(
          pairDocRef,
          { status: 'active', updatedAt: now, acceptedAt: now },
          { merge: true }
        );
      }

      tx.update(inviteRef, {
        status: 'accepted',
        acceptedAt: now,
        acceptedBy: accepterId,
        pairId: pairDocRef.id,
        updatedAt: now,
      });

      return { pairId: pairDocRef.id } as const;
    });

    if ('error' in result) {
      const { code, message } = (result as { error: { code: string; message: string } }).error;
      return sendError(res, { code, message });
    }

    const pairId = (result as { pairId: string }).pairId;
    const pairSnap = await db.collection('pairs').doc(pairId).get();
    return res.status(200).json({ pair: pairSnap.data() });
  } catch (error) {
    logger.error('Failed to accept invite', {
      userId: accepterId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/pairs — список пар текущего пользователя
pairsRouter.get('/pairs', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const snap = await db
      .collection('pairs')
      .where('memberIds', 'array-contains', uid)
      .get();
    const pairs = snap.docs.map((d) => d.data());
    return res.status(200).json({ pairs });
  } catch (error) {
    logger.error('Failed to list pairs', {
      userId: uid,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/pairs/:id/block — заблокировать пару
pairsRouter.post('/pairs/:id/block', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const ref = db.collection('pairs').doc(req.params.id);
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { error: { code: 'not_found', message: 'Pair not found' } } as const;
      const data = snap.data() as { memberIds?: string[]; status?: string };
      const members = Array.isArray(data.memberIds) ? data.memberIds : [];
      if (!members.includes(uid)) {
        return { error: { code: 'permission_denied', message: 'Access denied' } } as const;
      }
      const now = FieldValue.serverTimestamp();
      tx.update(ref, {
        status: 'blocked',
        blockedBy: uid,
        blockedAt: now,
        updatedAt: now,
      });
      return { ok: true } as const;
    });

    if ('error' in result) {
      const { code, message } = (result as { error: { code: string; message: string } }).error;
      return sendError(res, { code, message });
    }

    const fresh = await ref.get();
    return res.status(200).json({ pair: fresh.data() });
  } catch (error) {
    logger.error('Failed to block pair', {
      userId: uid,
      pairId: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default pairsRouter;


