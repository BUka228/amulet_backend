import express, { Request, Response } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';

export const statsRouter = express.Router();

statsRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

type DailyTotals = {
  sessionsCount: number;
  totalDurationSec: number;
  practicesCompleted: number;
  hugsSent: number;
  hugsReceived: number;
  patternsCreated: number;
  rulesTriggered: number;
};

// GET /v1/stats/overview — обзорная статистика за период
statsRouter.get('/stats/overview', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });

  try {
    const range = (req.query.range as string) || 'week';
    if (!['day', 'week', 'month'].includes(range)) {
      return sendError(res, { code: 'invalid_argument', message: 'Invalid range' });
    }

    const now = new Date();
    const from = new Date(now);
    if (range === 'day') from.setDate(now.getDate() - 1);
    if (range === 'week') from.setDate(now.getDate() - 7);
    if (range === 'month') from.setMonth(now.getMonth() - 1);

    // Чтение агрегатов за период из users/{uid}/stats_daily/{YYYY-MM-DD}
    const activityDays = new Set<string>();
    const dayTotals: Array<{ date: string; totals: Partial<DailyTotals> }> = [];
    const iter = new Date(from);
    while (iter <= now) {
      const key = iter.toISOString().slice(0, 10);
      const snap = await db.collection('users').doc(uid).collection('stats_daily').doc(key).get();
      if (snap.exists) {
        const data = snap.data() as { totals?: Partial<DailyTotals> } | undefined;
        dayTotals.push({ date: key, totals: data?.totals ?? {} });
        activityDays.add(key);
      }
      iter.setDate(iter.getDate() + 1);
    }

    const sessionsCount = dayTotals.reduce((a, d) => a + (d.totals.sessionsCount ?? 0), 0);
    const totalDurationSec = dayTotals.reduce((a, d) => a + (d.totals.totalDurationSec ?? 0), 0);
    const practicesCompleted = dayTotals.reduce((a, d) => a + (d.totals.practicesCompleted ?? 0), 0);
    const hugsSent = dayTotals.reduce((a, d) => a + (d.totals.hugsSent ?? 0), 0);
    const hugsReceived = dayTotals.reduce((a, d) => a + (d.totals.hugsReceived ?? 0), 0);
    const patternsCreated = dayTotals.reduce((a, d) => a + (d.totals.patternsCreated ?? 0), 0);
    const rulesTriggered = dayTotals.reduce((a, d) => a + (d.totals.rulesTriggered ?? 0), 0);

    // Стрики по дням активности
    const daysSorted = Array.from(activityDays.values()).sort();
    let current = 0;
    let longest = 0;
    let lastDateStr = '';
    for (const day of daysSorted) {
      if (!lastDateStr) {
        current = 1;
      } else {
        const prev = new Date(lastDateStr);
        const cur = new Date(day);
        const diff = (cur.getTime() - prev.getTime()) / 86400000;
        if (diff === 1) current += 1; else current = 1;
      }
      if (current > longest) longest = current;
      lastDateStr = day;
    }

    const totals = { sessionsCount, totalDurationSec, practicesCompleted, hugsSent, hugsReceived, patternsCreated, rulesTriggered };

    const streaks = {
      current,
      longest,
      lastActivity: daysSorted.length ? new Date(daysSorted[daysSorted.length - 1]).toISOString() : null,
    } as Record<string, unknown>;

    return res.status(200).json({ totals, streaks, range });
  } catch (error) {
    logger.error('Stats overview failed', {
      userId: req.auth?.user.uid,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default statsRouter;


