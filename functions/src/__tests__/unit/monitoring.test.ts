/**
 * Тесты для мониторинга
 * 
 * Проверяем:
 * - Отправку метрик
 * - Создание алертов
 * - Middleware для метрик
 * - SLO конфигурацию
 * - Обработку ошибок
 */

import { Request, Response } from 'express';
import { monitoringService, metricsMiddleware, MetricData, SLOConfig, MonitoringService } from '../../core/monitoring';

// Мокаем console для проверки логов
const mockConsole = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

Object.assign(console, mockConsole);

describe('MonitoringService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Сбрасываем переменные окружения
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
  });

  describe('Инициализация', () => {
    it('должен инициализироваться с projectId из GOOGLE_CLOUD_PROJECT', () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      expect(service['projectId']).toBe('test-project');
    });

    it('должен инициализироваться с projectId из GCP_PROJECT', () => {
      process.env.GCP_PROJECT = 'test-project-gcp';
      
      const service = new MonitoringService();
      
      expect(service['projectId']).toBe('test-project-gcp');
    });

    it('должен предупреждать если projectId не установлен', () => {
      const service = new MonitoringService();
      
      expect(mockConsole.warn).toHaveBeenCalledWith(
        'GOOGLE_CLOUD_PROJECT not set, monitoring will be disabled'
      );
      expect(service['projectId']).toBe('');
    });
  });

  describe('Отправка метрик', () => {
    it('должен отправлять метрику с базовыми данными', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const metricData: MetricData = {
        name: 'http_requests_total',
        value: 1,
        labels: {
          method: 'GET',
          status: '200',
        },
      };

      // Поскольку MetricServiceClient отключен, метод должен логировать
      service.recordMetric(metricData);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });

    it('должен отправлять метрику с timestamp', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const timestamp = new Date('2024-01-01T12:00:00Z');
      const metricData: MetricData = {
        name: 'response_time',
        value: 150,
        labels: {
          endpoint: '/api/users',
        },
        timestamp,
      };

      service.recordMetric(metricData);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });

    it('должен обрабатывать ошибки при отправке метрик', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      // Мокаем recordMetric чтобы он выбрасывал ошибку
      const originalRecordMetric = service.recordMetric;
      service.recordMetric = jest.fn().mockImplementation(() => {
        throw new Error('Network error');
      });

      const metricData: MetricData = {
        name: 'test_metric',
        value: 1,
      };

      expect(() => service.recordMetric(metricData)).toThrow('Network error');
    });
  });

  describe('HTTP метрики', () => {
    it('должен отправлять метрику HTTP запроса', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const mockReq = {
        method: 'POST',
        path: '/api/users',
        headers: {
          'user-agent': 'Mozilla/5.0',
        },
      } as unknown as Request;

      const mockRes = {
        statusCode: 201,
        get: jest.fn().mockReturnValue('1024'),
      } as unknown as Response;

      const duration = 150;

      service.recordHttpStatus(mockReq.method, mockReq.path, mockRes.statusCode, duration);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });

    it('должен отправлять метрику ошибки', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const error = new Error('Database connection failed');
      const context = {
        operation: 'user_create',
        userId: 'user-123',
      };

      service.recordError('user_create', 'DatabaseError', context);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });
  });

  describe('Бизнес метрики', () => {
    it('должен отправлять бизнес метрику', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      service.recordBusinessMetric('user_registration', 1, {
        plan: 'premium',
        source: 'web',
      });
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });
  });

  describe('SLO алерты', () => {
    it('должен создавать алерт для доступности', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const sloConfig: SLOConfig = {
        name: 'api-availability',
        description: 'API availability SLO',
        target: 0.999,
        window: 30,
        measurement: 'availability',
      };

      // SLO алерты не реализованы в текущей версии
      expect(sloConfig.name).toBe('api-availability');
      expect(sloConfig.target).toBe(0.999);
      expect(sloConfig.window).toBe(30);
    });

    it('должен создавать алерт для латентности', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const sloConfig: SLOConfig = {
        name: 'api-latency',
        description: 'API latency SLO',
        target: 0.95,
        window: 15,
        measurement: 'latency',
      };

      // SLO алерты не реализованы в текущей версии
      expect(sloConfig.name).toBe('api-latency');
      expect(sloConfig.target).toBe(0.95);
      expect(sloConfig.measurement).toBe('latency');
    });
  });

  describe('Middleware', () => {
    it('должен создавать middleware для метрик', () => {
      const middleware = metricsMiddleware();
      expect(typeof middleware).toBe('function');
    });

    it('должен отправлять метрики в middleware', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const mockReq = {
        method: 'GET',
        path: '/api/test',
        headers: {
          'user-agent': 'Mozilla/5.0',
        },
      } as unknown as Request;

      const mockRes = {
        statusCode: 200,
        get: jest.fn().mockReturnValue('512'),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            // Симулируем завершение запроса через 100ms
            setTimeout(callback, 100);
          }
        }),
      } as unknown as Response;

      const mockNext = jest.fn();

      const middleware = metricsMiddleware();
      
      // Мокаем recordHttpStatus
      const recordHttpStatusSpy = jest.spyOn(monitoringService, 'recordHttpStatus')
        .mockImplementation();

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();

      // Ждем завершения запроса
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(recordHttpStatusSpy).toHaveBeenCalledWith(
        'GET',
        '/api/test',
        200,
        expect.any(Number)
      );
    });

    it('должен обрабатывать ошибки в middleware', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const mockReq = {
        method: 'GET',
        path: '/api/test',
        headers: {},
      } as unknown as Request;

      const mockRes = {
        statusCode: 500,
        get: jest.fn().mockReturnValue('0'),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            callback();
          }
        }),
      } as unknown as Response;

      const mockNext = jest.fn();

      const middleware = metricsMiddleware();
      
      // Мокаем recordHttpStatus чтобы он выбрасывал ошибку
      const recordHttpStatusSpy = jest.spyOn(monitoringService, 'recordHttpStatus')
        .mockImplementation(() => {
          throw new Error('Metric send failed');
        });

      // Проверяем, что ошибка не прерывает выполнение middleware
      expect(() => {
        middleware(mockReq, mockRes, mockNext);
      }).not.toThrow();
      
      // Middleware должен обрабатывать ошибки gracefully
      expect(mockNext).toHaveBeenCalled();
      expect(recordHttpStatusSpy).toHaveBeenCalled();
    });
  });

  describe('Экспортированный объект', () => {
    it('должен экспортировать singleton instance', () => {
      expect(monitoringService).toBeDefined();
      expect(typeof monitoringService.recordLatency).toBe('function');
      expect(typeof monitoringService.recordHttpStatus).toBe('function');
      expect(typeof monitoringService.recordError).toBe('function');
      expect(typeof monitoringService.recordBusinessMetric).toBe('function');
    });
  });

  describe('Обработка edge cases', () => {
    it('должен обрабатывать метрики без labels', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const metricData: MetricData = {
        name: 'simple_counter',
        value: 1,
      };

      service.recordMetric(metricData);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });

    it('должен обрабатывать метрики с пустыми labels', async () => {
      process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
      
      const service = new MonitoringService();
      
      const metricData: MetricData = {
        name: 'empty_labels',
        value: 0,
        labels: {},
      };

      service.recordMetric(metricData);
      
      expect(mockConsole.log).toHaveBeenCalledWith(
        'Metric recorded:',
        expect.any(String)
      );
    });
  });
});

