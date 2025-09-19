import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { db } from '../core/firebase';
import { NotificationToken } from '../types/firestore';
import { getMaxNotificationTokens } from '../core/remoteConfig';
import * as logger from 'firebase-functions/logger';

const registerSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ios', 'android', 'web']).optional(),
  appVersion: z.string().optional(),
}).strict();

const unregisterSchema = z.object({
  token: z.string().min(10).max(4096),
}).strict();

// Утилиты для работы с токенами
async function findTokenByValue(userId: string, token: string): Promise<NotificationToken | null> {
  const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
  const snapshot = await tokensRef.where('token', '==', token).limit(1).get();
  
  if (snapshot.empty) {
    return null;
  }
  
  const doc = snapshot.docs[0];
  return { id: doc.id, ...doc.data() } as NotificationToken;
}

async function createToken(userId: string, token: string, platform: 'ios' | 'android' | 'web', appVersion?: string): Promise<NotificationToken> {
  const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
  const now = new Date();
  const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
  
  const tokenData: Omit<NotificationToken, 'id'> = {
    userId,
    token,
    platform,
    isActive: true,
    lastUsedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(appVersion && { appVersion }),
  };
  
  const docRef = await tokensRef.add(tokenData);
  return { id: docRef.id, ...tokenData };
}

async function updateTokenLastUsed(tokenId: string, userId: string): Promise<void> {
  const tokenRef = db.collection('users').doc(userId).collection('notificationTokens').doc(tokenId);
  const now = new Date();
  const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
  
  await tokenRef.update({
    lastUsedAt: timestamp,
    updatedAt: timestamp,
  });
}

async function deactivateToken(tokenId: string, userId: string): Promise<void> {
  const tokenRef = db.collection('users').doc(userId).collection('notificationTokens').doc(tokenId);
  const now = new Date();
  const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
  
  await tokenRef.update({
    isActive: false,
    updatedAt: timestamp,
  });
}

async function getActiveTokensCount(userId: string): Promise<number> {
  const tokensRef = db.collection('users').doc(userId).collection('notificationTokens');
  const snapshot = await tokensRef.where('isActive', '==', true).get();
  return snapshot.size;
}

function validateBody(schema: 'register' | 'unregister') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema === 'register') {
        registerSchema.parse(req.body ?? {});
      } else {
        unregisterSchema.parse(req.body ?? {});
      }
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

export const notificationsRouter = express.Router();

notificationsRouter.use(authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' }));

notificationsRouter.post('/notifications.tokens', validateBody('register'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { token, platform, appVersion } = (req.body ?? {}) as { 
    token: string; 
    platform?: 'ios' | 'android' | 'web';
    appVersion?: string;
  };
  
  // Определяем платформу по умолчанию, если не указана
  const detectedPlatform = platform || 'web';
  
  try {
    // Проверяем, что профиль пользователя инициализирован
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return sendError(res, { code: 'not_found', message: 'User profile not initialized. Call /v1/users.me.init first.' });
    }
    
    // Проверяем, существует ли уже такой токен
    const existingToken = await findTokenByValue(uid, token);
    
    if (existingToken) {
      // Токен уже существует - обновляем lastUsedAt и активируем, если был деактивирован
      await updateTokenLastUsed(existingToken.id, uid);
      if (!existingToken.isActive) {
        const tokenRef = db.collection('users').doc(uid).collection('notificationTokens').doc(existingToken.id);
        const now = new Date();
        const timestamp = { seconds: Math.floor(now.getTime() / 1000), nanoseconds: (now.getTime() % 1000) * 1000000 };
        await tokenRef.update({ isActive: true, updatedAt: timestamp });
      }
      logger.info('FCM token reactivated', { userId: uid, tokenId: existingToken.id, platform: detectedPlatform });
      return res.status(200).json({ ok: true });
    }
    
    // Проверяем лимит активных токенов из Remote Config
    const maxTokens = await getMaxNotificationTokens();
    const activeCount = await getActiveTokensCount(uid);
    if (activeCount >= maxTokens) {
      return sendError(res, { 
        code: 'resource_exhausted', 
        message: `Too many tokens registered (max ${maxTokens})` 
      });
    }
    
    // Создаем новый токен
    const newToken = await createToken(uid, token, detectedPlatform, appVersion);
    logger.info('FCM token registered', { 
      userId: uid, 
      tokenId: newToken.id, 
      platform: detectedPlatform, 
      appVersion,
      activeTokensCount: activeCount + 1 
    });
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Failed to register FCM token', {
      userId: uid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

notificationsRouter.delete('/notifications.tokens', validateBody('unregister'), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }
  const { token } = (req.body ?? {}) as { token: string };
  
  try {
    // Проверяем, что профиль пользователя инициализирован
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return sendError(res, { code: 'not_found', message: 'User profile not initialized. Call /v1/users.me.init first.' });
    }
    
    // Ищем токен по значению
    const existingToken = await findTokenByValue(uid, token);
    
    if (!existingToken) {
      // Токен не найден - считаем операцию успешной (idempotent)
      logger.info('FCM token not found for unregister', { userId: uid, token: token.substring(0, 20) + '...' });
      return res.status(200).json({ ok: true });
    }
    
    // Деактивируем токен вместо удаления (сохраняем историю)
    await deactivateToken(existingToken.id, uid);
    
    logger.info('FCM token deactivated', { 
      userId: uid, 
      tokenId: existingToken.id, 
      platform: existingToken.platform 
    });
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('Failed to unregister FCM token', {
      userId: uid,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default notificationsRouter;


