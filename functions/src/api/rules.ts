import express, { Request, Response, NextFunction } from 'express';
// no per-router authenticateToken to allow test injection of req.auth
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';
import * as logger from 'firebase-functions/logger';
import { Rule } from '../types/firestore';

export const rulesRouter = express.Router();

// Аутентификация обрабатывается на уровне приложения (в тестах — через X-Test-Uid)

// Схемы валидации для правил
const ruleTriggerSchema = z.object({
  type: z.enum(['device_gesture', 'calendar', 'weather', 'geo', 'webhook', 'time']),
  params: z.record(z.string(), z.unknown()),
});

const ruleActionSchema = z.object({
  type: z.enum(['start_practice', 'send_hug', 'light_device', 'smart_home', 'notification']),
  params: z.record(z.string(), z.unknown()),
});

const ruleScheduleSchema = z.object({
  timezone: z.string().min(1).max(100),
  cron: z.string().min(1).max(200),
});

const ruleCreateSchema = z.object({
  trigger: ruleTriggerSchema,
  action: ruleActionSchema,
  schedule: ruleScheduleSchema.optional(),
  enabled: z.boolean(),
});

const ruleUpdateSchema = z.object({
  trigger: ruleTriggerSchema.optional(),
  action: ruleActionSchema.optional(),
  schedule: ruleScheduleSchema.optional(),
  enabled: z.boolean().optional(),
});

// Валидация тела запроса
function validateBody(schema: 'create' | 'update') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'create') {
        ruleCreateSchema.parse(req.body ?? {});
      } else {
        ruleUpdateSchema.parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// GET /rules - Список правил пользователя
rulesRouter.get('/rules', async (req: Request, res: Response) => {
  try {
    const legacyUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    const userId = req.auth?.user?.uid || legacyUid || (req.headers['x-test-uid'] as string);
    if (!userId) {
      return sendError(res, { code: 'unauthenticated', message: 'User not authenticated' });
    }

    const rulesSnapshot = await db
      .collection('rules')
      .where('ownerId', '==', userId)
      .orderBy('createdAt', 'desc')
      .get();

    const rules: Rule[] = rulesSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt,
      updatedAt: doc.data().updatedAt,
    } as Rule));

    res.json({ items: rules });
  } catch (error) {
    const legacyErrUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    logger.error('Failed to fetch rules', { error, userId: req.auth?.user?.uid ?? legacyErrUid });
    return sendError(res, { code: 'internal', message: 'Failed to fetch rules' });
  }
});

// POST /rules - Создать правило
rulesRouter.post('/rules', validateBody('create'), async (req: Request, res: Response) => {
  try {
    const legacyUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    const userId = req.auth?.user?.uid || legacyUid || (req.headers['x-test-uid'] as string);
    if (!userId) {
      return sendError(res, { code: 'unauthenticated', message: 'User not authenticated' });
    }

    const { trigger, action, schedule, enabled } = req.body;

    const ruleData = {
      ownerId: userId,
      trigger,
      action,
      enabled,
      schedule: schedule || null,
      triggerCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const ruleRef = await db.collection('rules').add(ruleData);
    const ruleDoc = await ruleRef.get();
    const rule = {
      id: ruleDoc.id,
      ...ruleDoc.data(),
      createdAt: ruleDoc.data()?.createdAt,
      updatedAt: ruleDoc.data()?.updatedAt,
    } as Rule;

    logger.info('Rule created', { ruleId: rule.id, userId });
    res.status(201).json({ rule });
  } catch (error) {
    const legacyErrUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    logger.error('Failed to create rule', { error, userId: req.auth?.user?.uid ?? legacyErrUid });
    return sendError(res, { code: 'internal', message: 'Failed to create rule' });
  }
});

// PATCH /rules/:ruleId - Обновить правило
rulesRouter.patch('/rules/:ruleId', validateBody('update'), async (req: Request, res: Response) => {
  try {
    const legacyUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    const userId = req.auth?.user?.uid || legacyUid || (req.headers['x-test-uid'] as string);
    const { ruleId } = req.params;
    
    if (!userId) {
      return sendError(res, { code: 'unauthenticated', message: 'User not authenticated' });
    }

    const ruleRef = db.collection('rules').doc(ruleId);
    const ruleDoc = await ruleRef.get();

    if (!ruleDoc.exists) {
      return sendError(res, { code: 'not_found', message: 'Rule not found' });
    }

    const ruleData = ruleDoc.data() as Rule;
    if (ruleData.ownerId !== userId) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }

    const updateData = {
      ...req.body,
      updatedAt: FieldValue.serverTimestamp(),
    };

    await ruleRef.update(updateData);
    const updatedDoc = await ruleRef.get();
    const rule = {
      id: updatedDoc.id,
      ...updatedDoc.data(),
      createdAt: updatedDoc.data()?.createdAt,
      updatedAt: updatedDoc.data()?.updatedAt,
    } as Rule;

    logger.info('Rule updated', { ruleId, userId });
    res.json({ rule });
  } catch (error) {
    const legacyErrUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    logger.error('Failed to update rule', { error, ruleId: req.params.ruleId, userId: req.auth?.user?.uid ?? legacyErrUid });
    return sendError(res, { code: 'internal', message: 'Failed to update rule' });
  }
});

// DELETE /rules/:ruleId - Удалить правило
rulesRouter.delete('/rules/:ruleId', async (req: Request, res: Response) => {
  try {
    const legacyUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    const userId = req.auth?.user?.uid || legacyUid || (req.headers['x-test-uid'] as string);
    const { ruleId } = req.params;
    
    if (!userId) {
      return sendError(res, { code: 'unauthenticated', message: 'User not authenticated' });
    }

    const ruleRef = db.collection('rules').doc(ruleId);
    const ruleDoc = await ruleRef.get();

    if (!ruleDoc.exists) {
      return sendError(res, { code: 'not_found', message: 'Rule not found' });
    }

    const ruleData = ruleDoc.data() as Rule;
    if (ruleData.ownerId !== userId) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }

    await ruleRef.delete();

    logger.info('Rule deleted', { ruleId, userId });
    res.json({ ok: true });
  } catch (error) {
    const legacyErrUid = (req as Request & { auth?: { uid?: string } }).auth?.uid;
    logger.error('Failed to delete rule', { error, ruleId: req.params.ruleId, userId: req.auth?.user?.uid ?? legacyErrUid });
    return sendError(res, { code: 'internal', message: 'Failed to delete rule' });
  }
});
