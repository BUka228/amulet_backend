/**
 * Утилиты для работы с Firebase Remote Config
 * 
 * Позволяет получать конфигурационные параметры без пересборки приложения.
 * В тестовой среде возвращает значения по умолчанию.
 */

import { getRemoteConfig } from 'firebase-admin/remote-config';
import * as logger from 'firebase-functions/logger';

// Кэш для конфигурации (обновляется при каждом запросе)
let configCache: Record<string, unknown> = {};
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

// Значения по умолчанию для всех параметров
const DEFAULT_VALUES = {
  max_notification_tokens: 20,
  max_devices_per_user: 5,
  max_patterns_per_user: 100,
  max_practices_per_user: 50,
  max_rules_per_user: 20,
  session_timeout_minutes: 30,
  hug_cooldown_seconds: 60,
  pattern_share_cooldown_seconds: 300,
  webhook_timeout_seconds: 30,
  outbox_retry_attempts: 5,
  outbox_retry_backoff_base_ms: 1000,
} as const;

type ConfigKey = keyof typeof DEFAULT_VALUES;

/**
 * Получает значение из Remote Config с fallback на значение по умолчанию
 */
export async function getConfigValue<T = unknown>(key: ConfigKey): Promise<T> {
  // В тестовой среде проверяем кэш, иначе возвращаем значения по умолчанию
  if (process.env.NODE_ENV === 'test' || process.env.FIRESTORE_EMULATOR_HOST) {
    return (configCache[key] !== undefined ? configCache[key] : DEFAULT_VALUES[key]) as T;
  }

  try {
    // Проверяем кэш
    const now = Date.now();
    if (now - lastFetchTime < CACHE_TTL_MS && configCache[key] !== undefined) {
      return configCache[key] as T;
    }

    // Получаем конфигурацию из Remote Config
    const remoteConfig = getRemoteConfig();
    const template = await remoteConfig.getTemplate();
    
    // Обновляем кэш
    configCache = {};
    for (const [paramKey, param] of Object.entries(template.parameters)) {
      const defaultValue = param.defaultValue;
      if (defaultValue) {
        // Парсим значение в зависимости от типа
        let value: unknown = 'value' in defaultValue ? defaultValue.value : defaultValue;
        
        // Пытаемся распарсить как JSON для сложных типов
        if (typeof value === 'string') {
          try {
            value = JSON.parse(value);
          } catch {
            // Оставляем как строку, если не JSON
          }
        }
        
        configCache[paramKey] = value;
      }
    }
    
    lastFetchTime = now;
    
    // Возвращаем значение из кэша или значение по умолчанию
    const value = configCache[key] !== undefined ? configCache[key] : DEFAULT_VALUES[key];
    
    logger.debug('Remote Config value retrieved', { key, value, fromCache: configCache[key] !== undefined });
    return value as T;
    
  } catch (error) {
    logger.warn('Failed to get Remote Config value, using default', { 
      key, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return DEFAULT_VALUES[key] as T;
  }
}

/**
 * Получает лимит токенов уведомлений
 */
export async function getMaxNotificationTokens(): Promise<number> {
  return await getConfigValue<number>('max_notification_tokens');
}

/**
 * Получает лимит устройств на пользователя
 */
export async function getMaxDevicesPerUser(): Promise<number> {
  return await getConfigValue<number>('max_devices_per_user');
}

/**
 * Получает лимит паттернов на пользователя
 */
export async function getMaxPatternsPerUser(): Promise<number> {
  return await getConfigValue<number>('max_patterns_per_user');
}

/**
 * Получает лимит практик на пользователя
 */
export async function getMaxPracticesPerUser(): Promise<number> {
  return await getConfigValue<number>('max_practices_per_user');
}

/**
 * Получает лимит правил на пользователя
 */
export async function getMaxRulesPerUser(): Promise<number> {
  return await getConfigValue<number>('max_rules_per_user');
}

/**
 * Получает таймаут сессии в минутах
 */
export async function getSessionTimeoutMinutes(): Promise<number> {
  return await getConfigValue<number>('session_timeout_minutes');
}

/**
 * Получает кулдаун между объятиями в секундах
 */
export async function getHugCooldownSeconds(): Promise<number> {
  return await getConfigValue<number>('hug_cooldown_seconds');
}

/**
 * Получает кулдаун между шарингом паттернов в секундах
 */
export async function getPatternShareCooldownSeconds(): Promise<number> {
  return await getConfigValue<number>('pattern_share_cooldown_seconds');
}

/**
 * Получает таймаут webhook в секундах
 */
export async function getWebhookTimeoutSeconds(): Promise<number> {
  return await getConfigValue<number>('webhook_timeout_seconds');
}

/**
 * Получает количество попыток повтора для outbox
 */
export async function getOutboxRetryAttempts(): Promise<number> {
  return await getConfigValue<number>('outbox_retry_attempts');
}

/**
 * Получает базовое время backoff для outbox в миллисекундах
 */
export async function getOutboxRetryBackoffBaseMs(): Promise<number> {
  return await getConfigValue<number>('outbox_retry_backoff_base_ms');
}

/**
 * Очищает кэш конфигурации (для тестов)
 */
export function clearConfigCache(): void {
  configCache = {};
  lastFetchTime = 0;
}

/**
 * Устанавливает значение в кэш (для тестов)
 */
export function setConfigValue(key: ConfigKey, value: unknown): void {
  configCache[key] = value;
}
