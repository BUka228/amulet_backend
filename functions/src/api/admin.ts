import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken, requireRole } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';

export const adminRouter = express.Router();

// В тестовой среде используем внедрённую аутентификацию (X-Test-Uid/X-Test-Admin)
// В продакшене — строгая проверка ID Token с custom claim 'admin'
// Ограничиваем middleware только путями, начинающимися с /admin
adminRouter.use('/admin', (req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'test') return next();
  return authenticateToken({ requireCustomClaim: 'admin' })(req, res, next);
});
// Проверка роли admin (работает и в тестовой среде на основе injected customClaims)
adminRouter.use('/admin', requireRole('admin'));

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
}).strict();

const adminPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  public: z.boolean().optional(),
  reviewStatus: z.enum(['pending','approved','rejected']).optional(),
}).strict();

function parsePagination(req: Request) {
  const limitRaw = (req.query.limit as string) || '20';
  let limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(100, Math.max(1, limit));
  const cursor = (req.query.cursor as string) || '';
  return { limit, cursor };
}

// GET /v1/admin/patterns — список всех паттернов (с фильтрами для модерации)
adminRouter.get('/admin/patterns', async (req: Request, res: Response) => {
  try {
    const { limit, cursor } = parsePagination(req);
    const reviewStatus = (req.query.reviewStatus as string) || '';
    const kind = (req.query.kind as string) || '';
    const tags = (req.query.tags as string) || '';
    const hardwareVersion = Number.parseInt((req.query.hardwareVersion as string) || '', 10);

    let q = db.collection('patterns')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc') as FirebaseFirestore.Query;
    if (reviewStatus) q = q.where('reviewStatus', '==', reviewStatus);
    if (kind) q = q.where('kind', '==', kind);
    if (tags) q = q.where('tags', 'array-contains', tags);
    if (hardwareVersion === 100 || hardwareVersion === 200) q = q.where('hardwareVersion', '==', hardwareVersion);

    if (cursor) {
      const [tsStr, id] = cursor.split('_', 2);
      const ts = Number(tsStr);
      if (Number.isFinite(ts) && id) {
        q = q.startAfter(new Date(ts), id);
      }
    }

    const snap = await q.limit(limit).get();
    const items = snap.docs.map((d) => d.data());
    const last = snap.docs[snap.docs.length - 1];
    const lastData = last?.data() as { createdAt?: FirebaseFirestore.Timestamp; id?: string } | undefined;
    let nextCursor: string | undefined = undefined;
    if (snap.size === limit && lastData?.createdAt && lastData?.id) {
      nextCursor = `${lastData.createdAt.toDate().getTime()}_${lastData.id}`;
    }
    return res.status(200).json({ items, nextCursor });
  } catch (error) {
    logger.error('Admin patterns list failed', { error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/admin/patterns/:id — получить паттерн
adminRouter.get('/admin/patterns/:id', async (req: Request, res: Response) => {
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    return res.status(200).json({ pattern: snap.data() });
  } catch (error) {
    logger.error('Admin pattern get failed', { patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// PATCH /v1/admin/patterns/:id — редактировать паттерн
adminRouter.patch('/admin/patterns/:id', async (req: Request, res: Response) => {
  try {
    const parse = adminPatchSchema.safeParse(req.body ?? {});
    if (!parse.success) return sendError(res, { code: 'invalid_argument', message: parse.error.message });
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    await ref.set({ ...parse.data, updatedAt: new Date() }, { merge: true });
    const fresh = await ref.get();
    return res.status(200).json({ pattern: fresh.data() });
  } catch (error) {
    logger.error('Admin pattern patch failed', { patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// DELETE /v1/admin/patterns/:id — принудительное удаление
adminRouter.delete('/admin/patterns/:id', async (req: Request, res: Response) => {
  try {
    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });
    await ref.delete();
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Admin pattern delete failed', { patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/admin/patterns/:id/review — модерация паттерна
adminRouter.post('/admin/patterns/:id/review', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  try {
    const parse = reviewSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      return sendError(res, { code: 'invalid_argument', message: parse.error.message });
    }
    const { action, reason } = parse.data;

    const ref = db.collection('patterns').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Pattern not found' });

    const now = new Date();
    const update: Record<string, unknown> = {
      reviewStatus: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt: now,
      reviewerId: uid,
      reviewReason: reason ?? null,
      updatedAt: now,
    };
    await ref.set(update, { merge: true });
    const fresh = await ref.get();
    return res.status(200).json({ pattern: fresh.data() });
  } catch (error) {
    logger.error('Pattern review failed', { userId: uid, patternId: req.params.id, error: error instanceof Error ? error.message : 'Unknown error', requestId: req.headers['x-request-id'] });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default adminRouter;


