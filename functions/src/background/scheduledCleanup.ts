import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db } from '../core/firebase';
import { getTokenRetentionDays, getCleanupBatchSize } from '../core/remoteConfig';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Фоновая задача для очистки старых/неактивных токенов уведомлений
 * Запускается еженедельно по воскресеньям в 02:00 UTC
 */
export const scheduledCleanup = onSchedule({
  schedule: '0 2 * * 0', // Каждое воскресенье в 02:00 UTC
  timeZone: 'UTC',
  memory: '512MiB',
  timeoutSeconds: 540, // 9 минут
}, async (event) => {
  logger.info('Starting scheduled cleanup of notification tokens', {
    executionId: event.jobName || 'unknown',
    scheduledTime: event.scheduleTime,
  });

  try {
    // Получаем конфигурацию из Remote Config
    const retentionDays = await getTokenRetentionDays();
    const batchSize = await getCleanupBatchSize();
    
    logger.info('Cleanup configuration', { retentionDays, batchSize });

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    logger.info('Cutoff date for cleanup', { cutoffDate: cutoffDate.toISOString() });

    let totalProcessed = 0;
    let totalDeleted = 0;
    let lastUserId: string | null = null;

    // Обрабатываем пользователей батчами
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let usersQuery = db.collection('users')
        .orderBy('__name__')
        .limit(batchSize);
      
      if (lastUserId) {
        usersQuery = usersQuery.startAfter(lastUserId);
      }

      const usersSnapshot = await usersQuery.get();
      
      if (usersSnapshot.empty) {
        break; // Больше пользователей нет
      }

      logger.info(`Processing batch of ${usersSnapshot.size} users`);

      // Обрабатываем каждого пользователя в батче
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        lastUserId = userId;
        totalProcessed++;

        try {
          // Получаем неактивные токены старше cutoffDate
          const tokensQuery = db.collection('users')
            .doc(userId)
            .collection('notificationTokens')
            .where('isActive', '==', false)
            .where('updatedAt', '<', cutoffDate)
            .limit(50); // Ограничиваем количество токенов на пользователя

          const tokensSnapshot = await tokensQuery.get();
          
          if (tokensSnapshot.empty) {
            continue; // Нет токенов для удаления
          }

          logger.info(`Found ${tokensSnapshot.size} tokens to delete for user ${userId}`);

          // Удаляем токены батчами по 20 (лимит Firestore)
          const tokensToDelete = tokensSnapshot.docs;
          const tokensToRemoveFromArray: string[] = [];
          
          for (let i = 0; i < tokensToDelete.length; i += 20) {
            const batch = db.batch();
            const batchTokens = tokensToDelete.slice(i, i + 20);
            
            batchTokens.forEach((tokenDoc) => {
              const tokenData = tokenDoc.data();
              tokensToRemoveFromArray.push(tokenData.token);
              batch.delete(tokenDoc.ref);
            });

            await batch.commit();
            totalDeleted += batchTokens.length;
            
            logger.debug(`Deleted batch of ${batchTokens.length} tokens for user ${userId}`);
          }
          
          // Обновляем массив pushTokens в документе пользователя
          if (tokensToRemoveFromArray.length > 0) {
            const userRef = db.collection('users').doc(userId);
            await userRef.update({
              pushTokens: FieldValue.arrayRemove(...tokensToRemoveFromArray),
              updatedAt: { 
                seconds: Math.floor(Date.now() / 1000), 
                nanoseconds: (Date.now() % 1000) * 1000000 
              },
            });
            
            logger.debug(`Updated pushTokens array for user ${userId}, removed ${tokensToRemoveFromArray.length} tokens`);
          }

        } catch (error) {
          logger.error(`Error processing user ${userId}`, error);
          // Продолжаем обработку других пользователей
        }
      }

      // Небольшая пауза между батчами пользователей
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Scheduled cleanup completed', {
      totalProcessed,
      totalDeleted,
      retentionDays,
      executionId: event.jobName || 'unknown',
    });

  } catch (error) {
    logger.error('Scheduled cleanup failed', error);
    throw error;
  }
});
