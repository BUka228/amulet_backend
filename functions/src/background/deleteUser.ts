/**
 * Cloud Function для асинхронного удаления данных пользователя
 * Запускается по триггеру Pub/Sub после получения jobId от POST /users.me/delete
 */

import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';

export interface DeleteUserJob {
  jobId: string;
  userId: string;
  requestedAt: string;
  priority: 'high' | 'normal' | 'low';
}

/**
 * Анонимизация данных пользователя вместо полного удаления
 * Сохраняет структуру данных для аналитики, но удаляет PII
 */
async function anonymizeUserData(userId: string): Promise<void> {
  const batch = db.batch();
  
  try {
    // 1. Анонимизация профиля пользователя
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const updates: Record<string, unknown> = {
        displayName: 'Deleted User',
        avatarUrl: null,
        email: `deleted_${userId}@deleted.local`,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        // Сохраняем только необходимые поля для аналитики, без undefined
        createdAt: userDoc.data()?.createdAt,
        timezone: userDoc.data()?.timezone,
        language: userDoc.data()?.language,
        pushTokens: [],
        consents: {}
      };
      for (const key of Object.keys(updates)) {
        if (updates[key] === undefined) {
          delete updates[key];
        }
      }
      batch.update(userRef, updates);
    }

    // 2. Анонимизация устройств пользователя
    const devicesSnapshot = await db.collection('devices')
      .where('ownerId', '==', userId)
      .get();
    
    devicesSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        ownerId: null,
        name: 'Deleted Device',
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 3. Анонимизация сессий практик
    const sessionsSnapshot = await db.collection('sessions')
      .where('ownerId', '==', userId)
      .get();
    
    sessionsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        ownerId: null,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 4. Анонимизация паттернов пользователя
    const patternsSnapshot = await db.collection('patterns')
      .where('ownerId', '==', userId)
      .get();
    
    patternsSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        ownerId: null,
        title: 'Deleted Pattern',
        description: 'This pattern was deleted by the user',
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 5. Анонимизация правил IFTTT
    const rulesSnapshot = await db.collection('rules')
      .where('ownerId', '==', userId)
      .get();
    
    rulesSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        ownerId: null,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 6. Анонимизация пар (связей пользователей)
    const pairsSnapshot = await db.collection('pairs')
      .where('memberIds', 'array-contains', userId)
      .get();
    
    pairsSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const memberIds = data.memberIds || [];
      const updatedMemberIds = memberIds.map((id: string) => 
        id === userId ? null : id
      ).filter((id: string | null) => id !== null);
      
      batch.update(doc.ref, {
        memberIds: updatedMemberIds,
        status: 'blocked', // блокируем связь
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 7. Анонимизация объятий (hugs)
    const hugsFromSnapshot = await db.collection('hugs')
      .where('fromUserId', '==', userId)
      .get();
    
    hugsFromSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        fromUserId: null,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    const hugsToSnapshot = await db.collection('hugs')
      .where('toUserId', '==', userId)
      .get();
    
    hugsToSnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        toUserId: null,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // 8. Анонимизация телеметрии
    const telemetrySnapshot = await db.collection('telemetry')
      .where('userId', '==', userId)
      .get();
    
    telemetrySnapshot.docs.forEach((doc) => {
      batch.update(doc.ref, {
        userId: null,
        isDeleted: true,
        deletedAt: FieldValue.serverTimestamp()
      });
    });

    // Выполняем все операции в одной транзакции
    await batch.commit();
    
    logger.info('User data anonymized successfully', { userId });
    
  } catch (error) {
    logger.error('Failed to anonymize user data', { 
      userId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    throw error;
  }
}

/**
 * Полное удаление данных пользователя (альтернативный подход)
 * Используется только если анонимизация не подходит
 */
async function deleteUserData(userId: string): Promise<void> {
  const batch = db.batch();
  
  try {
    // Удаляем все документы пользователя
    const collections = [
      'users', 'devices', 'sessions', 'patterns', 'rules', 'hugs', 'telemetry'
    ];
    
    for (const collection of collections) {
      const snapshot = await db.collection(collection)
        .where('ownerId', '==', userId)
        .get();
      
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
    }

    // Удаляем документы где пользователь упоминается в массивах
    const pairsSnapshot = await db.collection('pairs')
      .where('memberIds', 'array-contains', userId)
      .get();
    
    pairsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });

    await batch.commit();
    
    logger.info('User data deleted successfully', { userId });
    
  } catch (error) {
    logger.error('Failed to delete user data', { 
      userId, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    throw error;
  }
}

/**
 * Cloud Function обработчик для удаления пользователя
 */
export async function processUserDeletionHandler(jobData: DeleteUserJob): Promise<void> {
  // Проверяем, не был ли пользователь уже удален
  const userRef = db.collection('users').doc(jobData.userId);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    logger.warn('User not found during deletion', { 
      jobId: jobData.jobId, 
      userId: jobData.userId 
    });
    return;
  }

  const userData = userDoc.data();
  if (userData?.isDeleted) {
    logger.warn('User already deleted', { 
      jobId: jobData.jobId, 
      userId: jobData.userId 
    });
    return;
  }

  // Выбираем стратегию удаления на основе настроек
  const deletionStrategy = process.env.USER_DELETION_STRATEGY || 'anonymize';
  
  if (deletionStrategy === 'delete') {
    await deleteUserData(jobData.userId);
  } else {
    await anonymizeUserData(jobData.userId);
  }

  // Обновляем статус задачи
  await db.collection('deletionJobs').doc(jobData.jobId).set({
    status: 'completed',
    completedAt: FieldValue.serverTimestamp(),
    userId: jobData.userId
  }, { merge: true });
}

export const processUserDeletion = onMessagePublished({
  topic: 'user-deletion',
  region: 'us-central1'
}, async (event) => {
  try {
    const message = event.data.message;
    const jobData = JSON.parse(Buffer.from(message.data, 'base64').toString()) as DeleteUserJob;
    
    logger.info('Processing user deletion job', { 
      jobId: jobData.jobId, 
      userId: jobData.userId 
    });
    await processUserDeletionHandler(jobData);

    logger.info('User deletion job completed', { 
      jobId: jobData.jobId, 
      userId: jobData.userId,
      strategy: (process.env.USER_DELETION_STRATEGY || 'anonymize')
    });

  } catch (error) {
    logger.error('User deletion job failed', { 
      error: error instanceof Error ? error.message : 'Unknown error',
      jobId: event.data.message?.messageId
    });

    // Обновляем статус задачи как неудачную
    try {
      const jobData = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString()) as DeleteUserJob;
      await db.collection('deletionJobs').doc(jobData.jobId).set({
        status: 'failed',
        failedAt: FieldValue.serverTimestamp(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }, { merge: true });
    } catch (updateError) {
      logger.error('Failed to update job status', { 
        error: updateError instanceof Error ? updateError.message : 'Unknown error'
      });
    }

    throw error;
  }
});
