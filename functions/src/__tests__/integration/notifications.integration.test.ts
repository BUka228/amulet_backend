import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { getMessaging } from 'firebase-admin/messaging';
import { sendNotification } from '../../core/pushNotifications';

// Мокаем Firebase Admin Messaging
jest.mock('firebase-admin/messaging');

const mockGetMessaging = getMessaging as jest.MockedFunction<typeof getMessaging>;

describe('Notifications Integration Tests', () => {
  let testEnv: RulesTestEnvironment;
  let mockMessaging: any;

  beforeEach(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test',
      firestore: {
        rules: `
          rules_version = '2';
          service cloud.firestore {
            match /databases/{database}/documents {
              match /users/{userId} {
                allow read, write: if request.auth != null && request.auth.uid == userId;
                match /notificationTokens/{tokenId} {
                  allow read, write: if request.auth != null && request.auth.uid == userId;
                }
              }
            }
          }
        `,
      },
    });

    mockMessaging = {
      sendEachForMulticast: jest.fn(),
    };
    mockGetMessaging.mockReturnValue(mockMessaging);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('FCM Token Management', () => {
    it('should register and retrieve FCM tokens', async () => {
      const userId = 'test-user-123';
      const token = 'test-fcm-token-123';
      
      // Создаем пользователя
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore().collection('users').doc(userId).set({
          displayName: 'Test User',
          createdAt: new Date(),
        });
      });

      // Регистрируем токен
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await context.firestore()
          .collection('users')
          .doc(userId)
          .collection('notificationTokens')
          .add({
            userId,
            token,
            platform: 'ios',
            isActive: true,
            lastUsedAt: new Date(),
            createdAt: new Date(),
          });
      });

      // Проверяем, что токен зарегистрирован
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const tokensSnapshot = await context.firestore()
          .collection('users')
          .doc(userId)
          .collection('notificationTokens')
          .where('isActive', '==', true)
          .get();

        expect(tokensSnapshot).toBeDefined();
        expect(tokensSnapshot.size).toBe(1);
        expect(tokensSnapshot.docs[0].data().token).toBe(token);
      });
    });

    it('should send notification successfully', async () => {
      const userId = 'test-user-123';
      const token = 'valid-token-123';

      // Создаем пользователя с токеном
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const userRef = context.firestore().collection('users').doc(userId);
        await userRef.set({
          displayName: 'Test User',
          pushTokens: [token],
        });

        // Добавляем токен в подколлекцию
        await userRef.collection('notificationTokens').add({
          userId,
          token,
          platform: 'android',
          isActive: true,
          lastUsedAt: new Date(),
        });
      });

      // Мокаем успешный ответ FCM
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });

      // Отправляем уведомление
      const result = await sendNotification(
        userId,
        'hug.received',
        { type: 'hug.received', hugId: 'hug123' },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(result.tokensCount).toBe(1);
    });
  });

  describe('Notification Types', () => {
    beforeEach(async () => {
      // Создаем тестового пользователя с токеном
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const userId = 'test-user-123';
        const userRef = context.firestore().collection('users').doc(userId);
        
        await userRef.set({
          displayName: 'Test User',
          language: 'en',
          pushTokens: ['test-token-123'],
        });

        await userRef.collection('notificationTokens').add({
          userId,
          token: 'test-token-123',
          platform: 'ios',
          isActive: true,
          lastUsedAt: new Date(),
          createdAt: new Date(),
        });
      });

      // Настраиваем успешный ответ FCM
      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });
    });

    it('should send hug received notification', async () => {
      const result = await sendNotification(
        'test-user-123',
        'hug.received',
        {
          type: 'hug.received',
          hugId: 'hug123',
          fromUserId: 'user456',
          color: '#FFD166',
          patternId: 'warm',
        },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['test-token-123'],
        notification: {
          title: 'You received a hug',
          body: 'Open the app to feel it',
        },
        data: {
          type: 'hug.received',
          hugId: 'hug123',
          fromUserId: 'user456',
          color: '#FFD166',
          patternId: 'warm',
        },
      });
    });

    it('should send pair invite notification', async () => {
      const result = await sendNotification(
        'test-user-123',
        'pair.invite',
        {
          type: 'pair.invite',
          inviteId: 'invite123',
          fromUserId: 'user456',
        },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['test-token-123'],
        notification: {
          title: 'New connection request',
          body: 'Someone wants to connect with you',
        },
        data: {
          type: 'pair.invite',
          inviteId: 'invite123',
          fromUserId: 'user456',
        },
      });
    });

    it('should send practice reminder notification', async () => {
      const result = await sendNotification(
        'test-user-123',
        'practice.reminder',
        {
          type: 'practice.reminder',
          reminderType: 'daily',
        },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['test-token-123'],
        notification: {
          title: 'Time for your practice',
          body: 'Take a moment to breathe and center yourself',
        },
        data: {
          type: 'practice.reminder',
          reminderType: 'daily',
        },
      });
    });

    it('should send OTA available notification', async () => {
      const result = await sendNotification(
        'test-user-123',
        'ota.available',
        {
          type: 'ota.available',
          deviceId: 'device123',
          hardwareVersion: '200',
          currentVersion: '2.0.5',
          newVersion: '2.1.0',
        },
        'en'
      );

      expect(result.delivered).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['test-token-123'],
        notification: {
          title: 'Firmware update available',
          body: 'Your Amulet has a new update ready',
        },
        data: {
          type: 'ota.available',
          deviceId: 'device123',
          hardwareVersion: '200',
          currentVersion: '2.0.5',
          newVersion: '2.1.0',
        },
      });
    });
  });

  describe('Localization', () => {
    it('should send localized notifications', async () => {
      // Создаем пользователя с русской локализацией
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const userId = 'test-user-ru';
        const userRef = context.firestore().collection('users').doc(userId);
        
        await userRef.set({
          displayName: 'Тестовый Пользователь',
          language: 'ru',
          pushTokens: ['test-token-ru'],
        });

        await userRef.collection('notificationTokens').add({
          userId,
          token: 'test-token-ru',
          platform: 'android',
          isActive: true,
          lastUsedAt: new Date(),
          createdAt: new Date(),
        });
      });

      mockMessaging.sendEachForMulticast.mockResolvedValue({
        successCount: 1,
        failureCount: 0,
        responses: [{ success: true }],
      });

      const result = await sendNotification(
        'test-user-ru',
        'hug.received',
        { type: 'hug.received', hugId: 'hug123' },
        'ru'
      );

      expect(result.delivered).toBe(true);
      expect(mockMessaging.sendEachForMulticast).toHaveBeenCalledWith({
        tokens: ['test-token-ru'],
        notification: {
          title: 'Вы получили объятие',
          body: 'Откройте приложение, чтобы почувствовать его',
        },
        data: {
          type: 'hug.received',
          hugId: 'hug123',
        },
      });
    });
  });
});
