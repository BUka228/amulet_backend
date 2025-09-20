import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { db } from '../core/firebase';

/**
 * Фоновая функция для агрегации статистики
 * Запускается по расписанию (например, каждый час) и сохраняет
 * пре-агрегированные данные в документ statistics/overview
 */
export const aggregateStats = onSchedule({
  schedule: '0 * * * *', // Каждый час
  timeZone: 'UTC',
  memory: '512MiB',
  timeoutSeconds: 540, // 9 минут
}, async (event) => {
    try {
      logger.info('Starting stats aggregation', {
        scheduledTime: event.scheduleTime
      });

      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      // Агрегируем статистику параллельно
      const [
        usersStats,
        devicesStats,
        patternsStats,
        practicesStats,
        firmwareStats,
        hugsStats,
        sessionsStats
      ] = await Promise.all([
        aggregateUsersStats(dayAgo, weekAgo, monthAgo),
        aggregateDevicesStats(dayAgo, weekAgo, monthAgo),
        aggregatePatternsStats(dayAgo, weekAgo, monthAgo),
        aggregatePracticesStats(dayAgo, weekAgo, monthAgo),
        aggregateFirmwareStats(dayAgo, weekAgo, monthAgo),
        aggregateHugsStats(dayAgo, weekAgo, monthAgo),
        aggregateSessionsStats(dayAgo, weekAgo, monthAgo)
      ]);

      // Формируем итоговую статистику
      const stats = {
        // Метаданные
        lastUpdated: now,
        aggregationPeriod: '1 hour',
        nextUpdate: new Date(now.getTime() + 60 * 60 * 1000), // +1 час

        // Пользователи
        users: usersStats,

        // Устройства
        devices: devicesStats,

        // Паттерны
        patterns: patternsStats,

        // Практики
        practices: practicesStats,

        // Прошивки
        firmware: firmwareStats,

        // Активность
        activity: {
          hugs: hugsStats,
          sessions: sessionsStats
        },

        // Общие метрики
        overview: {
          totalUsers: usersStats.total,
          totalDevices: devicesStats.total,
          totalPatterns: patternsStats.total,
          totalPractices: practicesStats.total,
          totalFirmware: firmwareStats.total,
          activeUsersToday: usersStats.activeToday,
          newUsersToday: usersStats.newToday,
          hugsToday: hugsStats.today,
          sessionsToday: sessionsStats.today
        }
      };

      // Сохраняем в Firestore
      await db.collection('statistics').doc('overview').set(stats, { merge: true });

      logger.info('Stats aggregation completed successfully', {
        scheduledTime: event.scheduleTime,
        stats: {
          totalUsers: stats.overview.totalUsers,
          totalDevices: stats.overview.totalDevices,
          totalPatterns: stats.overview.totalPatterns,
          activeUsersToday: stats.overview.activeUsersToday,
          hugsToday: stats.overview.hugsToday
        }
      });
    } catch (error) {
      logger.error('Stats aggregation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        scheduledTime: event.scheduleTime
      });
      throw error;
    }
  });

