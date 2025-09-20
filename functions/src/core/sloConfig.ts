/**
 * Конфигурация SLO (Service Level Objectives) и алертов
 * 
 * Определяет цели уровня обслуживания и настройки алертов
 * для мониторинга производительности и доступности API
 */

import { SLOConfig } from './monitoring';

export const SLO_CONFIGS: SLOConfig[] = [
  {
    name: 'api_availability',
    target: 0.999, // 99.9% доступность
    window: 5, // 5 минут
    measurement: 'availability',
  },
  {
    name: 'api_latency_p95',
    target: 0.95, // 95% запросов должны быть быстрее 500ms
    window: 5,
    measurement: 'latency',
  },
  {
    name: 'api_error_rate',
    target: 0.99, // 99% запросов без ошибок
    window: 5,
    measurement: 'error_rate',
  },
];

export const ALERT_THRESHOLDS = {
  // HTTP статусы
  HTTP_4XX_RATE: 0.05, // 5% 4xx ошибок
  HTTP_5XX_RATE: 0.01, // 1% 5xx ошибок
  
  // Латентность
  P50_LATENCY_MS: 200, // 50% запросов < 200ms
  P95_LATENCY_MS: 500, // 95% запросов < 500ms
  P99_LATENCY_MS: 1000, // 99% запросов < 1000ms
  
  // Бизнес-метрики
  FCM_DELIVERY_RATE: 0.95, // 95% успешных доставок FCM
  OTA_SUCCESS_RATE: 0.90, // 90% успешных OTA обновлений
  
  // Ресурсы
  FIRESTORE_READ_LATENCY_MS: 100,
  FIRESTORE_WRITE_LATENCY_MS: 200,
  FCM_SEND_LATENCY_MS: 1000,
};

export const ALERT_POLICIES = [
  {
    name: 'high_error_rate',
    displayName: 'High Error Rate',
    description: 'Alert when error rate exceeds threshold',
    metricType: 'custom.googleapis.com/amulet/errors_total',
    threshold: ALERT_THRESHOLDS.HTTP_5XX_RATE,
    comparison: 'COMPARISON_GT' as const,
    duration: 300, // 5 минут
  },
  {
    name: 'high_latency',
    displayName: 'High Latency',
    description: 'Alert when P95 latency exceeds threshold',
    metricType: 'custom.googleapis.com/amulet/http_request_duration',
    threshold: ALERT_THRESHOLDS.P95_LATENCY_MS,
    comparison: 'COMPARISON_GT' as const,
    duration: 300,
  },
  {
    name: 'fcm_delivery_failure',
    displayName: 'FCM Delivery Failure',
    description: 'Alert when FCM delivery rate drops below threshold',
    metricType: 'custom.googleapis.com/amulet/notifications_sent_total',
    threshold: 1 - ALERT_THRESHOLDS.FCM_DELIVERY_RATE,
    comparison: 'COMPARISON_GT' as const,
    duration: 600, // 10 минут
  },
  {
    name: 'ota_failure_rate',
    displayName: 'OTA Update Failure',
    description: 'Alert when OTA success rate drops below threshold',
    metricType: 'custom.googleapis.com/amulet/ota_updates_total',
    threshold: 1 - ALERT_THRESHOLDS.OTA_SUCCESS_RATE,
    comparison: 'COMPARISON_GT' as const,
    duration: 900, // 15 минут
  },
];

export const DASHBOARD_CONFIGS = {
  api_overview: {
    title: 'API Overview',
    metrics: [
      'custom.googleapis.com/amulet/http_requests_total',
      'custom.googleapis.com/amulet/http_request_duration',
      'custom.googleapis.com/amulet/errors_total',
    ],
    timeRange: '1h',
  },
  business_metrics: {
    title: 'Business Metrics',
    metrics: [
      'custom.googleapis.com/amulet/business_users_active',
      'custom.googleapis.com/amulet/business_devices_connected',
      'custom.googleapis.com/amulet/business_hugs_sent',
      'custom.googleapis.com/amulet/business_practices_completed',
    ],
    timeRange: '24h',
  },
  notifications: {
    title: 'Notifications',
    metrics: [
      'custom.googleapis.com/amulet/notifications_sent_total',
      'custom.googleapis.com/amulet/fcm_delivery_latency',
    ],
    timeRange: '1h',
  },
  devices: {
    title: 'Devices & OTA',
    metrics: [
      'custom.googleapis.com/amulet/ota_updates_total',
      'custom.googleapis.com/amulet/device_connection_status',
      'custom.googleapis.com/amulet/device_battery_level',
    ],
    timeRange: '24h',
  },
};

export const LOG_FILTERS = {
  errors: {
    name: 'Error Logs',
    filter: 'severity>=ERROR AND resource.type="cloud_function"',
    timeRange: '1h',
  },
  api_requests: {
    name: 'API Requests',
    filter: 'resource.type="cloud_function" AND jsonPayload.operation="api_call"',
    timeRange: '1h',
  },
  background_jobs: {
    name: 'Background Jobs',
    filter: 'resource.type="cloud_function" AND jsonPayload.operation="background_job"',
    timeRange: '24h',
  },
  security_events: {
    name: 'Security Events',
    filter: 'resource.type="cloud_function" AND jsonPayload.operation="security"',
    timeRange: '24h',
  },
  business_operations: {
    name: 'Business Operations',
    filter: 'resource.type="cloud_function" AND jsonPayload.operation="business_operation"',
    timeRange: '1h',
  },
};




