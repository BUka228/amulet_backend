import express, { Request, Response } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';

export const practicesRouter = express.Router();

type DailyTotals = {
  sessionsCount: number;
  totalDurationSec: number;
  practicesCompleted: number;
  hugsSent: number;
  hugsReceived: number;
  patternsCreated: number;
  rulesTriggered: number;
};

type DailyDoc = { date?: string; totals?: DailyTotals };

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
    if (lang) q = q.where('supportedLocales', 'array-contains', lang);

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

// POST /v1/practices/:practiceId/start — старт сессии практики
practicesRouter.post('/practices/:practiceId/start', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const practiceId = req.params.practiceId;
    const { deviceId, intensity, brightness } = (req.body || {}) as { deviceId?: string; intensity?: number; brightness?: number };

    // Проверяем существование практики
    const practiceRef = db.collection('practices').doc(practiceId);
    const practiceSnap = await practiceRef.get();
    if (!practiceSnap.exists) return sendError(res, { code: 'not_found', message: 'Practice not found' });

    // Если передан deviceId — проверим владение
    if (deviceId) {
      const deviceRef = db.collection('devices').doc(deviceId);
      const deviceSnap = await deviceRef.get();
      if (!deviceSnap.exists) return sendError(res, { code: 'not_found', message: 'Device not found' });
      const deviceData = deviceSnap.data() as { ownerId?: string } | undefined;
      if (deviceData?.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Device does not belong to user' });
    }

    const sessionRef = db.collection('sessions').doc();
    const sessionDoc = {
      id: sessionRef.id,
      ownerId: uid,
      practiceId,
      deviceId: deviceId || null,
      status: 'started',
      startedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: 'manual',
      intensity: typeof intensity === 'number' ? intensity : null,
      brightness: typeof brightness === 'number' ? brightness : null,
    } as Record<string, unknown>;

    await sessionRef.set(sessionDoc);
    return res.status(200).json({ sessionId: sessionRef.id });
  } catch (error) {
    logger.error('Practice session start failed', {
      userId: req.auth?.user.uid,
      practiceId: req.params.practiceId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/practices.session/:sessionId/stop — остановка сессии
practicesRouter.post('/practices.session/:sessionId/stop', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const sessionId = req.params.sessionId;
    const { completed, durationSec, userFeedback } = (req.body || {}) as { completed: boolean; durationSec?: number; userFeedback?: { moodBefore?: number; moodAfter?: number; rating?: number; comment?: string } };
    if (typeof completed !== 'boolean') return sendError(res, { code: 'invalid_argument', message: 'Field "completed" is required' });

    const sessionRef = db.collection('sessions').doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) return sendError(res, { code: 'not_found', message: 'Session not found' });
    const data = sessionSnap.data() as { ownerId?: string; status?: string; startedAt?: FirebaseFirestore.Timestamp } | undefined;
    if (data?.ownerId !== uid) return sendError(res, { code: 'permission_denied', message: 'Cannot modify foreign session' });
    if (data?.status !== 'started') return sendError(res, { code: 'failed_precondition', message: 'Session is not in started state' });

    let finalDuration = 0;
    if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec >= 0) {
      finalDuration = Math.floor(durationSec);
    } else if (data?.startedAt) {
      const startedMs = data.startedAt.toDate().getTime();
      const nowMs = Date.now();
      finalDuration = Math.max(0, Math.floor((nowMs - startedMs) / 1000));
    }

    // Обновим сессию и агрегаты за день
    const dateKey = new Date().toISOString().slice(0, 10);
    const dailyRef = db.collection('users').doc(uid).collection('stats_daily').doc(dateKey);

    await db.runTransaction(async (trx) => {
      // Firestore transactions require all reads before any writes
      await trx.get(sessionRef);
      const dailySnap = await trx.get(dailyRef);
      const base: DailyDoc = dailySnap.exists ? (dailySnap.data() as DailyDoc) : { totals: { sessionsCount: 0, totalDurationSec: 0, practicesCompleted: 0, hugsSent: 0, hugsReceived: 0, patternsCreated: 0, rulesTriggered: 0 } };
      const totals: DailyTotals = base.totals || { sessionsCount: 0, totalDurationSec: 0, practicesCompleted: 0, hugsSent: 0, hugsReceived: 0, patternsCreated: 0, rulesTriggered: 0 };
      const updatedTotals = {
        ...totals,
        sessionsCount: (totals.sessionsCount || 0) + 1,
        totalDurationSec: (totals.totalDurationSec || 0) + finalDuration,
        practicesCompleted: (totals.practicesCompleted || 0) + (completed ? 1 : 0),
        // rulesTriggered считаем по source == 'rule' — текущая ручка делает manual, оставляем без изменения
      };
      trx.update(sessionRef, {
        status: completed ? 'completed' : 'aborted',
        endedAt: FieldValue.serverTimestamp(),
        durationSec: finalDuration,
        updatedAt: FieldValue.serverTimestamp(),
        ...(userFeedback ? { userFeedback } : {}),
      });
      trx.set(dailyRef, { totals: updatedTotals, date: dateKey }, { merge: true });
    });

    return res.status(200).json({ summary: { durationSec: finalDuration, completed } });
  } catch (error) {
    logger.error('Practice session stop failed', {
      userId: req.auth?.user.uid,
      sessionId: req.params.sessionId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default practicesRouter;