/**
 * Агрегация статистики пользователей
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregateUsersStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [totalSnapshot, activeTodaySnapshot, newTodaySnapshot, newWeekSnapshot, newMonthSnapshot] = await Promise.all([
    db.collection('users').where('isDeleted', '==', false).get(),
    db.collection('users')
      .where('isDeleted', '==', false)
      .where('lastActiveAt', '>=', dayAgo)
      .get(),
    db.collection('users')
      .where('isDeleted', '==', false)
      .where('createdAt', '>=', dayAgo)
      .get(),
    db.collection('users')
      .where('isDeleted', '==', false)
      .where('createdAt', '>=', weekAgo)
      .get(),
    db.collection('users')
      .where('isDeleted', '==', false)
      .where('createdAt', '>=', _monthAgo)
      .get()
  ]);

  return {
    total: totalSnapshot.size,
    activeToday: activeTodaySnapshot.size,
    newToday: newTodaySnapshot.size,
    newWeek: newWeekSnapshot.size,
    newMonth: newMonthSnapshot.size
  };
}

/**
 * Агрегация статистики устройств
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregateDevicesStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [totalSnapshot, onlineSnapshot, newTodaySnapshot, newWeekSnapshot] = await Promise.all([
    db.collection('devices').get(),
    db.collection('devices').where('status', '==', 'online').get(),
    db.collection('devices').where('createdAt', '>=', dayAgo).get(),
    db.collection('devices').where('createdAt', '>=', weekAgo).get()
  ]);

  return {
    total: totalSnapshot.size,
    online: onlineSnapshot.size,
    newToday: newTodaySnapshot.size,
    newWeek: newWeekSnapshot.size
  };
}

/**
 * Агрегация статистики паттернов
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregatePatternsStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [totalSnapshot, publicSnapshot, newTodaySnapshot, newWeekSnapshot] = await Promise.all([
    db.collection('patterns').get(),
    db.collection('patterns').where('public', '==', true).get(),
    db.collection('patterns').where('createdAt', '>=', dayAgo).get(),
    db.collection('patterns').where('createdAt', '>=', weekAgo).get()
  ]);

  return {
    total: totalSnapshot.size,
    public: publicSnapshot.size,
    newToday: newTodaySnapshot.size,
    newWeek: newWeekSnapshot.size
  };
}

/**
 * Агрегация статистики практик
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregatePracticesStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [totalSnapshot, activeSnapshot, newTodaySnapshot, newWeekSnapshot] = await Promise.all([
    db.collection('practices').get(),
    db.collection('practices').where('isActive', '==', true).get(),
    db.collection('practices').where('createdAt', '>=', dayAgo).get(),
    db.collection('practices').where('createdAt', '>=', weekAgo).get()
  ]);

  return {
    total: totalSnapshot.size,
    active: activeSnapshot.size,
    newToday: newTodaySnapshot.size,
    newWeek: newWeekSnapshot.size
  };
}

/**
 * Агрегация статистики прошивок
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregateFirmwareStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [totalSnapshot, publishedSnapshot, newTodaySnapshot, newWeekSnapshot] = await Promise.all([
    db.collection('firmware').get(),
    db.collection('firmware').where('status', '==', 'published').get(),
    db.collection('firmware').where('publishedAt', '>=', dayAgo).get(),
    db.collection('firmware').where('publishedAt', '>=', weekAgo).get()
  ]);

  return {
    total: totalSnapshot.size,
    published: publishedSnapshot.size,
    newToday: newTodaySnapshot.size,
    newWeek: newWeekSnapshot.size
  };
}

/**
 * Агрегация статистики объятий
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregateHugsStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [todaySnapshot, weekSnapshot, monthSnapshot] = await Promise.all([
    db.collection('hugs').where('createdAt', '>=', dayAgo).get(),
    db.collection('hugs').where('createdAt', '>=', weekAgo).get(),
    db.collection('hugs').where('createdAt', '>=', _monthAgo).get()
  ]);

  return {
    today: todaySnapshot.size,
    week: weekSnapshot.size,
    month: monthSnapshot.size
  };
}

/**
 * Агрегация статистики сессий
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function aggregateSessionsStats(dayAgo: Date, weekAgo: Date, _monthAgo: Date) {
  const [todaySnapshot, weekSnapshot, monthSnapshot] = await Promise.all([
    db.collection('sessions').where('createdAt', '>=', dayAgo).get(),
    db.collection('sessions').where('createdAt', '>=', weekAgo).get(),
    db.collection('sessions').where('createdAt', '>=', _monthAgo).get()
  ]);

  return {
    today: todaySnapshot.size,
    week: weekSnapshot.size,
    month: monthSnapshot.size
  };
}

/**
 * Ручной запуск агрегации статистики (для тестирования)
 */
export const manualStatsAggregation = onCall({
  memory: '512MiB',
  timeoutSeconds: 300, // 5 минут
}, async (request) => {
  // Проверяем права доступа
  if (!request.auth?.token?.admin) {
    throw new Error('permission-denied');
  }

  try {
    logger.info('Manual stats aggregation triggered', {
      uid: request.auth.uid
    });

    // Выполняем агрегацию напрямую
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Агрегируем статистику параллельно
    const [
      usersStats,
      devicesStats,
      patternsStats,
      practicesStats,
      firmwareStats,
      hugsStats,
      sessionsStats
    ] = await Promise.all([
      aggregateUsersStats(dayAgo, weekAgo, monthAgo),
      aggregateDevicesStats(dayAgo, weekAgo, monthAgo),
      aggregatePatternsStats(dayAgo, weekAgo, monthAgo),
      aggregatePracticesStats(dayAgo, weekAgo, monthAgo),
      aggregateFirmwareStats(dayAgo, weekAgo, monthAgo),
      aggregateHugsStats(dayAgo, weekAgo, monthAgo),
      aggregateSessionsStats(dayAgo, weekAgo, monthAgo)
    ]);

    // Формируем итоговую статистику
    const stats = {
      lastUpdated: now,
      aggregationPeriod: 'manual',
      nextUpdate: new Date(now.getTime() + 60 * 60 * 1000),
      users: usersStats,
      devices: devicesStats,
      patterns: patternsStats,
      practices: practicesStats,
      firmware: firmwareStats,
      activity: {
        hugs: hugsStats,
        sessions: sessionsStats
      },
      overview: {
        totalUsers: usersStats.total,
        totalDevices: devicesStats.total,
        totalPatterns: patternsStats.total,
        totalPractices: practicesStats.total,
        totalFirmware: firmwareStats.total,
        activeUsersToday: usersStats.activeToday,
        newUsersToday: usersStats.newToday,
        hugsToday: hugsStats.today,
        sessionsToday: sessionsStats.today
      }
    };

    // Сохраняем в Firestore
    await db.collection('statistics').doc('overview').set(stats, { merge: true });

    return { success: true, result: stats.overview };
  } catch (error) {
    logger.error('Manual stats aggregation failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      uid: request.auth?.uid
    });
    throw new Error('Stats aggregation failed');
  }
});
