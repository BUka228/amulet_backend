import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken, requireRole, requireModerator, RoleManager } from '../core/auth';
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

const roleAssignmentSchema = z.object({
  uid: z.string().min(1),
  role: z.enum(['admin', 'moderator']),
  value: z.boolean().default(true),
}).strict();

const firmwarePublishSchema = z.object({
  version: z.string().min(1),
  hardwareVersion: z.number().int().min(100).max(300),
  notes: z.string().max(1000).optional(),
  url: z.string().url(),
  checksum: z.string().min(1),
  minFirmwareVersion: z.string().optional(),
  maxFirmwareVersion: z.string().optional(),
}).strict();

const deviceSearchSchema = z.object({
  ownerId: z.string().optional(),
  serial: z.string().optional(),
  hardwareVersion: z.number().int().optional(),
  status: z.enum(['online', 'offline', 'charging', 'error']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
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

// ===== УПРАВЛЕНИЕ РОЛЯМИ =====

// POST /v1/admin/roles/assign — назначить роль пользователю
adminRouter.post('/admin/roles/assign', async (req: Request, res: Response) => {
  const adminUid = req.auth?.user.uid;
  try {
    const parse = roleAssignmentSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      return sendError(res, { code: 'invalid_argument', message: parse.error.message });
    }
    const { uid, role, value } = parse.data;

    // Проверяем, что админ не пытается отозвать свою роль
    if (uid === adminUid && role === 'admin' && !value) {
      return sendError(res, { 
        code: 'invalid_argument', 
        message: 'Cannot revoke admin role from yourself' 
      });
    }

    await RoleManager.assignRole(uid, role, value);
    
    const userRoles = await RoleManager.getUserRoles(uid);
    
    logger.info('Role assignment completed', {
      adminUid,
      targetUid: uid,
      role,
      value,
      resultRoles: userRoles
    });

    return res.status(200).json({ 
      success: true, 
      uid, 
      role, 
      value,
      roles: userRoles
    });
  } catch (error) {
    logger.error('Role assignment failed', { 
      adminUid, 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Role assignment failed' });
  }
});

// GET /v1/admin/roles/:uid — получить роли пользователя
adminRouter.get('/admin/roles/:uid', async (req: Request, res: Response) => {
  try {
    const uid = req.params.uid;
    const roles = await RoleManager.getUserRoles(uid);
    
    return res.status(200).json({ uid, roles });
  } catch (error) {
    logger.error('Get user roles failed', { 
      uid: req.params.uid, 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Failed to get user roles' });
  }
});

// ===== УПРАВЛЕНИЕ ПРАКТИКАМИ =====

// GET /v1/admin/practices — список практик для модерации
adminRouter.get('/admin/practices', requireModerator(), async (req: Request, res: Response) => {
  try {
    const { limit, cursor } = parsePagination(req);
    const status = (req.query.status as string) || '';
    const type = (req.query.type as string) || '';

    let q = db.collection('practices')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc') as FirebaseFirestore.Query;
    
    if (status) q = q.where('status', '==', status);
    if (type) q = q.where('type', '==', type);

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
    logger.error('Admin practices list failed', { 
      error: error instanceof Error ? error.message : 'Unknown error', 
      requestId: req.headers['x-request-id'] 
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/admin/practices — создать/обновить практику
adminRouter.post('/admin/practices', requireModerator(), async (req: Request, res: Response) => {
  try {
    const practiceData = {
      ...req.body,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: req.auth?.user.uid
    };

    const docRef = await db.collection('practices').add(practiceData);
    const created = await docRef.get();
    
    return res.status(201).json({ practice: { id: docRef.id, ...created.data() } });
  } catch (error) {
    logger.error('Admin practice creation failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Failed to create practice' });
  }
});

// ===== УПРАВЛЕНИЕ УСТРОЙСТВАМИ =====

// GET /v1/admin/devices — поиск устройств
adminRouter.get('/admin/devices', async (req: Request, res: Response) => {
  try {
    const parse = deviceSearchSchema.safeParse({
      ...req.query,
      hardwareVersion: req.query.hardwareVersion ? Number(req.query.hardwareVersion) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 20
    });
    
    if (!parse.success) {
      return sendError(res, { code: 'invalid_argument', message: parse.error.message });
    }
    
    const { ownerId, serial, hardwareVersion, status, limit, cursor } = parse.data;

    let q = db.collection('devices')
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc') as FirebaseFirestore.Query;
    
    if (ownerId) q = q.where('ownerId', '==', ownerId);
    if (serial) q = q.where('serial', '==', serial);
    if (hardwareVersion) q = q.where('hardwareVersion', '==', hardwareVersion);
    if (status) q = q.where('status', '==', status);

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
    logger.error('Admin devices search failed', { 
      error: error instanceof Error ? error.message : 'Unknown error', 
      requestId: req.headers['x-request-id'] 
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/admin/devices/:deviceId/ban — заблокировать устройство
adminRouter.post('/admin/devices/:deviceId/ban', async (req: Request, res: Response) => {
  try {
    const deviceId = req.params.deviceId;
    const reason = req.body.reason || 'Banned by administrator';
    
    const deviceRef = db.collection('devices').doc(deviceId);
    const deviceSnap = await deviceRef.get();
    
    if (!deviceSnap.exists) {
      return sendError(res, { code: 'not_found', message: 'Device not found' });
    }

    await deviceRef.update({
      status: 'banned',
      bannedAt: new Date(),
      bannedBy: req.auth?.user.uid,
      banReason: reason,
      updatedAt: new Date()
    });

    logger.info('Device banned', {
      deviceId,
      adminUid: req.auth?.user.uid,
      reason
    });

    return res.status(200).json({ success: true, deviceId, status: 'banned' });
  } catch (error) {
    logger.error('Device ban failed', { 
      deviceId: req.params.deviceId,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Failed to ban device' });
  }
});

// ===== УПРАВЛЕНИЕ ПРОШИВКАМИ =====

// POST /v1/admin/firmware — публикация новой прошивки
adminRouter.post('/admin/firmware', async (req: Request, res: Response) => {
  try {
    const parse = firmwarePublishSchema.safeParse(req.body ?? {});
    if (!parse.success) {
      return sendError(res, { code: 'invalid_argument', message: parse.error.message });
    }
    
    const firmwareData = {
      ...parse.data,
      publishedAt: new Date(),
      publishedBy: req.auth?.user.uid,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const docRef = await db.collection('firmware').add(firmwareData);
    const created = await docRef.get();
    
    logger.info('Firmware published', {
      version: parse.data.version,
      hardwareVersion: parse.data.hardwareVersion,
      publishedBy: req.auth?.user.uid
    });

    return res.status(201).json({ firmware: { id: docRef.id, ...created.data() } });
  } catch (error) {
    logger.error('Firmware publication failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Failed to publish firmware' });
  }
});

// GET /v1/admin/firmware — список прошивок
adminRouter.get('/admin/firmware', async (req: Request, res: Response) => {
  try {
    const { limit, cursor } = parsePagination(req);
    const hardwareVersion = Number.parseInt((req.query.hardwareVersion as string) || '', 10);

    let q = db.collection('firmware')
      .orderBy('publishedAt', 'desc')
      .orderBy('id', 'desc') as FirebaseFirestore.Query;
    
    if (hardwareVersion === 100 || hardwareVersion === 200) {
      q = q.where('hardwareVersion', '==', hardwareVersion);
    }

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
    const lastData = last?.data() as { publishedAt?: FirebaseFirestore.Timestamp; id?: string } | undefined;
    let nextCursor: string | undefined = undefined;
    if (snap.size === limit && lastData?.publishedAt && lastData?.id) {
      nextCursor = `${lastData.publishedAt.toDate().getTime()}_${lastData.id}`;
    }
    
    return res.status(200).json({ items, nextCursor });
  } catch (error) {
    logger.error('Admin firmware list failed', { 
      error: error instanceof Error ? error.message : 'Unknown error', 
      requestId: req.headers['x-request-id'] 
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// ===== СТАТИСТИКА И МОНИТОРИНГ =====

// GET /v1/admin/stats/overview — общая статистика для админки
adminRouter.get('/admin/stats/overview', async (req: Request, res: Response) => {
  try {
    // Читаем пре-агрегированную статистику из Firestore
    const statsDoc = await db.collection('statistics').doc('overview').get();
    
    if (!statsDoc.exists) {
      // Если статистика еще не агрегирована, возвращаем базовую информацию
      logger.warn('Statistics not yet aggregated, returning empty stats', {
        requestId: req.headers['x-request-id']
      });
      
      return res.status(200).json({
        users: { total: 0, activeToday: 0, newToday: 0 },
        devices: { total: 0, online: 0, newToday: 0 },
        patterns: { total: 0, public: 0, newToday: 0 },
        practices: { total: 0, active: 0, newToday: 0 },
        firmware: { total: 0, published: 0, newToday: 0 },
        activity: { hugs: { today: 0, week: 0 }, sessions: { today: 0, week: 0 } },
        overview: {
          totalUsers: 0,
          totalDevices: 0,
          totalPatterns: 0,
          totalPractices: 0,
          totalFirmware: 0,
          activeUsersToday: 0,
          newUsersToday: 0,
          hugsToday: 0,
          sessionsToday: 0
        },
        lastUpdated: null,
        aggregationPeriod: 'not available',
        nextUpdate: null
      });
    }

    const stats = statsDoc.data();
    
    // Проверяем актуальность данных (если старше 2 часов, предупреждаем)
    let lastUpdated: Date | null = null;
    try {
      if (stats?.lastUpdated) {
        lastUpdated = stats.lastUpdated.toDate ? stats.lastUpdated.toDate() : new Date(stats.lastUpdated);
      }
    } catch (error) {
      logger.warn('Invalid lastUpdated date in statistics', {
        lastUpdated: stats?.lastUpdated,
        requestId: req.headers['x-request-id']
      });
    }
    
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    if (lastUpdated && lastUpdated < twoHoursAgo) {
      logger.warn('Statistics data is stale', {
        lastUpdated: lastUpdated.toISOString(),
        requestId: req.headers['x-request-id']
      });
    }

    return res.status(200).json(stats);
  } catch (error) {
    logger.error('Admin stats overview failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id']
    });
    return sendError(res, { code: 'unavailable', message: 'Failed to get statistics' });
  }
});

export default adminRouter;


