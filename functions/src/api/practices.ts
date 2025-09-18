import express, { Request, Response } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';

export const practicesRouter = express.Router();

practicesRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

function parsePagination(req: Request) {
  const limitRaw = (req.query.limit as string) || '20';
  let limit = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(100, Math.max(1, limit));
  const cursor = (req.query.cursor as string) || '';
  return { limit, cursor };
}

// GET /v1/practices — каталог практик
practicesRouter.get('/practices', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const { limit, cursor } = parsePagination(req);
    const type = (req.query.type as string) || '';
    const lang = (req.query.lang as string) || '';

    let q = db.collection('practices')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc') as FirebaseFirestore.Query;
    if (type) q = q.where('type', '==', type);
    if (lang) q = q.where(`locales.${lang}.title`, '!=', null);

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
    logger.error('Practices list failed', {
      userId: req.auth?.user.uid,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// GET /v1/practices/:id — детали практики
practicesRouter.get('/practices/:id', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  try {
    const ref = db.collection('practices').doc(req.params.id);
    const snap = await ref.get();
    if (!snap.exists) return sendError(res, { code: 'not_found', message: 'Practice not found' });
    return res.status(200).json({ practice: snap.data() });
  } catch (error) {
    logger.error('Practice get failed', {
      userId: uid,
      id: req.params.id,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default practicesRouter;


