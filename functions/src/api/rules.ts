import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../core/auth';
import { db } from '../core/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { sendError } from '../core/http';
import * as logger from 'firebase-functions/logger';

export const rulesRouter = express.Router();

// Требуем аутентификацию (в тестах допускаем анонимно через подстановку в app)
rulesRouter.use(authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' }));

// Схемы валидации тела
const triggerSchema = z.object({
  type: z.enum(['device_gesture', 'calendar', 'weather', 'geo', 'webhook', 'time']),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
}).strict();

const actionSchema = z.object({
  type: z.enum(['start_practice', 'send_hug', 'light_device', 'smart_home', 'notification']),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
}).strict();

const scheduleSchema = z.object({
  timezone: z.string().min(1).max(100),
  cron: z.string().min(1).max(200),
}).strict();

const createRuleSchema = z.object({
  trigger: triggerSchema,
  action: actionSchema,
  schedule: scheduleSchema.optional(),
  enabled: z.boolean().optional(),
}).strict();

const updateRuleSchema = createRuleSchema.partial();

function validateBody(schema: 'create' | 'update') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'create') {
        createRuleSchema.parse(req.body ?? {});
      } else {
        updateRuleSchema.parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// GET /v1/rules — список правил текущего пользователя
rulesRouter.get('/rules', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  try {
    const query = db.collection('rules').where('ownerId', '==', uid).orderBy('createdAt', 'desc').limit(50);
    const snapshot = await query.get();
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ items });
  } catch (error) {
    logger.error('Failed to list rules', { userId: uid, error: error instanceof Error ? error.message : 'Unknown' });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/rules — создать правило
rulesRouter.post('/rules', validateBody('create'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  try {
    const payload = createRuleSchema.parse(req.body ?? {});
    const docRef = await db.collection('rules').add({
      ownerId: uid,
      trigger: payload.trigger,
      action: payload.action,
      enabled: payload.enabled ?? true,
      schedule: payload.schedule,
      triggerCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const fresh = await docRef.get();
    return res.status(201).json({ rule: { id: docRef.id, ...fresh.data() } });
  } catch (error) {
    logger.error('Failed to create rule', { userId: uid, error: error instanceof Error ? error.message : 'Unknown' });
    return sendError(res, { code: 'internal', message: 'Failed to create rule' });
  }
});

// PATCH /v1/rules/:ruleId — обновить правило
rulesRouter.patch('/rules/:ruleId', validateBody('update'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { ruleId } = req.params;
  try {
    const docRef = db.collection('rules').doc(ruleId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return sendError(res, { code: 'not_found', message: 'Rule not found' });
    }
    const data = snap.data();
    if (data?.ownerId !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Rule ownership mismatch' });
    }
    const update = updateRuleSchema.parse(req.body ?? {});
    await docRef.set({ ...update, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const fresh = await docRef.get();
    return res.status(200).json({ rule: { id: docRef.id, ...fresh.data() } });
  } catch (error) {
    logger.error('Failed to update rule', { userId: uid, ruleId, error: error instanceof Error ? error.message : 'Unknown' });
    return sendError(res, { code: 'internal', message: 'Failed to update rule' });
  }
});

// DELETE /v1/rules/:ruleId — удалить правило
rulesRouter.delete('/rules/:ruleId', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { ruleId } = req.params;
  try {
    const docRef = db.collection('rules').doc(ruleId);
    const snap = await docRef.get();
    if (!snap.exists) {
      return sendError(res, { code: 'not_found', message: 'Rule not found' });
    }
    const data = snap.data();
    if (data?.ownerId !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Rule ownership mismatch' });
    }
    await docRef.delete();
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Failed to delete rule', { userId: uid, ruleId, error: error instanceof Error ? error.message : 'Unknown' });
    return sendError(res, { code: 'internal', message: 'Failed to delete rule' });
  }
});

export default rulesRouter;


