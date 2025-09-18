import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';
import { downLevelPatternSpec, PatternSpec } from '../core/patterns';
import { getMessaging } from 'firebase-admin/messaging';

export const patternsRouter = express.Router();

patternsRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

// Zod схемы (по упрощённой OpenAPI из doc)
const patternSpecSchema = z
  .object({
    type: z.enum(['breathing', 'pulse', 'rainbow', 'fire', 'gradient', 'chase', 'custom']),
    hardwareVersion: z.union([z.literal(100), z.literal(200)]),
    duration: z.number().int().min(1).max(10 * 60 * 1000),
    loop: z.boolean().optional(),
    elements: z
      .array(
        z
          .object({
            type: z.string().min(1),
            startTime: z.number().int().min(0),
            duration: z.number().int().min(1),
            color: z.string().optional(),
            colors: z.array(z.string()).optional(),
            intensity: z.number().min(0).max(1).optional(),
            speed: z.number().min(0).max(10).optional(),
            direction: z.enum(['clockwise', 'counterclockwise', 'center', 'outward']).optional(),
            leds: z.array(z.number().int().min(0)).optional(),
          })
          .strict()
      )
      .min(1),
  })
  .strict();

const patternCreateSchema = z
  .object({
    kind: z.enum(['light', 'haptic', 'combo']),
    spec: patternSpecSchema,
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(2000).optional(),
    tags: z.array(z.string().min(1).max(50)).max(20).optional(),
    public: z.boolean().optional(),
    hardwareVersion: z.union([z.literal(100), z.literal(200)]),
  })
  .strict();

const patternUpdateSchema = patternCreateSchema.partial();

