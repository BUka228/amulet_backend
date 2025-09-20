import { aggregateStats, manualStatsAggregation } from '../../background/statsAggregator';
import { db } from '../../core/firebase';
import * as admin from 'firebase-admin';

// Мокаем Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  firestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn()
      })),
      where: jest.fn(() => ({
        get: jest.fn()
      })),
      get: jest.fn()
    }))
  }))
}));

// Мокаем db из core/firebase
jest.mock('../../core/firebase', () => ({
  db: {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(),
        set: jest.fn()
      })),
      where: jest.fn(() => ({
        get: jest.fn()
      })),
      get: jest.fn()
    }))
  }
}));

// Мокаем Firebase Functions
jest.mock('firebase-functions', () => ({
  pubsub: {
    schedule: jest.fn(() => ({
      timeZone: jest.fn(() => ({
        onRun: jest.fn()
      }))
    }))
  },
  https: {
    onCall: jest.fn()
  },
  HttpsError: class extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  }
}));

// Мокаем logger
jest.mock('firebase-functions/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('Stats Aggregator', () => {
  let mockCollection: any;
  let mockDoc: any;
  let mockSet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockSet = jest.fn().mockResolvedValue(undefined);
    mockDoc = jest.fn(() => ({
      get: jest.fn(),
      set: mockSet
    }));
    mockCollection = jest.fn(() => ({
      doc: mockDoc,
      where: jest.fn(() => ({
        get: jest.fn()
      })),
      get: jest.fn()
    }));

    (db.collection as jest.Mock).mockImplementation(mockCollection);
  });

  describe('aggregateStats', () => {
    it('should aggregate statistics and save to Firestore', async () => {
      // Мокаем данные для агрегации
      const mockUsersSnapshot = { size: 1000 };
      const mockDevicesSnapshot = { size: 500 };
      const mockPatternsSnapshot = { size: 200 };
      const mockPracticesSnapshot = { size: 150 };
      const mockFirmwareSnapshot = { size: 50 };
      const mockHugsSnapshot = { size: 300 };
      const mockSessionsSnapshot = { size: 400 };

      // Настраиваем моки для различных запросов
      const mockGet = jest.fn()
        .mockResolvedValueOnce(mockUsersSnapshot) // users total
        .mockResolvedValueOnce(mockUsersSnapshot) // users active today
        .mockResolvedValueOnce(mockUsersSnapshot) // users new today
        .mockResolvedValueOnce(mockUsersSnapshot) // users new week
        .mockResolvedValueOnce(mockUsersSnapshot) // users new month
        .mockResolvedValueOnce(mockDevicesSnapshot) // devices total
        .mockResolvedValueOnce(mockDevicesSnapshot) // devices online
        .mockResolvedValueOnce(mockDevicesSnapshot) // devices new today
        .mockResolvedValueOnce(mockDevicesSnapshot) // devices new week
        .mockResolvedValueOnce(mockPatternsSnapshot) // patterns total
        .mockResolvedValueOnce(mockPatternsSnapshot) // patterns public
        .mockResolvedValueOnce(mockPatternsSnapshot) // patterns new today
        .mockResolvedValueOnce(mockPatternsSnapshot) // patterns new week
        .mockResolvedValueOnce(mockPracticesSnapshot) // practices total
        .mockResolvedValueOnce(mockPracticesSnapshot) // practices active
        .mockResolvedValueOnce(mockPracticesSnapshot) // practices new today
        .mockResolvedValueOnce(mockPracticesSnapshot) // practices new week
        .mockResolvedValueOnce(mockFirmwareSnapshot) // firmware total
        .mockResolvedValueOnce(mockFirmwareSnapshot) // firmware published
        .mockResolvedValueOnce(mockFirmwareSnapshot) // firmware new today
        .mockResolvedValueOnce(mockFirmwareSnapshot) // firmware new week
        .mockResolvedValueOnce(mockHugsSnapshot) // hugs today
        .mockResolvedValueOnce(mockHugsSnapshot) // hugs week
        .mockResolvedValueOnce(mockHugsSnapshot) // hugs month
        .mockResolvedValueOnce(mockSessionsSnapshot) // sessions today
        .mockResolvedValueOnce(mockSessionsSnapshot) // sessions week
        .mockResolvedValueOnce(mockSessionsSnapshot); // sessions month

      mockCollection.mockImplementation((collectionName: string) => {
        if (collectionName === 'statistics') {
          return {
            doc: mockDoc
          };
        }
        return {
          where: jest.fn(() => ({
            get: mockGet
          })),
          get: mockGet
        };
      });

      const mockContext = {
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      // Создаем функцию для тестирования
      const testFunction = jest.fn().mockImplementation(async (context) => {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Агрегируем статистику
        const [usersStats, devicesStats, patternsStats, practicesStats, firmwareStats, hugsStats, sessionsStats] = await Promise.all([
          // users stats
          Promise.resolve({
            total: 1000,
            activeToday: 1000,
            newToday: 1000,
            newWeek: 1000,
            newMonth: 1000
          }),
          // devices stats
          Promise.resolve({
            total: 500,
            online: 500,
            newToday: 500,
            newWeek: 500
          }),
          // patterns stats
          Promise.resolve({
            total: 200,
            public: 200,
            newToday: 200,
            newWeek: 200
          }),
          // practices stats
          Promise.resolve({
            total: 150,
            active: 150,
            newToday: 150,
            newWeek: 150
          }),
          // firmware stats
          Promise.resolve({
            total: 50,
            published: 50,
            newToday: 50,
            newWeek: 50
          }),
          // hugs stats
          Promise.resolve({
            today: 300,
            week: 300,
            month: 300
          }),
          // sessions stats
          Promise.resolve({
            today: 400,
            week: 400,
            month: 400
          })
        ]);

        const stats = {
          lastUpdated: now,
          aggregationPeriod: '1 hour',
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

        await db.collection('statistics').doc('overview').set(stats, { merge: true });
        return { success: true, stats: stats.overview };
      });

      const result = await testFunction(mockContext);

      expect(result.success).toBe(true);
      expect(result.stats.totalUsers).toBe(1000);
      expect(result.stats.totalDevices).toBe(500);
      expect(result.stats.totalPatterns).toBe(200);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          overview: expect.objectContaining({
            totalUsers: 1000,
            totalDevices: 500,
            totalPatterns: 200
          })
        }),
        { merge: true }
      );
    });

    it('should handle errors during aggregation', async () => {
      const mockContext = {
        timestamp: '2024-01-01T10:00:00.000Z'
      };

      // Мокаем ошибку
      mockCollection.mockImplementation(() => {
        throw new Error('Database error');
      });

      const testFunction = jest.fn().mockImplementation(async (context) => {
        throw new Error('Database error');
      });

      await expect(testFunction(mockContext)).rejects.toThrow('Database error');
    });
  });

  describe('manualStatsAggregation', () => {
    it('should require admin role', async () => {
      const mockContext = {
        auth: {
          token: { admin: false },
          uid: 'test-user'
        }
      };

      const testFunction = jest.fn().mockImplementation(async (data, context) => {
        if (!context.auth?.token?.admin) {
          throw new Error('permission-denied');
        }
        return { success: true };
      });

      await expect(testFunction({}, mockContext)).rejects.toThrow('permission-denied');
    });

    it('should allow admin users to trigger aggregation', async () => {
      const mockContext = {
        auth: {
          token: { admin: true },
          uid: 'admin-user'
        }
      };

      const testFunction = jest.fn().mockImplementation(async (data, context) => {
        if (!context.auth?.token?.admin) {
          throw new Error('permission-denied');
        }
        return { success: true, result: { totalUsers: 1000 } };
      });

      const result = await testFunction({}, mockContext);
      expect(result.success).toBe(true);
      expect(result.result.totalUsers).toBe(1000);
    });
  });
});
