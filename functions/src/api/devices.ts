import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';
import * as logger from 'firebase-functions/logger';
import crypto from 'crypto';

// Схемы валидации
const claimSchema = z.object({
  serial: z.string().min(3).max(200),
  claimToken: z.string().min(1).max(200),
  name: z.string().min(1).max(200).optional(),
}).strict();

const settingsSchema = z.object({
  brightness: z.number().min(0).max(100).optional(),
  haptics: z.number().min(0).max(100).optional(),
  gestures: z
    .object({
      singleTap: z.string().max(200).optional(),
      doubleTap: z.string().max(200).optional(),
      longPress: z.string().max(200).optional(),
    })
    .strict()
    .partial()
    .optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    settings: settingsSchema.optional(),
  })
  .strict();

export const devicesRouter = express.Router();

// В тестовой среде разрешаем аноним и подставляем X-Test-Uid контекстом в app
devicesRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

function validateBody(schema: 'claim' | 'update') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'claim') claimSchema.parse(req.body ?? {});
      else updateSchema.parse(req.body ?? {});
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      // @ts-expect-error index
      out[k] = v;
    }
  }
  return out;
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// POST /v1/devices.claim — привязка устройства по serial+claimToken
devicesRouter.post('/devices.claim', validateBody('claim'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  const { serial, claimToken, name } = req.body as { serial: string; claimToken: string; name?: string };
  try {
    // 1) Валидируем одноразовый токен (claimTokens: serial + tokenHash + expiresAt + used:false)
    const tokenHash = sha256Hex(claimToken);
    const nowTs = new Date();
    const tokenSnap = await db
      .collection('claimTokens')
      .where('serial', '==', serial)
      .where('tokenHash', '==', tokenHash)
      .where('used', '==', false)
      .where('expiresAt', '>', nowTs)
      .limit(1)
      .get();
    if (tokenSnap.empty) {
      return sendError(res, { code: 'permission_denied', message: 'Invalid or expired claim token' });
    }
    const tokenDocRef = tokenSnap.docs[0].ref;

    // Пытаемся найти существующее устройство по serial
    const existingSnap = await db.collection('devices').where('serial', '==', serial).limit(1).get();
    const now = FieldValue.serverTimestamp();

    if (!existingSnap.empty) {
      const doc = existingSnap.docs[0];
      const data = doc.data() as Record<string, unknown>;
      const ownerId = (data['ownerId'] as string) || '';
      if (ownerId && ownerId !== uid) {
        return sendError(res, { code: 'permission_denied', message: 'Device already claimed by another user' });
      }

      await doc.ref.set(
        omitUndefined({
          ownerId: uid,
          name: name ?? (data['name'] as string | undefined) ?? 'My Amulet',
          pairedAt: now,
          updatedAt: now,
        }),
        { merge: true }
      );
      // Маркируем токен использованным (и можем удалить)
      await tokenDocRef.set({ used: true, usedAt: now }, { merge: true });
      await tokenDocRef.delete().catch(() => undefined);
      const fresh = await doc.ref.get();
      return res.status(200).json({ device: fresh.data() });
    }

    // Устройство не найдено — создаём запись (MVP путь). В проде — предварительная регистрация устройств.
    const docRef = db.collection('devices').doc();
    await docRef.set(
      omitUndefined({
        id: docRef.id,
        ownerId: uid,
        serial,
        hardwareVersion: 200,
        firmwareVersion: '0',
        name: name ?? 'My Amulet',
        batteryLevel: 100,
        status: 'offline',
        pairedAt: now,
        settings: { brightness: 50, haptics: 50, gestures: {} },
        createdAt: now,
        updatedAt: now,
      })
    );
    // Маркируем токен использованным и удаляем
    await tokenDocRef.set({ used: true, usedAt: now }, { merge: true });
    await tokenDocRef.delete().catch(() => undefined);
    const fresh = await docRef.get();
    return res.status(200).json({ device: fresh.data() });
  } catch (error) {
    logger.error('Device claim failed', {
      uid,
      serial,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/devices — список устройств текущего пользователя
devicesRouter.get('/devices', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  try {
    const snap = await db.collection('devices').where('ownerId', '==', uid).get();
    const devices = snap.docs.map((d) => d.data());
    return res.status(200).json({ devices });
  } catch (error) {
    logger.error('Devices list failed', {
      uid,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/devices/:id — детали устройства
devicesRouter.get('/devices/:id', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  try {
    const ref = db.collection('devices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Device not found' });
    const data = snap.data() as Record<string, unknown>;
    if ((data['ownerId'] as string | undefined) !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }
    return res.status(200).json({ device: data });
  } catch (error) {
    logger.error('Device get failed', {
      uid,
      id: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// PATCH /v1/devices/:id — обновление
devicesRouter.patch('/devices/:id', validateBody('update'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  try {
    const ref = db.collection('devices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Device not found' });
    const data = snap.data() as Record<string, unknown>;
    if ((data['ownerId'] as string | undefined) !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }
    const now = FieldValue.serverTimestamp();
    const payload = omitUndefined(req.body as Record<string, unknown>);
    await ref.set(omitUndefined({ ...payload, updatedAt: now }), { merge: true });
    const fresh = await ref.get();
    return res.status(200).json({ device: fresh.data() });
  } catch (error) {
    logger.error('Device update failed', {
      uid,
      id: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/devices/:id/unclaim — отвязка устройства
devicesRouter.post('/devices/:id/unclaim', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  try {
    const ref = db.collection('devices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Device not found' });
    const data = snap.data() as Record<string, unknown>;
    if ((data['ownerId'] as string | undefined) !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }
    const now = FieldValue.serverTimestamp();
    await ref.set(
      {
        ownerId: FieldValue.delete(),
        pairedAt: FieldValue.delete(),
        updatedAt: now,
        status: 'offline',
      } as unknown as Record<string, unknown>,
      { merge: true }
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Device unclaim failed', {
      uid,
      id: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default devicesRouter;


