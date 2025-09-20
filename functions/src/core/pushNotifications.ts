import { getMessaging } from 'firebase-admin/messaging';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import * as logger from 'firebase-functions/logger';

// Поддерживаемые языки
type SupportedLanguage = 'en' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'zh';

// Локализованные сообщения для push уведомлений
const PUSH_MESSAGES: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    'push.hug.received.title': 'You received a hug',
    'push.hug.received.body': 'Open the app to feel it',
    'push.pair.invite.title': 'New connection request',
    'push.pair.invite.body': 'Someone wants to connect with you',
    'push.practice.reminder.title': 'Time for your practice',
    'push.practice.reminder.body': 'Take a moment to breathe and center yourself',
    'push.ota.available.title': 'Firmware update available',
    'push.ota.available.body': 'Your Amulet has a new update ready',
  },
  ru: {
    'push.hug.received.title': 'Вы получили объятие',
    'push.hug.received.body': 'Откройте приложение, чтобы почувствовать его',
    'push.pair.invite.title': 'Новый запрос на связь',
    'push.pair.invite.body': 'Кто-то хочет подключиться к вам',
    'push.practice.reminder.title': 'Время для практики',
    'push.practice.reminder.body': 'Найдите момент, чтобы подышать и сосредоточиться',
    'push.ota.available.title': 'Доступно обновление прошивки',
    'push.ota.available.body': 'Ваш Амулет готов к обновлению',
  },
  es: {},
  fr: {},
  de: {},
  it: {},
  pt: {},
  ja: {},
  ko: {},
  zh: {},
};

// Простая функция для получения локализованного сообщения
function getLocalizedMessage(language: string, key: string): string {
  const lang = language as SupportedLanguage;
  const messages = PUSH_MESSAGES[lang] || PUSH_MESSAGES.en;
  
  // Если сообщение найдено в текущем языке
  if (messages[key]) {
    return messages[key];
  }
  
  // Fallback на английский
  if (lang !== 'en' && PUSH_MESSAGES.en[key]) {
    return PUSH_MESSAGES.en[key];
  }
  
  // Последний fallback - сам ключ
  return key;
}

export type NotificationEventType = 
  | 'hug.received'
  | 'pair.invite'
  | 'practice.reminder'
  | 'ota.available';

export interface NotificationData {
  type: NotificationEventType;
  [key: string]: string;
}

export interface NotificationTemplate {
  titleKey: string;
  bodyKey: string;
  data?: Record<string, string>;
}

// Карта событий и их шаблонов уведомлений
const NOTIFICATION_TEMPLATES: Record<NotificationEventType, NotificationTemplate> = {
  'hug.received': {
    titleKey: 'push.hug.received.title',
    bodyKey: 'push.hug.received.body',
  },
  'pair.invite': {
    titleKey: 'push.pair.invite.title',
    bodyKey: 'push.pair.invite.body',
  },
  'practice.reminder': {
    titleKey: 'push.practice.reminder.title',
    bodyKey: 'push.practice.reminder.body',
  },
  'ota.available': {
    titleKey: 'push.ota.available.title',
    bodyKey: 'push.ota.available.body',
  },
};

/**
 * Получает активные FCM токены пользователя
 */
