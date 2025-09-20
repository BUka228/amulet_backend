/**
 * Cloud Monitoring интеграция для метрик и алертов
 * 
 * Обеспечивает:
 * - Метрики производительности (p50, p95, p99)
 * - Метрики ошибок (4xx, 5xx)
 * - Бизнес-метрики (количество пользователей, устройств, etc.)
 * - Кастомные метрики
 * - Алерты по SLO
 */

import { MetricServiceClient, AlertPolicyServiceClient } from '@google-cloud/monitoring';
import { Request, Response } from 'express';

export interface MetricData {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: Date;
}

export interface SLOConfig {
  name: string;
  target: number; // 0.0 - 1.0 (например, 0.999 для 99.9%)
  window: number; // в минутах
  measurement: 'availability' | 'latency' | 'error_rate';
}

class MonitoringService {
  private projectId: string;
  private client: MetricServiceClient;
  private alertClient: AlertPolicyServiceClient;

  constructor() {
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
    if (!this.projectId) {
      console.warn('GOOGLE_CLOUD_PROJECT not set, monitoring will be disabled');
    }
    this.client = new MetricServiceClient();
    this.alertClient = new AlertPolicyServiceClient();
  }

  /**
   * Создает метрику времени выполнения
   */
  recordLatency(operation: string, duration: number, labels: Record<string, string> = {}): void {
    this.recordMetric({
      name: 'api_latency',
      value: duration,
      labels: {
        operation,
        ...labels,
      },
    });
  }

  /**
   * Создает метрику HTTP статуса
   */
  recordHttpStatus(method: string, path: string, statusCode: number, duration: number): void {
    const labels = {
      method,
      path,
      status_code: statusCode.toString(),
      status_class: this.getStatusClass(statusCode),
    };

    this.recordMetric({
      name: 'http_requests_total',
      value: 1,
      labels,
    });

    this.recordMetric({
      name: 'http_request_duration',
      value: duration,
      labels,
    });
  }

  /**
   * Создает метрику ошибок
   */
  recordError(operation: string, errorType: string, labels: Record<string, string> = {}): void {
    this.recordMetric({
      name: 'errors_total',
      value: 1,
      labels: {
        operation,
        error_type: errorType,
        ...labels,
      },
    });
  }

  /**
   * Создает бизнес-метрику
   */
  recordBusinessMetric(metricName: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric({
      name: `business_${metricName}`,
      value,
      labels,
    });
  }

  /**
   * Создает метрику использования ресурсов
   */
  recordResourceUsage(resource: string, operation: string, count: number): void {
    this.recordMetric({
      name: 'resource_usage',
      value: count,
      labels: {
        resource,
        operation,
      },
    });
  }

  /**
   * Создает метрику для FCM уведомлений
   */
  recordNotificationSent(platform: string, success: boolean): void {
    this.recordMetric({
      name: 'notifications_sent_total',
      value: 1,
      labels: {
        platform,
        success: success.toString(),
      },
    });
  }

  /**
   * Создает метрику для OTA обновлений
   */
  recordOTAUpdate(deviceId: string, fromVersion: string, toVersion: string, success: boolean): void {
    this.recordMetric({
      name: 'ota_updates_total',
      value: 1,
      labels: {
        device_id: deviceId,
        from_version: fromVersion,
        to_version: toVersion,
        success: success.toString(),
      },
    });
  }

  /**
   * Создает метрику для пользовательских действий
   */
  recordUserAction(action: string, userId: string, labels: Record<string, string> = {}): void {
    this.recordMetric({
      name: 'user_actions_total',
      value: 1,
      labels: {
        action,
        user_id: userId,
        ...labels,
      },
    });
  }

  /**
   * Создает метрику для устройств
   */
  recordDeviceMetric(metricName: string, deviceId: string, value: number, labels: Record<string, string> = {}): void {
    this.recordMetric({
      name: `device_${metricName}`,
      value,
      labels: {
        device_id: deviceId,
        ...labels,
      },
    });
  }

  /**
   * Базовая функция для записи метрик
   */
  private recordMetric(data: MetricData): void {
    if (!this.projectId) return;

    try {
      const metricType = `custom.googleapis.com/amulet/${data.name}`;
      const timestamp = data.timestamp || new Date();

      const timeSeries = {
        metric: {
          type: metricType,
          labels: data.labels || {},
        },
        resource: {
          type: 'cloud_function',
          labels: {
            function_name: process.env.FUNCTION_NAME || 'unknown',
            region: process.env.FUNCTION_REGION || 'unknown',
          },
        },
        points: [
          {
            interval: {
              endTime: {
                seconds: Math.floor(timestamp.getTime() / 1000),
                nanos: (timestamp.getTime() % 1000) * 1000000,
              },
            },
            value: {
              doubleValue: data.value,
            },
          },
        ],
      };

      // Отправляем метрику в Cloud Monitoring
      this.client.createTimeSeries({ 
        name: `projects/${this.projectId}`, 
        timeSeries: [timeSeries] 
      }).catch((error) => {
        console.error('Failed to record metric:', error);
      });
    } catch (error) {
      console.error('Failed to record metric:', error);
    }
  }

