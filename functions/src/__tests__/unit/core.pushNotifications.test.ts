import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getMessaging } from 'firebase-admin/messaging';
import { db } from '../../core/firebase';
import { sendNotification, sendNotificationToMultiple, sendCustomNotification } from '../../core/pushNotifications';

// Мокаем Firebase Admin
jest.mock('firebase-admin/messaging');
jest.mock('../../core/firebase');
jest.mock('../../core/i18n', () => ({
  getMessage: jest.fn((context, key) => {
    const messages: Record<string, string> = {
      'push.hug.received.title': 'You received a hug',
      'push.hug.received.body': 'Open the app to feel it',
      'push.pair.invite.title': 'New connection request',
      'push.pair.invite.body': 'Someone wants to connect with you',
      'push.practice.reminder.title': 'Time for your practice',
      'push.practice.reminder.body': 'Take a moment to breathe and center yourself',
      'push.ota.available.title': 'Firmware update available',
      'push.ota.available.body': 'Your Amulet has a new update ready',
    };
    return messages[key] || key;
  }),
}));

const mockGetMessaging = getMessaging as jest.MockedFunction<typeof getMessaging>;
const mockDb = db as jest.Mocked<typeof db>;

describe('pushNotifications', () => {
  let mockMessaging: any;
  let mockCollection: any;
  let mockDoc: any;
  let mockWhere: any;
  let mockGet: any;

  beforeEach(() => {
    // Настраиваем моки
    mockGet = jest.fn();
    mockWhere = jest.fn().mockReturnValue({ get: mockGet });
    mockDoc = jest.fn().mockReturnValue({ collection: jest.fn().mockReturnValue({ where: mockWhere }) });
    mockCollection = jest.fn().mockReturnValue({ doc: mockDoc });
    mockDb.collection = mockCollection;

    mockMessaging = {
      sendEachForMulticast: jest.fn(),
    };
    mockGetMessaging.mockReturnValue(mockMessaging);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendNotification', () => {
    it('should send notification successfully', async () => {
      // Настраиваем моки для успешного получения токенов
      const mockTokensSnapshot = {
        docs: [
          { data: () => ({ token: 'token1' }) },
          { data: () => ({ token: 'token2' }) },
        ],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      // Настраиваем моки для успешной отправки
      const mockResponse = {
        successCount: 2,
        failureCount: 0,
        responses: [
          { success: true },
          { success: true },
        ],
      };
      mockMessaging.sendEachForMulticast.mockResolvedValue(mockResponse);

      const result = await sendNotification(
        'user123',
        'hug.received',
        {
          type: 'hug.received',
          hugId: 'hug123',
          fromUserId: 'user456',
        },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(result.tokensCount).toBe(2);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['token1', 'token2'],
        notification: {
          title: 'You received a hug',
          body: 'Open the app to feel it',
        },
        data: {
          type: 'hug.received',
          hugId: 'hug123',
          fromUserId: 'user456',
        },
      });
    });

    it('should handle no active tokens', async () => {
      const mockTokensSnapshot = { docs: [] };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      const result = await sendNotification(
        'user123',
        'hug.received',
        { type: 'hug.received' },
        'en'
      );

      expect(result.delivered).toBe(false);
      expect(result.tokensCount).toBe(0);
      expect(mockMessaging.sendEachForMulticast).not.toHaveBeenCalled();
    });

    it('should handle messaging errors', async () => {
      const mockTokensSnapshot = {
        docs: [{ data: () => ({ token: 'token1' }) }],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      mockMessaging.sendEachForMulticast.mockRejectedValue(new Error('FCM error'));

      const result = await sendNotification(
        'user123',
        'hug.received',
        { type: 'hug.received' },
        'en'
      );

      expect(result.delivered).toBe(false);
      expect(result.tokensCount).toBe(0);
    });

    it('should send notification successfully', async () => {
      const mockTokensSnapshot = {
        docs: [
          { data: () => ({ token: 'valid_token' }) },
        ],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      const mockResponse = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
      mockMessaging.sendEachForMulticast.mockResolvedValue(mockResponse);

      const result = await sendNotification(
        'user123',
        'hug.received',
        { type: 'hug.received' },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(result.tokensCount).toBe(1);
    });
  });

  describe('sendNotificationToMultiple', () => {
    it('should send notifications to multiple users', async () => {
      const mockTokensSnapshot = {
        docs: [{ data: () => ({ token: 'token1' }) }],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      const mockResponse = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
      mockMessaging.sendEachForMulticast.mockResolvedValue(mockResponse);

      const result = await sendNotificationToMultiple(
        ['user1', 'user2'],
        'practice.reminder',
        { type: 'practice.reminder' },
        'en'
      );

      expect(result.delivered).toBe(2);
      expect(result.totalTokens).toBe(2);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(2);
    });

    it('should handle batch processing', async () => {
      const mockTokensSnapshot = {
        docs: [{ data: () => ({ token: 'token1' }) }],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      const mockResponse = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
      mockMessaging.sendEachForMulticast.mockResolvedValue(mockResponse);

      // Создаем 15 пользователей для тестирования батчинга
      const userIds = Array.from({ length: 15 }, (_, i) => `user${i}`);

      const result = await sendNotificationToMultiple(
        userIds,
        'practice.reminder',
        { type: 'practice.reminder' },
        'en'
      );

      expect(result.delivered).toBe(15);
      expect(result.totalTokens).toBe(15);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledTimes(15);
    });
  });

  describe('sendCustomNotification', () => {
    it('should send custom notification', async () => {
      const mockTokensSnapshot = {
        docs: [{ data: () => ({ token: 'token1' }) }],
      };
      mockGet.mockResolvedValue(mockTokensSnapshot);

      const mockResponse = {
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      };
      mockMessaging.sendEachForMulticast.mockResolvedValue(mockResponse);

      const result = await sendCustomNotification(
        'user123',
        'Custom Title',
        'Custom Body',
        { customData: 'value' }
      );

      expect(result.delivered).toBe(true);
      expect(result.tokensCount).toBe(1);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['token1'],
        notification: {
          title: 'Custom Title',
          body: 'Custom Body',
        },
        data: { customData: 'value' },
      });
    });
  });
});