async function getActiveTokens(userId: string): Promise<string[]> {
  try {
    const tokensSnap = await db
      .collection('users')
      .doc(userId)
      .collection('notificationTokens')
      .where('isActive', '==', true)
      .get();
    
    return tokensSnap.docs
      .map((doc) => (doc.data() as { token?: string }).token)
      .filter(Boolean)
      .sort() as string[];
  } catch (error) {
    logger.error('Failed to get active tokens', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

/**
 * Очищает невалидные FCM токены
 */
async function cleanupInvalidTokens(
  userId: string, 
  tokens: string[], 
  results: { success: boolean; error?: { code?: string } }[]
): Promise<void> {
  const invalidTokens: string[] = [];
  
  results.forEach((result, index) => {
    if (!result.success && result.error) {
      const errorCode = result.error?.code;
      if (errorCode === 'messaging/invalid-registration-token' || 
          errorCode === 'messaging/registration-token-not-registered') {
        invalidTokens.push(tokens[index]);
      }
    }
  });
  
  if (invalidTokens.length > 0) {
    try {
      const batch = db.batch();
      const userRef = db.collection('users').doc(userId);
      const tokensRef = userRef.collection('notificationTokens');
      
      for (const token of invalidTokens) {
        const tokenQuery = await tokensRef.where('token', '==', token).limit(1).get();
        if (!tokenQuery.empty) {
          const tokenDoc = tokenQuery.docs[0];
          batch.update(tokenDoc.ref, { 
            isActive: false,
            updatedAt: new Date(),
          });
        }
      }
      
      // Обновляем массив pushTokens в документе пользователя
      batch.update(userRef, {
        pushTokens: FieldValue.arrayRemove(...invalidTokens),
        updatedAt: new Date(),
      });
      
      await batch.commit();
      
      logger.info('Cleaned up invalid FCM tokens', {
        userId,
        invalidTokensCount: invalidTokens.length,
      });
    } catch (error) {
      logger.error('Failed to cleanup invalid tokens', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Отправляет уведомление пользователю
 */
export async function sendNotification(
  userId: string,
  eventType: NotificationEventType,
  data: NotificationData,
  language?: string
): Promise<{ delivered: boolean; tokensCount: number }> {
  try {
    const tokens = await getActiveTokens(userId);
    
    if (tokens.length === 0) {
      logger.info('No active tokens found for user', { userId, eventType });
      return { delivered: false, tokensCount: 0 };
    }
    
    const template = NOTIFICATION_TEMPLATES[eventType];
    if (!template) {
      logger.error('Unknown notification event type', { eventType });
      return { delivered: false, tokensCount: 0 };
    }
    
    // Создаем контекст для локализации
    const context = { language };
    
           const notification = {
             title: getLocalizedMessage(context.language || 'en', template.titleKey),
             body: getLocalizedMessage(context.language || 'en', template.bodyKey),
           };
    
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification,
      data: {
        ...data,
        ...template.data,
      },
    });
    
    // Очищаем невалидные токены
    await cleanupInvalidTokens(userId, tokens, response.responses);
    
    const delivered = response.successCount > 0;
    
    logger.info('Notification sent', {
      userId,
      eventType,
      tokensCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      delivered,
    });
    
    return { delivered, tokensCount: tokens.length };
  } catch (error) {
    logger.error('Failed to send notification', {
      userId,
      eventType,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { delivered: false, tokensCount: 0 };
  }
}

/**
 * Отправляет уведомление нескольким пользователям
 */
export async function sendNotificationToMultiple(
  userIds: string[],
  eventType: NotificationEventType,
  data: NotificationData,
  language?: string
): Promise<{ delivered: number; totalTokens: number }> {
  let totalDelivered = 0;
  let totalTokens = 0;
  
  // Обрабатываем пользователей батчами для избежания превышения лимитов
  const batchSize = 10;
  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    
    const promises = batch.map(async (userId) => {
      const result = await sendNotification(userId, eventType, data, language);
      return { userId, ...result };
    });
    
    const results = await Promise.all(promises);
    
    for (const result of results) {
      if (result.delivered) {
        totalDelivered++;
      }
      totalTokens += result.tokensCount;
    }
  }
  
  logger.info('Batch notification sent', {
    eventType,
    totalUsers: userIds.length,
    deliveredUsers: totalDelivered,
    totalTokens,
  });
  
  return { delivered: totalDelivered, totalTokens };
}

/**
 * Отправляет уведомление с кастомными данными (для специальных случаев)
 */
export async function sendCustomNotification(
  userId: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<{ delivered: boolean; tokensCount: number }> {
  try {
    const tokens = await getActiveTokens(userId);
    
    if (tokens.length === 0) {
      logger.info('No active tokens found for user', { userId });
      return { delivered: false, tokensCount: 0 };
    }
    
    const messaging = getMessaging();
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
    });
    
    // Очищаем невалидные токены
    await cleanupInvalidTokens(userId, tokens, response.responses);
    
    const delivered = response.successCount > 0;
    
    logger.info('Custom notification sent', {
      userId,
      tokensCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      delivered,
    });
    
    return { delivered, tokensCount: tokens.length };
  } catch (error) {
    logger.error('Failed to send custom notification', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { delivered: false, tokensCount: 0 };
  }
}
