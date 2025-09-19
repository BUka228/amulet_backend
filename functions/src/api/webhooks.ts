import express, { Request, Response } from 'express';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import * as logger from 'firebase-functions/logger';
import crypto from 'crypto';
import { Rule } from '../types/firestore';

export const webhooksRouter = express.Router();
// Вебхуки публичны и не требуют аутентификации

// Интерфейс для вебхука (для будущего использования)
// interface WebhookPayload {
//   integrationKey: string;
//   timestamp: number;
//   signature: string;
//   data: Record<string, unknown>;
// }

// Валидация подписи HMAC SHA-256
function validateWebhookSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    logger.error('Webhook signature validation failed', { error });
    return false;
  }
}

// Проверка на replay атаки (защита от повтора)
async function checkReplayProtection(signature: string, timestamp: number): Promise<boolean> {
  try {
    const now = Date.now();
    const timeDiff = Math.abs(now - timestamp);
    
    // Проверяем, что запрос не старше 5 минут
    if (timeDiff > 5 * 60 * 1000) {
      logger.warn('Webhook timestamp too old', { timestamp, now, timeDiff });
      return false;
    }

    // Проверяем, что подпись не использовалась ранее
    const replayKey = `webhook_replay_${signature}`;
    const replayRef = db.collection('webhookReplays').doc(replayKey);
    
    const replayDoc = await replayRef.get();
    if (replayDoc.exists) {
      logger.warn('Webhook replay detected', { signature, timestamp });
      return false;
    }

    // Сохраняем подпись для предотвращения повторов (TTL 10 минут)
    await replayRef.set({
      signature,
      timestamp,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + 10 * 60 * 1000), // 10 минут
    });

    return true;
  } catch (error) {
    logger.error('Replay protection check failed', { error, signature, timestamp });
    return false;
  }
}

// Получение секрета интеграции
async function getWebhookSecret(integrationKey: string): Promise<string | null> {
  try {
    const webhookRef = db.collection('webhooks').doc(integrationKey);
    const webhookDoc = await webhookRef.get();
    
    if (!webhookDoc.exists) {
      return null;
    }

    const webhookData = webhookDoc.data();
    if (!webhookData?.isActive) {
      return null;
    }

    return webhookData.secret;
  } catch (error) {
    logger.error('Failed to get webhook secret', { error, integrationKey });
    return null;
  }
}

// Обработка вебхука
async function processWebhook(integrationKey: string, data: Record<string, unknown>): Promise<void> {
  try {
    // Находим активные правила с триггером webhook
    const rulesSnapshot = await db
      .collection('rules')
      .where('enabled', '==', true)
      .where('trigger.type', '==', 'webhook')
      .get();

    const matchingRules: Rule[] = rulesSnapshot.docs
      .map((doc) => ({ id: doc.id, ...(doc.data() as Omit<Rule, 'id'>) }))
      .filter((rule: Rule) => {
        const triggerParams = rule.trigger?.params || {};
        return (triggerParams as Record<string, unknown>).integrationKey === integrationKey;
      });

    // Выполняем действия для каждого подходящего правила
    for (const rule of matchingRules) {
      try {
        await executeRuleAction(rule, data);
        
        // Обновляем счетчик срабатываний
        await db.collection('rules').doc(rule.id).update({
          triggerCount: FieldValue.increment(1),
          lastTriggeredAt: FieldValue.serverTimestamp(),
        });

        logger.info('Rule triggered by webhook', { 
          ruleId: rule.id, 
          integrationKey,
          triggerCount: (rule.triggerCount || 0) + 1 
        });
      } catch (error) {
        logger.error('Failed to execute rule action', { 
          error, 
          ruleId: rule.id, 
          integrationKey 
        });
      }
    }
  } catch (error) {
    logger.error('Failed to process webhook', { error, integrationKey });
    throw error;
  }
}

