/**
 * Тесты для SLO конфигурации
 * 
 * Проверяем:
 * - Корректность SLO конфигураций
 * - Структуру дашбордов
 * - Валидацию метрик
 */

import { SLO_CONFIGS, DASHBOARD_CONFIGS, ALERT_THRESHOLDS, ALERT_POLICIES, LOG_FILTERS } from '../../core/sloConfig';

describe('SLO Configuration', () => {
  describe('SLO_CONFIGS', () => {
    it('должен содержать все необходимые SLO', () => {
      expect(Array.isArray(SLO_CONFIGS)).toBe(true);
      expect(SLO_CONFIGS.length).toBe(3);
      
      const names = SLO_CONFIGS.map(slo => slo.name);
      expect(names).toContain('api_availability');
      expect(names).toContain('api_latency_p95');
      expect(names).toContain('api_error_rate');
    });

    it('должен иметь корректную структуру для api_availability', () => {
      const availability = SLO_CONFIGS.find(slo => slo.name === 'api_availability');
      
      expect(availability).toEqual({
        name: 'api_availability',
        target: 0.999,
        window: 5,
        measurement: 'availability',
      });
    });

    it('должен иметь корректную структуру для api_latency_p95', () => {
      const latency = SLO_CONFIGS.find(slo => slo.name === 'api_latency_p95');
      
      expect(latency).toEqual({
        name: 'api_latency_p95',
        target: 0.95,
        window: 5,
        measurement: 'latency',
      });
    });

    it('должен иметь корректную структуру для api_error_rate', () => {
      const errorRate = SLO_CONFIGS.find(slo => slo.name === 'api_error_rate');
      
      expect(errorRate).toEqual({
        name: 'api_error_rate',
        target: 0.99,
        window: 5,
        measurement: 'error_rate',
      });
    });
  });

  describe('DASHBOARD_CONFIGS', () => {
    it('должен содержать все необходимые дашборды', () => {
      expect(DASHBOARD_CONFIGS).toHaveProperty('api_overview');
      expect(DASHBOARD_CONFIGS).toHaveProperty('business_metrics');
      expect(DASHBOARD_CONFIGS).toHaveProperty('notifications');
      expect(DASHBOARD_CONFIGS).toHaveProperty('devices');
    });

    it('должен иметь корректную структуру для api_overview', () => {
      const apiOverview = DASHBOARD_CONFIGS['api_overview'];
      
      expect(apiOverview).toEqual({
        title: 'API Overview',
        metrics: [
          'custom.googleapis.com/amulet/http_requests_total',
          'custom.googleapis.com/amulet/http_request_duration',
          'custom.googleapis.com/amulet/errors_total',
        ],
        timeRange: '1h',
      });
    });

    it('должен иметь корректную структуру для business_metrics', () => {
      const businessMetrics = DASHBOARD_CONFIGS['business_metrics'];
      
      expect(businessMetrics).toEqual({
        title: 'Business Metrics',
        metrics: [
          'custom.googleapis.com/amulet/business_users_active',
          'custom.googleapis.com/amulet/business_devices_connected',
          'custom.googleapis.com/amulet/business_hugs_sent',
          'custom.googleapis.com/amulet/business_practices_completed',
        ],
        timeRange: '24h',
      });
    });

    it('должен иметь корректную структуру для notifications', () => {
      const notifications = DASHBOARD_CONFIGS['notifications'];
      
      expect(notifications).toEqual({
        title: 'Notifications',
        metrics: [
          'custom.googleapis.com/amulet/notifications_sent_total',
          'custom.googleapis.com/amulet/fcm_delivery_latency',
        ],
        timeRange: '1h',
      });
    });

    it('должен иметь корректную структуру для devices', () => {
      const devices = DASHBOARD_CONFIGS['devices'];
      
      expect(devices).toEqual({
        title: 'Devices & OTA',
        metrics: [
          'custom.googleapis.com/amulet/ota_updates_total',
          'custom.googleapis.com/amulet/device_connection_status',
          'custom.googleapis.com/amulet/device_battery_level',
        ],
        timeRange: '24h',
      });
    });
  });

  describe('Валидация конфигураций', () => {
    it('должен иметь валидные target значения для SLO', () => {
      SLO_CONFIGS.forEach(slo => {
        expect(slo.target).toBeGreaterThan(0);
        expect(slo.target).toBeLessThanOrEqual(1);
      });
    });

    it('должен иметь валидные window значения для SLO', () => {
      SLO_CONFIGS.forEach(slo => {
        expect(slo.window).toBeGreaterThan(0);
        expect(slo.window).toBeLessThanOrEqual(60);
      });
    });

    it('должен иметь валидные measurement типы', () => {
      const validMeasurements = ['availability', 'latency', 'error_rate'];
      
      SLO_CONFIGS.forEach(slo => {
        expect(validMeasurements).toContain(slo.measurement);
      });
    });

    it('должен иметь уникальные имена для SLO', () => {
      const names = SLO_CONFIGS.map(slo => slo.name);
      const uniqueNames = new Set(names);
      
      expect(names.length).toBe(uniqueNames.size);
    });

    it('должен иметь уникальные имена для дашбордов', () => {
      const names = Object.keys(DASHBOARD_CONFIGS);
      const uniqueNames = new Set(names);
      
      expect(names.length).toBe(uniqueNames.size);
    });

    it('должен иметь корректные метрики для дашбордов', () => {
      Object.values(DASHBOARD_CONFIGS).forEach(dashboard => {
        expect(Array.isArray(dashboard.metrics)).toBe(true);
        expect(dashboard.metrics.length).toBeGreaterThan(0);
        
        dashboard.metrics.forEach(metric => {
          expect(typeof metric).toBe('string');
          expect(metric).toMatch(/^custom\.googleapis\.com\/amulet\//);
        });
      });
    });
  });

  describe('ALERT_THRESHOLDS', () => {
    it('должен содержать все необходимые пороги', () => {
      expect(ALERT_THRESHOLDS).toHaveProperty('HTTP_4XX_RATE');
      expect(ALERT_THRESHOLDS).toHaveProperty('HTTP_5XX_RATE');
      expect(ALERT_THRESHOLDS).toHaveProperty('P50_LATENCY_MS');
      expect(ALERT_THRESHOLDS).toHaveProperty('P95_LATENCY_MS');
      expect(ALERT_THRESHOLDS).toHaveProperty('P99_LATENCY_MS');
      expect(ALERT_THRESHOLDS).toHaveProperty('FCM_DELIVERY_RATE');
      expect(ALERT_THRESHOLDS).toHaveProperty('OTA_SUCCESS_RATE');
    });

    it('должен иметь валидные значения порогов', () => {
      expect(ALERT_THRESHOLDS.HTTP_4XX_RATE).toBeGreaterThan(0);
      expect(ALERT_THRESHOLDS.HTTP_4XX_RATE).toBeLessThan(1);
      expect(ALERT_THRESHOLDS.HTTP_5XX_RATE).toBeGreaterThan(0);
      expect(ALERT_THRESHOLDS.HTTP_5XX_RATE).toBeLessThan(1);
      expect(ALERT_THRESHOLDS.FCM_DELIVERY_RATE).toBeGreaterThan(0);
      expect(ALERT_THRESHOLDS.FCM_DELIVERY_RATE).toBeLessThanOrEqual(1);
      expect(ALERT_THRESHOLDS.OTA_SUCCESS_RATE).toBeGreaterThan(0);
      expect(ALERT_THRESHOLDS.OTA_SUCCESS_RATE).toBeLessThanOrEqual(1);
    });
  });

  describe('ALERT_POLICIES', () => {
    it('должен содержать все необходимые политики', () => {
      expect(Array.isArray(ALERT_POLICIES)).toBe(true);
      expect(ALERT_POLICIES.length).toBe(4);
      
      const names = ALERT_POLICIES.map(policy => policy.name);
      expect(names).toContain('high_error_rate');
      expect(names).toContain('high_latency');
      expect(names).toContain('fcm_delivery_failure');
      expect(names).toContain('ota_failure_rate');
    });

    it('должен иметь корректную структуру политик', () => {
      ALERT_POLICIES.forEach(policy => {
        expect(policy).toHaveProperty('name');
        expect(policy).toHaveProperty('displayName');
        expect(policy).toHaveProperty('description');
        expect(policy).toHaveProperty('metricType');
        expect(policy).toHaveProperty('threshold');
        expect(policy).toHaveProperty('comparison');
        expect(policy).toHaveProperty('duration');
        
        expect(typeof policy.name).toBe('string');
        expect(typeof policy.displayName).toBe('string');
        expect(typeof policy.description).toBe('string');
        expect(typeof policy.metricType).toBe('string');
        expect(typeof policy.threshold).toBe('number');
        expect(typeof policy.duration).toBe('number');
      });
    });
  });

  describe('LOG_FILTERS', () => {
    it('должен содержать все необходимые фильтры', () => {
      expect(LOG_FILTERS).toHaveProperty('errors');
      expect(LOG_FILTERS).toHaveProperty('api_requests');
      expect(LOG_FILTERS).toHaveProperty('background_jobs');
      expect(LOG_FILTERS).toHaveProperty('security_events');
      expect(LOG_FILTERS).toHaveProperty('business_operations');
    });

    it('должен иметь корректную структуру фильтров', () => {
      Object.values(LOG_FILTERS).forEach(filter => {
        expect(filter).toHaveProperty('name');
        expect(filter).toHaveProperty('filter');
        expect(filter).toHaveProperty('timeRange');
        
        expect(typeof filter.name).toBe('string');
        expect(typeof filter.filter).toBe('string');
        expect(typeof filter.timeRange).toBe('string');
      });
    });
  });
});

