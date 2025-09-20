import request from 'supertest';
import { app } from '../../api/test';
import { db } from '../../core/firebase';

describe('Integration: Admin Statistics', () => {
  const adminUid = 'admin-test-user';

  beforeEach(async () => {
    // Очищаем статистику перед каждым тестом
    await db.collection('statistics').doc('overview').delete();
  });

  afterEach(async () => {
    // Очищаем после тестов
    await db.collection('statistics').doc('overview').delete();
  });

  describe('GET /v1/admin/stats/overview', () => {
    it('should return empty stats when no aggregated data exists', async () => {
      const res = await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', adminUid)
        .set('X-Test-Admin', '1')
        .expect(200);

      expect(res.body).toEqual({
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
    });

    it('should return aggregated stats when data exists', async () => {
      // Создаем тестовые агрегированные данные
      const now = new Date();
      const testStats = {
        lastUpdated: now,
        aggregationPeriod: '1 hour',
        nextUpdate: new Date(now.getTime() + 60 * 60 * 1000),
        users: {
          total: 1000,
          activeToday: 800,
          newToday: 50,
          newWeek: 300,
          newMonth: 1200
        },
        devices: {
          total: 500,
          online: 450,
          newToday: 25,
          newWeek: 150
        },
        patterns: {
          total: 200,
          public: 180,
          newToday: 10,
          newWeek: 60
        },
        practices: {
          total: 150,
          active: 140,
          newToday: 5,
          newWeek: 30
        },
        firmware: {
          total: 50,
          published: 45,
          newToday: 2,
          newWeek: 8
        },
        activity: {
          hugs: {
            today: 300,
            week: 2000,
            month: 8000
          },
          sessions: {
            today: 400,
            week: 2500,
            month: 10000
          }
        },
        overview: {
          totalUsers: 1000,
          totalDevices: 500,
          totalPatterns: 200,
          totalPractices: 150,
          totalFirmware: 50,
          activeUsersToday: 800,
          newUsersToday: 50,
          hugsToday: 300,
          sessionsToday: 400
        }
      };

      // Сохраняем в Firestore
      await db.collection('statistics').doc('overview').set(testStats);

      const res = await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', adminUid)
        .set('X-Test-Admin', '1')
        .expect(200);

      expect(res.body.overview.totalUsers).toBe(1000);
      expect(res.body.overview.totalDevices).toBe(500);
      expect(res.body.overview.totalPatterns).toBe(200);
      expect(res.body.overview.activeUsersToday).toBe(800);
      expect(res.body.overview.hugsToday).toBe(300);
      expect(res.body.overview.sessionsToday).toBe(400);
      expect(res.body.lastUpdated).toBeDefined();
      expect(res.body.aggregationPeriod).toBe('1 hour');
    });

    it('should require admin role', async () => {
      await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', 'regular-user')
        .expect(403);
    });

    it('should handle stale data gracefully', async () => {
      // Создаем старые данные (старше 2 часов)
      const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3 часа назад
      const testStats = {
        lastUpdated: oldDate,
        aggregationPeriod: '1 hour',
        nextUpdate: new Date(oldDate.getTime() + 60 * 60 * 1000),
        users: { total: 1000, activeToday: 800, newToday: 50 },
        devices: { total: 500, online: 450, newToday: 25 },
        patterns: { total: 200, public: 180, newToday: 10 },
        practices: { total: 150, active: 140, newToday: 5 },
        firmware: { total: 50, published: 45, newToday: 2 },
        activity: { hugs: { today: 300, week: 2000 }, sessions: { today: 400, week: 2500 } },
        overview: {
          totalUsers: 1000,
          totalDevices: 500,
          totalPatterns: 200,
          totalPractices: 150,
          totalFirmware: 50,
          activeUsersToday: 800,
          newUsersToday: 50,
          hugsToday: 300,
          sessionsToday: 400
        }
      };

      await db.collection('statistics').doc('overview').set(testStats);

      const res = await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', adminUid)
        .set('X-Test-Admin', '1')
        .expect(200);

      // Данные должны возвращаться, но они устаревшие
      expect(res.body.overview.totalUsers).toBe(1000);
      expect(res.body.lastUpdated).toBeDefined();
    });

    it('should handle malformed data gracefully', async () => {
      // Создаем некорректные данные
      const malformedStats = {
        lastUpdated: 'invalid-date',
        users: { total: 'not-a-number' },
        overview: null,
        aggregationPeriod: '1 hour',
        nextUpdate: null
      };

      await db.collection('statistics').doc('overview').set(malformedStats);

      const res = await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', adminUid)
        .set('X-Test-Admin', '1')
        .expect(200);

      // Должны получить данные, даже если они некорректные
      expect(res.body).toBeDefined();
      expect(res.body).toHaveProperty('lastUpdated');
    });
  });

  describe('Statistics data structure validation', () => {
    it('should have correct data structure for aggregated stats', async () => {
      const now = new Date();
      const testStats = {
        lastUpdated: now,
        aggregationPeriod: '1 hour',
        nextUpdate: new Date(now.getTime() + 60 * 60 * 1000),
        users: {
          total: 1000,
          activeToday: 800,
          newToday: 50,
          newWeek: 300,
          newMonth: 1200
        },
        devices: {
          total: 500,
          online: 450,
          newToday: 25,
          newWeek: 150
        },
        patterns: {
          total: 200,
          public: 180,
          newToday: 10,
          newWeek: 60
        },
        practices: {
          total: 150,
          active: 140,
          newToday: 5,
          newWeek: 30
        },
        firmware: {
          total: 50,
          published: 45,
          newToday: 2,
          newWeek: 8
        },
        activity: {
          hugs: {
            today: 300,
            week: 2000,
            month: 8000
          },
          sessions: {
            today: 400,
            week: 2500,
            month: 10000
          }
        },
        overview: {
          totalUsers: 1000,
          totalDevices: 500,
          totalPatterns: 200,
          totalPractices: 150,
          totalFirmware: 50,
          activeUsersToday: 800,
          newUsersToday: 50,
          hugsToday: 300,
          sessionsToday: 400
        }
      };

      await db.collection('statistics').doc('overview').set(testStats);

      const res = await request(app)
        .get('/v1/admin/stats/overview')
        .set('X-Test-Uid', adminUid)
        .set('X-Test-Admin', '1')
        .expect(200);

      // Проверяем структуру ответа
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('devices');
      expect(res.body).toHaveProperty('patterns');
      expect(res.body).toHaveProperty('practices');
      expect(res.body).toHaveProperty('firmware');
      expect(res.body).toHaveProperty('activity');
      expect(res.body).toHaveProperty('overview');
      expect(res.body).toHaveProperty('lastUpdated');
      expect(res.body).toHaveProperty('aggregationPeriod');
      expect(res.body).toHaveProperty('nextUpdate');

      // Проверяем вложенную структуру
      expect(res.body.users).toHaveProperty('total');
      expect(res.body.users).toHaveProperty('activeToday');
      expect(res.body.users).toHaveProperty('newToday');
      expect(res.body.activity).toHaveProperty('hugs');
      expect(res.body.activity).toHaveProperty('sessions');
      expect(res.body.activity.hugs).toHaveProperty('today');
      expect(res.body.activity.hugs).toHaveProperty('week');
      expect(res.body.activity.hugs).toHaveProperty('month');
    });
  });
});