function validateBody(schema: 'create' | 'update' | 'share' | 'preview') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'create') {
        patternCreateSchema.parse(req.body ?? {});
      } else if (schema === 'update') {
        patternUpdateSchema.parse(req.body ?? {});
      } else if (schema === 'share') {
        z
          .object({ toUserId: z.string().optional(), pairId: z.string().optional() })
          .refine((v) => Boolean(v.toUserId || v.pairId), 'toUserId or pairId must be provided')
          .parse(req.body ?? {});
      } else if (schema === 'preview') {
        z
          .object({ deviceId: z.string(), spec: patternSpecSchema, duration: z.number().int().min(1).max(600000).optional() })
          .strict()
          .parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

function parsePagination(req: Request) {
  const limitRaw = (req.query.limit as string) || '20';
  let limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(100, Math.max(1, limit));
  const cursor = (req.query.cursor as string) || '';
  return { limit, cursor };
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

// POST /v1/patterns — создать пользовательский паттерн
patternsRouter.post('/patterns', validateBody('create'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const now = new Date();
    const ref = db.collection('patterns').doc();
    const body = req.body as Record<string, unknown>;
    const doc = omitUndefined({
      id: ref.id,
      ownerId: uid,
      kind: body['kind'],
      spec: body['spec'],
      public: Boolean(body['public'] ?? false),
      reviewStatus: 'pending',
      hardwareVersion: body['hardwareVersion'],
      title: body['title'] ?? null,
      description: body['description'] ?? null,
      tags: Array.isArray(body['tags']) ? body['tags'] : [],
      createdAt: now,
      updatedAt: now,
    });
    await ref.set(doc);
    const fresh = await ref.get();
    return res.status(201).json({ pattern: fresh.data() });
  } catch (error) {
    logger.error('Pattern create failed', { userId: uid, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/patterns.mine — список моих паттернов
patternsRouter.get('/patterns.mine', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const snap = await db.collection('patterns').where('ownerId', '==', uid).orderBy('updatedAt', 'desc').get();
    const items = snap.docs.map((d) => d.data());
    return res.status(200).json({ items });
  } catch (error) {
    logger.error('Patterns mine failed', { userId: uid, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/patterns — публичные паттерны (с фильтрами)
patternsRouter.get('/patterns', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const { limit, cursor } = parsePagination(req);
    const hardwareVersion = Number.parseInt((req.query.hardwareVersion as string) || '', 10);
    const kind = (req.query.kind as string) || '';
    const tags = (req.query.tags as string) || '';

    let q = db.collection('patterns').where('public', '==', true).orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (hardwareVersion === 100 || hardwareVersion === 200) q = q.where('hardwareVersion', '==', hardwareVersion);
    if (kind) q = q.where('kind', '==', kind);
    if (tags) q = q.where('tags', 'array-contains', tags);

    if (cursor) {
      const cursorDoc = await db.collection('patterns').doc(cursor).get();
      if (cursorDoc.exists) q = q.startAfter(cursorDoc);
    }

    const snap = await q.limit(limit).get();
    const items = snap.docs.map((d) => d.data());
    const nextCursor = snap.size === limit ? snap.docs[snap.docs.length - 1].id : undefined;
    return res.status(200).json({ items, nextCursor });
  } catch (error) {
    logger.error('Patterns list failed', { userId: uid, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/patterns/:id — детали
patternsRouter.get('/patterns/:id', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    const data = snap.data() as Record<string, unknown> | undefined;
    if (!data) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    const isOwner = data['ownerId'] === uid;
    const isPublic = Boolean(data['public']);
    if (!isOwner && !isPublic) return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    return res.status(200).json({ pattern: data });
  } catch (error) {
    logger.error('Pattern get failed', { userId: uid, patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// PATCH /v1/patterns/:id — обновить
patternsRouter.patch('/patterns/:id', validateBody('update'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    const data = snap.data() as { ownerId?: string };
    if (data.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    const payload = omitUndefined(req.body as Record<string, unknown>);
    payload['updatedAt'] = new Date();
    await ref.set(payload, { merge: true });
    const fresh = await ref.get();
    return res.status(200).json({ pattern: fresh.data() });
  } catch (error) {
    logger.error('Pattern update failed', { userId: uid, patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// DELETE /v1/patterns/:id — удалить
patternsRouter.delete('/patterns/:id', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    const data = snap.data() as { ownerId?: string };
    if (data.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    await ref.delete();
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Pattern delete failed', { userId: uid, patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/patterns/:id/share — поделиться
patternsRouter.post('/patterns/:id/share', validateBody('share'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    const data = snap.data() as { ownerId?: string };
    if (data.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Access denied' });

    // Логика шаринга: в MVP — создаём запись в коллекции sharedPatterns
    const body = req.body as { toUserId?: string; pairId?: string };
    await db.collection('sharedPatterns').add({
      patternId: req.params.id,
      fromUserId: uid,
      toUserId: body.toUserId ?? null,
      pairId: body.pairId ?? null,
      createdAt: new Date(),
    });
    return res.status(200).json({ shared: true });
  } catch (error) {
    logger.error('Pattern share failed', { userId: uid, patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/patterns/preview — предпросмотр на устройстве
patternsRouter.post('/patterns/preview', validateBody('preview'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const { deviceId, spec, duration } = req.body as { deviceId: string; spec: PatternSpec; duration?: number };
    // В MVP просто валидируем, что устройство принадлежит пользователю
    const dev = await db.collection('devices').doc(deviceId).get();
    if (!dev.exists) return sendError(res, { code: 'not_found', message: 'Device not found' });
    const data = dev.data() as { ownerId?: string; hardwareVersion?: number };
    if (data.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Access denied' });

    // Даун-левелинг: если spec.hw=200, а устройство hw=100 — упростим
    const targetHw = (data.hardwareVersion === 100 || data.hardwareVersion === 200) ? (data.hardwareVersion as 100|200) : 100;
    const adjustedSpec = downLevelPatternSpec(spec, targetHw);

    // Используем данные, чтобы удовлетворить линтер и иметь трассировку
    logger.info('patterns.preview.adjusted', {
      deviceId,
      targetHw,
      originalHw: spec.hardwareVersion,
      type: adjustedSpec.type,
      durationRequested: duration ?? null,
      durationSpec: adjustedSpec.duration,
    });

    // Отправляем команду предпросмотра на мобильное приложение через FCM
    // Ожидается, что клиент/мобильное приложение, получив пуш, выполнит BLE-передачу на амулет
    const tokensSnap = await db
      .collection('notificationTokens')
      .where('userId', '==', uid)
      .where('isActive', '==', true)
      .get();
    const tokens = tokensSnap.docs
      .map((d) => (d.data() as { token?: string }).token)
      .filter(Boolean) as string[];

    const previewId = `prev_${Date.now()}`;
    if (tokens.length > 0) {
      await getMessaging().sendEachForMulticast({
        tokens,
        data: {
          type: 'pattern.preview',
          previewId,
          deviceId,
          hardwareVersion: String(targetHw),
          spec: JSON.stringify(adjustedSpec),
          duration: duration ? String(duration) : '',
        },
      });
    }

    return res.status(200).json({ previewId });
  } catch (error) {
    logger.error('Pattern preview failed', { userId: uid, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default patternsRouter;