// Выполнение действия правила
async function executeRuleAction(rule: Rule, webhookData: Record<string, unknown>): Promise<void> {
  const action = rule.action;
  
  switch (action.type) {
    case 'start_practice':
      // Запуск практики
      await startPracticeFromRule(rule.ownerId, action.params, webhookData);
      break;
      
    case 'send_hug':
      // Отправка объятия
      await sendHugFromRule(rule.ownerId, action.params, webhookData);
      break;
      
    case 'light_device':
      // Подсветка устройства
      await lightDeviceFromRule(rule.ownerId, action.params, webhookData);
      break;
      
    case 'smart_home':
      // Управление умным домом
      await controlSmartHomeFromRule(rule.ownerId, action.params, webhookData);
      break;
      
    case 'notification':
      // Отправка уведомления
      await sendNotificationFromRule(rule.ownerId, action.params, webhookData);
      break;
      
    default:
      logger.warn('Unknown rule action type', { actionType: action.type, ruleId: rule.id });
  }
}

// Вспомогательные функции для выполнения действий
async function startPracticeFromRule(ownerId: string, params: Record<string, unknown>, webhookData: Record<string, unknown>): Promise<void> {
  // Реализация запуска практики по правилу
  logger.info('Starting practice from rule', { ownerId, params, webhookData });
}

async function sendHugFromRule(ownerId: string, params: Record<string, unknown>, webhookData: Record<string, unknown>): Promise<void> {
  // Реализация отправки объятия по правилу
  logger.info('Sending hug from rule', { ownerId, params, webhookData });
}

async function lightDeviceFromRule(ownerId: string, params: Record<string, unknown>, webhookData: Record<string, unknown>): Promise<void> {
  // Реализация подсветки устройства по правилу
  logger.info('Lighting device from rule', { ownerId, params, webhookData });
}

async function controlSmartHomeFromRule(ownerId: string, params: Record<string, unknown>, webhookData: Record<string, unknown>): Promise<void> {
  // Реализация управления умным домом по правилу
  logger.info('Controlling smart home from rule', { ownerId, params, webhookData });
}

async function sendNotificationFromRule(ownerId: string, params: Record<string, unknown>, webhookData: Record<string, unknown>): Promise<void> {
  // Реализация отправки уведомления по правилу
  logger.info('Sending notification from rule', { ownerId, params, webhookData });
}

// POST /webhooks/:integrationKey - Входящий вебхук триггера
webhooksRouter.post('/webhooks/:integrationKey', async (req: Request, res: Response) => {
  try {
    const { integrationKey } = req.params;
    const signatureHeader = req.headers['x-signature'] || req.headers['X-Signature'] || req.headers['X-signature'];
    const timestampHeader = req.headers['x-timestamp'] || req.headers['X-Timestamp'] || req.headers['X-timestamp'];
    const signature = (signatureHeader as string) || '';
    const timestamp = parseInt((timestampHeader as string) || '') || Date.now();
    
    if (!signature) {
      return sendError(res, { 
        code: 'invalid_argument', 
        message: 'Missing X-Signature header' 
      });
    }

    // Получаем секрет интеграции
    const secret = await getWebhookSecret(integrationKey);
    if (!secret) {
      return sendError(res, { 
        code: 'not_found', 
        message: 'Integration not found or inactive' 
      });
    }

    // Валидируем подпись
    const payload = JSON.stringify(req.body);
    if (!validateWebhookSignature(payload, signature, secret)) {
      return sendError(res, { 
        code: 'permission_denied', 
        message: 'Invalid signature' 
      });
    }

    // Проверяем защиту от повторов
    if (!(await checkReplayProtection(signature, timestamp))) {
      return sendError(res, { 
        code: 'failed_precondition', 
        message: 'Request rejected (replay protection)' 
      });
    }

    // Обрабатываем вебхук
    await processWebhook(integrationKey, req.body);

    // Обновляем статистику использования вебхука
    await db.collection('webhooks').doc(integrationKey).update({
      lastUsedAt: FieldValue.serverTimestamp(),
      usageCount: FieldValue.increment(1),
    });

    logger.info('Webhook processed successfully', { integrationKey, timestamp });
    res.status(202).json({ accepted: true });
  } catch (error) {
    logger.error('Webhook processing failed', { 
      error, 
      integrationKey: req.params.integrationKey 
    });
    return sendError(res, { 
      code: 'internal', 
      message: 'Webhook processing failed' 
    });
  }
});
