/**
 * Структурированное логирование для Cloud Functions
 * 
 * Обеспечивает единообразное логирование с обязательными полями:
 * - requestId: идентификатор запроса для трейсинга
 * - userId: идентификатор пользователя (если доступен)
 * - route: маршрут API
 * - latency: время выполнения (для HTTP запросов)
 * 
 * Дополнительные поля:
 * - operation: тип операции (api_call, background_job, etc.)
 * - resource: затронутый ресурс
 * - severity: уровень важности
 * - metadata: дополнительные контекстные данные
 */

import * as logger from 'firebase-functions/logger';
import { Request } from 'express';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = {
  requestId?: string;
  userId?: string;
  route?: string;
  latency?: number;
  operation?: string;
  resource?: string;
  severity?: LogLevel;
  metadata?: Record<string, unknown>;
  // Дополнительные поля для HTTP запросов
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  status?: number;
  // Дополнительные поля для ошибок
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  // Дополнительные поля для бизнес-операций
  businessOperation?: string;
  performanceOperation?: string;
  // Дополнительные поля для безопасности
  securityEvent?: string;
  // Дополнительные поля для метрик
  jobId?: string;
  duration?: number;
};

export type LogEntry = {
  message: string;
  context: LogContext;
  timestamp: string;
  level: LogLevel;
};

class StructuredLogger {
  private baseContext: LogContext = {};

  /**
   * Устанавливает базовый контекст для всех логов
   */
  setBaseContext(context: LogContext): void {
    this.baseContext = { ...this.baseContext, ...context };
  }

  /**
   * Очищает базовый контекст
   */
  clearBaseContext(): void {
    this.baseContext = {};
  }

  /**
   * Создает контекст из HTTP запроса
   */
  createRequestContext(req: Request): LogContext {
    const startTime = (req as Request & { startTime?: number }).startTime || Date.now();
    const latency = Date.now() - startTime;
    
    return {
      requestId: req.headers['x-request-id'] as string,
      route: `${req.method} ${req.path}`,
      latency,
      operation: 'api_call',
      ...this.baseContext,
    };
  }

  /**
   * Создает контекст для фоновых задач
   */
  createBackgroundContext(operation: string, resource?: string): LogContext {
    return {
      operation: 'background_job',
      resource,
      ...this.baseContext,
    };
  }

  /**
   * Логирует с автоматическим определением уровня
   */
  private log(level: LogLevel, message: string, context: LogContext = {}): void {
    const mergedContext = { ...this.baseContext, ...context };
    const logEntry: LogEntry = {
      message,
      context: mergedContext,
      timestamp: new Date().toISOString(),
      level,
    };

    // Определяем severity из контекста или используем level
    const severity = mergedContext.severity || level;

    // Логируем в Cloud Logging с структурированными данными
    const logData = {
      message,
      ...mergedContext,
      timestamp: logEntry.timestamp,
      severity,
    };

    switch (level) {
      case 'debug':
        logger.debug(message, logData);
        break;
      case 'info':
        logger.info(message, logData);
        break;
      case 'warn':
        logger.warn(message, logData);
        break;
      case 'error':
        logger.error(message, logData);
        break;
    }
  }

  /**
   * Debug уровень - детальная информация для отладки
   */
  debug(message: string, context: LogContext = {}): void {
    this.log('debug', message, context);
  }

  /**
   * Info уровень - общая информация о работе системы
   */
  info(message: string, context: LogContext = {}): void {
    this.log('info', message, context);
  }

  /**
   * Warn уровень - предупреждения о потенциальных проблемах
   */
  warn(message: string, context: LogContext = {}): void {
    this.log('warn', message, context);
  }

  /**
   * Error уровень - ошибки, требующие внимания
   */
  error(message: string, context: LogContext = {}): void {
    this.log('error', message, context);
  }

  /**
   * Логирует HTTP запрос
   */
  logRequest(req: Request, additionalContext: LogContext = {}): void {
    const context = this.createRequestContext(req);
    this.info('HTTP request', {
      ...context,
      ...additionalContext,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  /**
   * Логирует HTTP ответ
   */
  logResponse(req: Request, statusCode: number, additionalContext: LogContext = {}): void {
    const context = this.createRequestContext(req);
    const level = statusCode >= 400 ? 'warn' : 'info';
    this.log(level, 'HTTP response', {
      ...context,
      ...additionalContext,
      status: statusCode,
    });
  }

  /**
   * Логирует ошибку с контекстом
   */
  logError(error: Error, context: LogContext = {}): void {
    this.error('Error occurred', {
      ...context,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }

  /**
   * Логирует бизнес-операцию
   */
  logBusinessOperation(
    operation: string,
    resource: string,
    message: string,
    context: LogContext = {}
  ): void {
    this.info(message, {
      ...context,
      operation: 'business_operation',
      resource,
      businessOperation: operation,
    });
  }

  /**
   * Логирует метрики производительности
   */
  logPerformance(
    operation: string,
    duration: number,
    context: LogContext = {}
  ): void {
    this.info('Performance metric', {
      ...context,
      operation: 'performance',
      performanceOperation: operation,
      duration,
      latency: duration,
    });
  }

  /**
   * Логирует события безопасности
   */
  logSecurity(
    event: string,
    message: string,
    context: LogContext = {}
  ): void {
    this.warn(message, {
      ...context,
      operation: 'security',
      securityEvent: event,
      severity: 'warn',
    });
  }
}

// Экспортируем singleton instance
export const structuredLogger = new StructuredLogger();

// Экспортируем класс для тестирования
export { StructuredLogger };

// Утилиты для быстрого доступа
export const log = {
  debug: (message: string, context?: LogContext) => structuredLogger.debug(message, context),
  info: (message: string, context?: LogContext) => structuredLogger.info(message, context),
  warn: (message: string, context?: LogContext) => structuredLogger.warn(message, context),
  error: (message: string, context?: LogContext) => structuredLogger.error(message, context),
  request: (req: Request, additionalContext?: LogContext) => structuredLogger.logRequest(req, additionalContext),
  response: (req: Request, statusCode: number, additionalContext?: LogContext) => 
    structuredLogger.logResponse(req, statusCode, additionalContext),
  business: (operation: string, resource: string, message: string, context?: LogContext) =>
    structuredLogger.logBusinessOperation(operation, resource, message, context),
  performance: (operation: string, duration: number, context?: LogContext) =>
    structuredLogger.logPerformance(operation, duration, context),
  security: (event: string, message: string, context?: LogContext) =>
    structuredLogger.logSecurity(event, message, context),
};