  /**
   * Получает класс HTTP статуса
   */
  private getStatusClass(statusCode: number): string {
    if (statusCode >= 200 && statusCode < 300) return '2xx';
    if (statusCode >= 300 && statusCode < 400) return '3xx';
    if (statusCode >= 400 && statusCode < 500) return '4xx';
    if (statusCode >= 500) return '5xx';
    return 'unknown';
  }

  /**
   * Создает алерт политику
   */
  async createAlertPolicy(config: {
    name: string;
    displayName: string;
    description: string;
    metricType: string;
    threshold: number;
    comparison: 'COMPARISON_GT' | 'COMPARISON_LT' | 'COMPARISON_GTE' | 'COMPARISON_LTE';
    duration: number; // в секундах
  }): Promise<void> {
    if (!this.projectId) return;

    try {
      const alertPolicy = {
        displayName: config.displayName,
        documentation: {
          content: config.description,
        },
        conditions: [
          {
            displayName: `${config.displayName} condition`,
            conditionThreshold: {
              filter: `metric.type="${config.metricType}"`,
              comparison: config.comparison as 'COMPARISON_GT' | 'COMPARISON_GE' | 'COMPARISON_LT' | 'COMPARISON_LE' | 'COMPARISON_EQ' | 'COMPARISON_NE',
              thresholdValue: config.threshold,
              duration: {
                seconds: config.duration,
              },
              aggregations: [
                {
                  alignmentPeriod: {
                    seconds: 300, // 5 минут
                  },
                  perSeriesAligner: 'ALIGN_RATE' as const,
                  crossSeriesReducer: 'REDUCE_SUM' as const,
                },
              ],
            },
          },
        ],
        alertStrategy: {
          autoClose: {
            seconds: 3600, // 1 час
          },
        },
        enabled: { value: true },
      };

      // Создаем алерт политику в Cloud Monitoring
      await this.alertClient.createAlertPolicy({ 
        name: `projects/${this.projectId}`, 
        alertPolicy 
      });
    } catch (error) {
      console.error('Failed to create alert policy:', error);
    }
  }

  /**
   * Создает SLO алерты
   */
  async createSLOAlerts(sloConfigs: SLOConfig[]): Promise<void> {
    for (const slo of sloConfigs) {
      const metricType = this.getSLOMetricType(slo.measurement);
      const threshold = 1 - slo.target; // Конвертируем в порог ошибок

      await this.createAlertPolicy({
        name: `slo-${slo.name}`,
        displayName: `SLO Alert: ${slo.name}`,
        description: `Alert when ${slo.measurement} drops below ${slo.target * 100}%`,
        metricType,
        threshold,
        comparison: 'COMPARISON_GT',
        duration: slo.window * 60,
      });
    }
  }

  /**
   * Получает тип метрики для SLO
   */
  private getSLOMetricType(measurement: SLOConfig['measurement']): string {
    switch (measurement) {
      case 'availability':
        return 'custom.googleapis.com/amulet/http_requests_total';
      case 'latency':
        return 'custom.googleapis.com/amulet/http_request_duration';
      case 'error_rate':
        return 'custom.googleapis.com/amulet/errors_total';
      default:
        throw new Error(`Unknown SLO measurement: ${measurement}`);
    }
  }

  /**
   * Middleware для автоматического сбора метрик HTTP запросов
   */
  createMetricsMiddleware() {
    return (req: Request, res: Response, next: () => void) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        try {
          const duration = Date.now() - startTime;
          this.recordHttpStatus(req.method, req.path, res.statusCode, duration);
        } catch (error) {
          // Игнорируем ошибки метрик, чтобы не ломать основной поток
          console.warn('Metrics middleware error:', error);
        }
      });

      next();
    };
  }
}

// Экспортируем класс для тестирования
export { MonitoringService };

// Экспортируем singleton instance
export const monitoringService = new MonitoringService();

// Middleware для Express
export function metricsMiddleware() {
  return monitoringService.createMetricsMiddleware();
}

// Утилиты для быстрого доступа
export const metrics = {
  latency: (operation: string, duration: number, labels?: Record<string, string>) =>
    monitoringService.recordLatency(operation, duration, labels),
  httpStatus: (method: string, path: string, statusCode: number, duration: number) =>
    monitoringService.recordHttpStatus(method, path, statusCode, duration),
  error: (operation: string, errorType: string, labels?: Record<string, string>) =>
    monitoringService.recordError(operation, errorType, labels),
  business: (metricName: string, value: number, labels?: Record<string, string>) =>
    monitoringService.recordBusinessMetric(metricName, value, labels),
  resource: (resource: string, operation: string, count: number) =>
    monitoringService.recordResourceUsage(resource, operation, count),
  notification: (platform: string, success: boolean) =>
    monitoringService.recordNotificationSent(platform, success),
  ota: (deviceId: string, fromVersion: string, toVersion: string, success: boolean) =>
    monitoringService.recordOTAUpdate(deviceId, fromVersion, toVersion, success),
  userAction: (action: string, userId: string, labels?: Record<string, string>) =>
    monitoringService.recordUserAction(action, userId, labels),
  device: (metricName: string, deviceId: string, value: number, labels?: Record<string, string>) =>
    monitoringService.recordDeviceMetric(metricName, deviceId, value, labels),
};
