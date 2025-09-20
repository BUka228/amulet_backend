import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../core/firebase';
import { sendNotification } from '../core/pushNotifications';
import * as logger from 'firebase-functions/logger';

/**
 * Функция для отправки напоминаний о практиках
 * Запускается каждый час и проверяет пользователей, которым нужно отправить напоминание
 */
export const practiceRemindersHandler = onSchedule({
  schedule: '0 * * * *', // Каждый час
  timeZone: 'UTC',
  memory: '256MiB',
  timeoutSeconds: 300,
}, async (event) => {
  logger.info('Starting practice reminders job', {
    scheduledTime: event.scheduleTime,
  });

  try {
    // Получаем всех пользователей с активными токенами
    const usersSnapshot = await db
      .collection('users')
      .where('pushTokens', '!=', [])
      .get();

    const now = new Date();
    const currentHour = now.getHours();
    
    let remindersSent = 0;
    let errors = 0;

    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        
        // Проверяем настройки напоминаний пользователя
        const reminderSettings = userData.practiceReminders || {};
        
        // Проверяем, включены ли напоминания
        if (!reminderSettings.enabled) {
          continue;
        }

        // Проверяем, нужно ли отправлять напоминание в текущий час
        const reminderHours = reminderSettings.hours || [9, 18]; // По умолчанию 9:00 и 18:00
        if (!reminderHours.includes(currentHour)) {
          continue;
        }

        // Проверяем, не отправляли ли уже напоминание сегодня
        const today = now.toISOString().split('T')[0];
        const lastReminderDate = userData.lastPracticeReminderDate;
        if (lastReminderDate === today) {
          continue;
        }

        // Проверяем, была ли сегодня практика
        const todayStart = new Date(today + 'T00:00:00.000Z');
        const todayEnd = new Date(today + 'T23:59:59.999Z');
        
        const sessionsSnapshot = await db
          .collection('sessions')
          .where('ownerId', '==', userId)
          .where('startedAt', '>=', todayStart)
          .where('startedAt', '<=', todayEnd)
          .where('status', '==', 'completed')
          .limit(1)
          .get();

        // Если уже была практика сегодня, пропускаем
        if (!sessionsSnapshot.empty) {
          continue;
        }

        // Отправляем напоминание
        const result = await sendNotification(
          userId,
          'practice.reminder',
          {
            type: 'practice.reminder',
            reminderType: 'daily',
          },
          userData.language || 'en'
        );

        if (result.delivered) {
          // Обновляем дату последнего напоминания
          await db.collection('users').doc(userId).update({
            lastPracticeReminderDate: today,
            updatedAt: new Date(),
          });
          
          remindersSent++;
          logger.info('Practice reminder sent', {
            userId,
            hour: currentHour,
            tokensCount: result.tokensCount,
          });
        }
      } catch (userError) {
        errors++;
        logger.error('Failed to process user for practice reminder', {
          userId: userDoc.id,
          error: userError instanceof Error ? userError.message : 'Unknown error',
        });
      }
    }

    logger.info('Practice reminders job completed', {
      totalUsers: usersSnapshot.size,
      remindersSent,
      errors,
      scheduledTime: event.scheduleTime,
    });
  } catch (error) {
    logger.error('Practice reminders job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      scheduledTime: event.scheduleTime,
    });
  }
});

/**
 * Функция для отправки напоминаний о практиках по расписанию пользователя
 * Запускается каждые 15 минут для более точного времени
 */
export const scheduledPracticeRemindersHandler = onSchedule({
  schedule: '*/15 * * * *', // Каждые 15 минут
  timeZone: 'UTC',
  memory: '256MiB',
  timeoutSeconds: 300,
}, async (event) => {
  logger.info('Starting scheduled practice reminders job', {
    scheduledTime: event.scheduleTime,
  });

  try {
    const now = new Date();
    // const currentTime = now.getHours() * 60 + now.getMinutes(); // Время в минутах от начала дня
    
    // Получаем пользователей с настроенными напоминаниями
    const usersSnapshot = await db
      .collection('users')
      .where('practiceReminders.enabled', '==', true)
      .get();

    let remindersSent = 0;
    let errors = 0;

    for (const userDoc of usersSnapshot.docs) {
      try {
        const userData = userDoc.data();
        const userId = userDoc.id;
        const reminderSettings = userData.practiceReminders || {};
        
        // Проверяем точное время напоминания
        const reminderTimes = reminderSettings.times || []; // Массив времени в формате "HH:MM"
        const userTimezone = userData.timezone || 'UTC';
        
        // Конвертируем время пользователя в UTC
        const userTime = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
        const userCurrentTime = userTime.getHours() * 60 + userTime.getMinutes();
        
        let shouldSendReminder = false;
        for (const timeStr of reminderTimes) {
          const [hours, minutes] = timeStr.split(':').map(Number);
          const reminderTime = hours * 60 + minutes;
          
          // Проверяем, попадает ли текущее время в окно ±15 минут от времени напоминания
          if (Math.abs(userCurrentTime - reminderTime) <= 15) {
            shouldSendReminder = true;
            break;
          }
        }
        
        if (!shouldSendReminder) {
          continue;
        }

        // Проверяем, не отправляли ли уже напоминание в последние 30 минут
        const lastReminderTime = userData.lastPracticeReminderTime;
        if (lastReminderTime) {
          const lastReminder = new Date(lastReminderTime);
          const timeDiff = now.getTime() - lastReminder.getTime();
          if (timeDiff < 30 * 60 * 1000) { // 30 минут
            continue;
          }
        }

        // Проверяем, была ли сегодня практика
        const today = now.toISOString().split('T')[0];
        const todayStart = new Date(today + 'T00:00:00.000Z');
        const todayEnd = new Date(today + 'T23:59:59.999Z');
        
        const sessionsSnapshot = await db
          .collection('sessions')
          .where('ownerId', '==', userId)
          .where('startedAt', '>=', todayStart)
          .where('startedAt', '<=', todayEnd)
          .where('status', '==', 'completed')
          .limit(1)
          .get();

        // Если уже была практика сегодня, пропускаем
        if (!sessionsSnapshot.empty) {
          continue;
        }

        // Отправляем напоминание
        const result = await sendNotification(
          userId,
          'practice.reminder',
          {
            type: 'practice.reminder',
            reminderType: 'scheduled',
          },
          userData.language || 'en'
        );

        if (result.delivered) {
          // Обновляем время последнего напоминания
          await db.collection('users').doc(userId).update({
            lastPracticeReminderTime: now,
            updatedAt: new Date(),
          });
          
          remindersSent++;
          logger.info('Scheduled practice reminder sent', {
            userId,
            userCurrentTime,
            tokensCount: result.tokensCount,
          });
        }
      } catch (userError) {
        errors++;
        logger.error('Failed to process user for scheduled practice reminder', {
          userId: userDoc.id,
          error: userError instanceof Error ? userError.message : 'Unknown error',
        });
      }
    }

    logger.info('Scheduled practice reminders job completed', {
      totalUsers: usersSnapshot.size,
      remindersSent,
      errors,
      scheduledTime: event.scheduleTime,
    });
  } catch (error) {
    logger.error('Scheduled practice reminders job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      scheduledTime: event.scheduleTime,
    });
  }
});
