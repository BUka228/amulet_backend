import { 
  getConfigValue, 
  getMaxNotificationTokens, 
  getMaxDevicesPerUser,
  getMaxPatternsPerUser,
  getMaxPracticesPerUser,
  getMaxRulesPerUser,
  getSessionTimeoutMinutes,
  getHugCooldownSeconds,
  getPatternShareCooldownSeconds,
  getWebhookTimeoutSeconds,
  getOutboxRetryAttempts,
  getOutboxRetryBackoffBaseMs,
  clearConfigCache,
  setConfigValue,
  // Новые функции для шага 11
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
  isFeatureEnabled
} from '../../core/remoteConfig';

describe('Remote Config', () => {
  beforeEach(() => {
    clearConfigCache();
  });

  describe('getConfigValue', () => {
    it('returns default values in test environment', async () => {
      const value = await getConfigValue('max_notification_tokens');
      expect(value).toBe(20);
    });

    it('returns cached values when available', async () => {
      setConfigValue('max_notification_tokens', 50);
      const value = await getConfigValue('max_notification_tokens');
      expect(value).toBe(50);
    });

    it('returns different types correctly', async () => {
      setConfigValue('max_notification_tokens', 25);
      setConfigValue('session_timeout_minutes', 45);
      setConfigValue('hug_cooldown_seconds', 120);

      expect(await getConfigValue('max_notification_tokens')).toBe(25);
      expect(await getConfigValue('session_timeout_minutes')).toBe(45);
      expect(await getConfigValue('hug_cooldown_seconds')).toBe(120);
    });
  });

  describe('specific getters', () => {
    it('getMaxNotificationTokens returns correct value', async () => {
      setConfigValue('max_notification_tokens', 30);
      const value = await getMaxNotificationTokens();
      expect(value).toBe(30);
    });

    it('getMaxDevicesPerUser returns correct value', async () => {
      setConfigValue('max_devices_per_user', 10);
      const value = await getMaxDevicesPerUser();
      expect(value).toBe(10);
    });

    it('getMaxPatternsPerUser returns correct value', async () => {
      setConfigValue('max_patterns_per_user', 200);
      const value = await getMaxPatternsPerUser();
      expect(value).toBe(200);
    });

    it('getMaxPracticesPerUser returns correct value', async () => {
      setConfigValue('max_practices_per_user', 100);
      const value = await getMaxPracticesPerUser();
      expect(value).toBe(100);
    });

    it('getMaxRulesPerUser returns correct value', async () => {
      setConfigValue('max_rules_per_user', 50);
      const value = await getMaxRulesPerUser();
      expect(value).toBe(50);
    });

    it('getSessionTimeoutMinutes returns correct value', async () => {
      setConfigValue('session_timeout_minutes', 60);
      const value = await getSessionTimeoutMinutes();
      expect(value).toBe(60);
    });

    it('getHugCooldownSeconds returns correct value', async () => {
      setConfigValue('hug_cooldown_seconds', 180);
      const value = await getHugCooldownSeconds();
      expect(value).toBe(180);
    });

    it('getPatternShareCooldownSeconds returns correct value', async () => {
      setConfigValue('pattern_share_cooldown_seconds', 600);
      const value = await getPatternShareCooldownSeconds();
      expect(value).toBe(600);
    });

    it('getWebhookTimeoutSeconds returns correct value', async () => {
      setConfigValue('webhook_timeout_seconds', 60);
      const value = await getWebhookTimeoutSeconds();
      expect(value).toBe(60);
    });

    it('getOutboxRetryAttempts returns correct value', async () => {
      setConfigValue('outbox_retry_attempts', 10);
      const value = await getOutboxRetryAttempts();
      expect(value).toBe(10);
    });

    it('getOutboxRetryBackoffBaseMs returns correct value', async () => {
      setConfigValue('outbox_retry_backoff_base_ms', 2000);
      const value = await getOutboxRetryBackoffBaseMs();
      expect(value).toBe(2000);
    });
  });

  describe('cache management', () => {
    it('clearConfigCache removes all cached values', async () => {
      setConfigValue('max_notification_tokens', 50);
      setConfigValue('max_devices_per_user', 10);
      
      clearConfigCache();
      
      // После очистки кэша должны вернуться значения по умолчанию
      expect(await getConfigValue('max_notification_tokens')).toBe(20);
      expect(await getConfigValue('max_devices_per_user')).toBe(5);
    });

    it('setConfigValue updates cached values', async () => {
      setConfigValue('max_notification_tokens', 25);
      expect(await getConfigValue('max_notification_tokens')).toBe(25);
      
      setConfigValue('max_notification_tokens', 35);
      expect(await getConfigValue('max_notification_tokens')).toBe(35);
    });
  });

  describe('default values', () => {
    it('returns correct default values for all parameters', async () => {
      expect(await getMaxNotificationTokens()).toBe(20);
      expect(await getMaxDevicesPerUser()).toBe(5);
      expect(await getMaxPatternsPerUser()).toBe(100);
      expect(await getMaxPracticesPerUser()).toBe(50);
      expect(await getMaxRulesPerUser()).toBe(20);
      expect(await getSessionTimeoutMinutes()).toBe(30);
      expect(await getHugCooldownSeconds()).toBe(60);
      expect(await getPatternShareCooldownSeconds()).toBe(300);
      expect(await getWebhookTimeoutSeconds()).toBe(30);
      expect(await getOutboxRetryAttempts()).toBe(5);
      expect(await getOutboxRetryBackoffBaseMs()).toBe(1000);
    });
  });

  // ===== Тесты для новых функций шага 11 =====

  describe('step 11 - new feature flags and timing', () => {
    describe('API deprecation', () => {
      it('isApiV1Deprecated returns false by default', async () => {
        expect(await isApiV1Deprecated()).toBe(false);
      });

      it('isApiV1Deprecated returns configured value', async () => {
        setConfigValue('api_deprecation_v1', true);
        expect(await isApiV1Deprecated()).toBe(true);
      });
    });

    describe('hugs cooldown', () => {
      it('getHugsCooldownMs returns correct default value', async () => {
        expect(await getHugsCooldownMs()).toBe(60000);
      });

      it('getHugsCooldownMs returns configured value', async () => {
        setConfigValue('hugs_cooldown_ms', 30000);
        expect(await getHugsCooldownMs()).toBe(30000);
      });
    });

    describe('preview feature', () => {
      it('isPreviewEnabled returns true by default', async () => {
        expect(await isPreviewEnabled()).toBe(true);
      });

      it('isPreviewEnabled returns configured value', async () => {
        setConfigValue('preview_enabled', false);
        expect(await isPreviewEnabled()).toBe(false);
      });
    });

    describe('pattern validation', () => {
      it('isPatternValidationStrict returns false by default', async () => {
        expect(await isPatternValidationStrict()).toBe(false);
      });

      it('isPatternValidationStrict returns configured value', async () => {
        setConfigValue('pattern_validation_strict', true);
        expect(await isPatternValidationStrict()).toBe(true);
      });
    });

    describe('FCM delivery timeout', () => {
      it('getFcmDeliveryTimeoutMs returns correct default value', async () => {
        expect(await getFcmDeliveryTimeoutMs()).toBe(30000);
      });

      it('getFcmDeliveryTimeoutMs returns configured value', async () => {
        setConfigValue('fcm_delivery_timeout_ms', 15000);
        expect(await getFcmDeliveryTimeoutMs()).toBe(15000);
      });
    });

    describe('device claim timeout', () => {
      it('getDeviceClaimTimeoutMinutes returns correct default value', async () => {
        expect(await getDeviceClaimTimeoutMinutes()).toBe(10);
      });

      it('getDeviceClaimTimeoutMinutes returns configured value', async () => {
        setConfigValue('device_claim_timeout_minutes', 5);
        expect(await getDeviceClaimTimeoutMinutes()).toBe(5);
      });
    });

    describe('telemetry settings', () => {
      it('getTelemetryBatchSize returns correct default value', async () => {
        expect(await getTelemetryBatchSize()).toBe(100);
      });

      it('getTelemetryFlushIntervalMs returns correct default value', async () => {
        expect(await getTelemetryFlushIntervalMs()).toBe(60000);
      });

      it('returns configured values', async () => {
        setConfigValue('telemetry_batch_size', 50);
        setConfigValue('telemetry_flush_interval_ms', 30000);
        expect(await getTelemetryBatchSize()).toBe(50);
        expect(await getTelemetryFlushIntervalMs()).toBe(30000);
      });
    });

    describe('maintenance mode', () => {
      it('isMaintenanceMode returns false by default', async () => {
        expect(await isMaintenanceMode()).toBe(false);
      });

      it('isMaintenanceMode returns configured value', async () => {
        setConfigValue('maintenance_mode', true);
        expect(await isMaintenanceMode()).toBe(true);
      });
    });

    describe('feature flags', () => {
      it('getFeatureFlags returns correct default values', async () => {
        const flags = await getFeatureFlags();
        expect(flags).toEqual({
          advanced_patterns: true,
          social_features: true,
          analytics: false
        });
      });

      it('getFeatureFlags returns configured values', async () => {
        const customFlags = {
          advanced_patterns: false,
          social_features: false,
          analytics: true
        };
        setConfigValue('feature_flags', customFlags);
        const flags = await getFeatureFlags();
        expect(flags).toEqual(customFlags);
      });

      it('isFeatureEnabled works correctly', async () => {
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
  });
});

