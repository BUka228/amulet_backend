import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken, requireRole } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';
import { z } from 'zod';

export const adminRouter = express.Router();

// В тестовой среде используем внедрённую аутентификацию (X-Test-Uid/X-Test-Admin)
// В продакшене — строгая проверка ID Token с custom claim 'admin'
adminRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === 'test') return next();
  return authenticateToken({ requireCustomClaim: 'admin' })(req, res, next);
});
// Проверка роли admin (работает и в тестовой среде на основе injected customClaims)
adminRouter.use(requireRole('admin'));

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
}).strict();

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


