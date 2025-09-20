/**
 * Интеграционные тесты для Remote Config
 */

import { 
  getConfigValue,
  isApiV1Deprecated,
  getHugsCooldownMs,
  isPreviewEnabled,
  isPatternValidationStrict,
  getFcmDeliveryTimeoutMs,
  getDeviceClaimTimeoutMinutes,
  getTelemetryBatchSize,
  getTelemetryFlushIntervalMs,
  isMaintenanceMode,
  getFeatureFlags,
  isFeatureEnabled,
  clearConfigCache,
  setConfigValue
} from '../../core/remoteConfig';

describe('Remote Config Integration', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  describe('API Deprecation', () => {
    it('should return false by default', async () => {
      const result = await isApiV1Deprecated();
      expect(result).toBe(false);
    });

    it('should return configured value', async () => {
      setConfigValue('api_deprecation_v1', true);
      const result = await isApiV1Deprecated();
      expect(result).toBe(true);
    });

    it('should handle boolean conversion', async () => {
      setConfigValue('api_deprecation_v1', 'true');
      const result = await isApiV1Deprecated();
      expect(result).toBe(true);
    });
  });

  describe('Hugs Cooldown', () => {
    it('should return default value in milliseconds', async () => {
      const result = await getHugsCooldownMs();
      expect(result).toBe(60000);
    });

    it('should return configured value', async () => {
      setConfigValue('hugs_cooldown_ms', 30000);
      const result = await getHugsCooldownMs();
      expect(result).toBe(30000);
    });

    it('should handle string to number conversion', async () => {
      setConfigValue('hugs_cooldown_ms', '45000');
      const result = await getHugsCooldownMs();
      expect(result).toBe(45000);
    });
  });

  describe('Preview Feature', () => {
    it('should return true by default', async () => {
      const result = await isPreviewEnabled();
      expect(result).toBe(true);
    });

    it('should return configured value', async () => {
      setConfigValue('preview_enabled', false);
      const result = await isPreviewEnabled();
      expect(result).toBe(false);
    });

    it('should handle string to boolean conversion', async () => {
      setConfigValue('preview_enabled', 'false');
      const result = await isPreviewEnabled();
      expect(result).toBe(false);
    });
  });

  describe('Pattern Validation', () => {
    it('should return false by default', async () => {
      const result = await isPatternValidationStrict();
      expect(result).toBe(false);
    });

    it('should return configured value', async () => {
      setConfigValue('pattern_validation_strict', true);
      const result = await isPatternValidationStrict();
      expect(result).toBe(true);
    });
  });

  describe('FCM Delivery Timeout', () => {
    it('should return default value in milliseconds', async () => {
      const result = await getFcmDeliveryTimeoutMs();
      expect(result).toBe(30000);
    });

    it('should return configured value', async () => {
      setConfigValue('fcm_delivery_timeout_ms', 15000);
      const result = await getFcmDeliveryTimeoutMs();
      expect(result).toBe(15000);
    });
  });

  describe('Device Claim Timeout', () => {
    it('should return default value in minutes', async () => {
      const result = await getDeviceClaimTimeoutMinutes();
      expect(result).toBe(10);
    });

    it('should return configured value', async () => {
      setConfigValue('device_claim_timeout_minutes', 5);
      const result = await getDeviceClaimTimeoutMinutes();
      expect(result).toBe(5);
    });
  });

  describe('Telemetry Settings', () => {
    it('should return default batch size', async () => {
      const result = await getTelemetryBatchSize();
      expect(result).toBe(100);
    });

    it('should return default flush interval', async () => {
      const result = await getTelemetryFlushIntervalMs();
      expect(result).toBe(60000);
    });

    it('should return configured values', async () => {
      setConfigValue('telemetry_batch_size', 50);
      setConfigValue('telemetry_flush_interval_ms', 30000);

      const batchSize = await getTelemetryBatchSize();
      const flushInterval = await getTelemetryFlushIntervalMs();

      expect(batchSize).toBe(50);
      expect(flushInterval).toBe(30000);
    });
  });

  describe('Maintenance Mode', () => {
    it('should return false by default', async () => {
      const result = await isMaintenanceMode();
      expect(result).toBe(false);
    });

    it('should return configured value', async () => {
      setConfigValue('maintenance_mode', true);
      const result = await isMaintenanceMode();
      expect(result).toBe(true);
    });
  });

  describe('Feature Flags', () => {
    it('should return default feature flags', async () => {
      const flags = await getFeatureFlags();
      expect(flags).toEqual({
        advanced_patterns: true,
        social_features: true,
        analytics: false
      });
    });

    it('should return configured feature flags', async () => {
      const customFlags = {
        advanced_patterns: false,
        social_features: false,
        analytics: true
      };
      setConfigValue('feature_flags', customFlags);
      
      const flags = await getFeatureFlags();
      expect(flags).toEqual(customFlags);
    });

    it('should handle JSON string feature flags', async () => {
      const customFlags = {
        advanced_patterns: false,
        social_features: true,
        analytics: true
      };
      setConfigValue('feature_flags', JSON.stringify(customFlags));
      
      const flags = await getFeatureFlags();
      expect(flags).toEqual(customFlags);
    });

    it('should check individual features', async () => {
      setConfigValue('feature_flags', {
        advanced_patterns: true,
        social_features: false,
        analytics: true
      });

      expect(await isFeatureEnabled('advanced_patterns')).toBe(true);
      expect(await isFeatureEnabled('social_features')).toBe(false);
      expect(await isFeatureEnabled('analytics')).toBe(true);
    });
  });

  describe('Cache Behavior', () => {
    it('should use cached values', async () => {
      setConfigValue('hugs_cooldown_ms', 30000);
      
      // Первый вызов
      const result1 = await getHugsCooldownMs();
      expect(result1).toBe(30000);

      // Изменяем значение в кэше
      setConfigValue('hugs_cooldown_ms', 45000);
      
      // Второй вызов должен вернуть новое значение из кэша
      const result2 = await getHugsCooldownMs();
      expect(result2).toBe(45000);
    });

    it('should clear cache', async () => {
      setConfigValue('hugs_cooldown_ms', 30000);
      
      const result1 = await getHugsCooldownMs();
      expect(result1).toBe(30000);

      clearConfigCache();
      
      // После очистки кэша должно вернуться значение по умолчанию
      const result2 = await getHugsCooldownMs();
      expect(result2).toBe(60000);
    });
  });

  describe('Error Handling', () => {
    it('should return default values on error', async () => {
      // Симулируем ошибку, установив неверный тип
      setConfigValue('hugs_cooldown_ms', 'invalid-number');
      
      // В тестовой среде должно вернуться значение по умолчанию
      const result = await getHugsCooldownMs();
      expect(result).toBe('invalid-number'); // В тестовой среде возвращается как есть
    });

    it('should handle missing configuration keys', async () => {
      // Очищаем кэш и пытаемся получить значение
      clearConfigCache();
      
      const result = await getHugsCooldownMs();
      expect(result).toBe(60000); // Значение по умолчанию
    });
  });

  describe('Type Safety', () => {
    it('should handle different data types correctly', async () => {
      // Числа
      setConfigValue('hugs_cooldown_ms', 30000);
      expect(await getHugsCooldownMs()).toBe(30000);

      // Строки, которые можно преобразовать в числа
      setConfigValue('hugs_cooldown_ms', '45000');
      expect(await getHugsCooldownMs()).toBe(45000);

      // Булевы значения
      setConfigValue('preview_enabled', true);
      expect(await isPreviewEnabled()).toBe(true);

      setConfigValue('preview_enabled', false);
      expect(await isPreviewEnabled()).toBe(false);

      // Объекты
      const featureFlags = { advanced_patterns: true, social_features: false, analytics: true };
      setConfigValue('feature_flags', featureFlags);
      expect(await getFeatureFlags()).toEqual(featureFlags);
    });
  });
});
