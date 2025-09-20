/**
 * Cloud Trace интеграция для трейсинга запросов
 * 
 * Обеспечивает:
 * - Автоматическое создание трейсов для HTTP запросов
 * - Вложенные спаны для операций
 * - Корреляцию с логами через traceId
 * - Метрики производительности
 */

import { trace as otelTrace, Span, SpanKind, SpanStatusCode } from '@opentelemetry/api';
// import { NodeSDK } from '@opentelemetry/sdk-node'; // Временно отключено
import { Request, Response, NextFunction } from 'express';

export interface TraceContext {
  traceId: string;
  spanId: string;
  traceFlags: number;
}

export interface SpanOptions {
  name: string;
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
}

class TracingService {
  private tracer = otelTrace.getTracer('amulet-backend');

  /**
   * Создает трейс для HTTP запроса
   */
  createRequestTrace(req: Request, res: Response, next: NextFunction): void {
    const span = this.tracer.startSpan(`${req.method} ${req.path}`, {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': req.method,
        'http.url': req.url,
        'http.route': req.path,
        'http.user_agent': req.headers['user-agent'] || '',
        'http.request_id': req.headers['x-request-id'] as string || '',
      },
    });

    // Добавляем span в контекст запроса
    (req as Request & { span?: Span }).span = span;
    (req as Request & { startTime: number }).startTime = Date.now();

    // Обработчик завершения запроса
    res.on('finish', () => {
      const duration = Date.now() - ((req as Request & { startTime: number }).startTime || Date.now());
      
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_time': duration,
        'http.response_size': res.get('content-length') || 0,
      });

      // Устанавливаем статус спана на основе HTTP кода
      if (res.statusCode >= 400) {
        span.setStatus({
          code: res.statusCode >= 500 ? SpanStatusCode.ERROR : SpanStatusCode.UNSET,
          message: `HTTP ${res.statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
    });

    // Обработчик ошибок
    res.on('error', (error) => {
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.end();
    });

    next();
  }

  /**
   * Создает вложенный спан для операции
   */
  createSpan(options: SpanOptions): Span {
    return this.tracer.startSpan(options.name, {
      kind: options.kind || SpanKind.INTERNAL,
      attributes: options.attributes || {},
    });
  }

  /**
   * Выполняет операцию в контексте спана
   */
  async executeInSpan<T>(
    options: SpanOptions,
    operation: (span: Span) => Promise<T>
  ): Promise<T> {
    const span = this.createSpan(options);
    
    try {
      const result = await operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Синхронная версия executeInSpan
   */
  executeInSpanSync<T>(
    options: SpanOptions,
    operation: (span: Span) => T
  ): T {
    const span = this.createSpan(options);
    
    try {
      const result = operation(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Добавляет атрибуты к текущему спану
   */
  addAttributes(attributes: Record<string, string | number | boolean>): void {
    const activeSpan = otelTrace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  /**
   * Добавляет событие к текущему спану
   */
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
    const activeSpan = otelTrace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  /**
   * Получает контекст текущего трейса
   */
  getCurrentTraceContext(): TraceContext | null {
    const activeSpan = otelTrace.getActiveSpan();
    if (!activeSpan) return null;

    const spanContext = activeSpan.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
      traceFlags: spanContext.traceFlags,
    };
  }

  /**
   * Создает спан для работы с базой данных
   */
  createDatabaseSpan(operation: string, collection: string): Span {
    return this.createSpan({
      name: `db.${operation}`,
      kind: SpanKind.CLIENT,
      attributes: {
        'db.operation': operation,
        'db.collection': collection,
        'db.system': 'firestore',
      },
    });
  }

  /**
   * Создает спан для внешних API вызовов
   */
  createExternalApiSpan(service: string, endpoint: string): Span {
    return this.createSpan({
      name: `external.${service}`,
      kind: SpanKind.CLIENT,
      attributes: {
        'external.service': service,
        'external.endpoint': endpoint,
      },
    });
  }

  /**
   * Создает спан для фоновых задач
   */
  createBackgroundSpan(taskName: string): Span {
    return this.createSpan({
      name: `background.${taskName}`,
      kind: SpanKind.INTERNAL,
      attributes: {
        'background.task': taskName,
      },
    });
  }
}

// Экспортируем singleton instance
export const tracingService = new TracingService();

// Middleware для Express
export function tracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    tracingService.createRequestTrace(req, res, next);
  };
}

// Утилиты для быстрого доступа
export const traceUtils = {
  span: (options: SpanOptions) => tracingService.createSpan(options),
  execute: <T>(options: SpanOptions, operation: (span: Span) => Promise<T>) =>
    tracingService.executeInSpan(options, operation),
  executeSync: <T>(options: SpanOptions, operation: (span: Span) => T) =>
    tracingService.executeInSpanSync(options, operation),
  attributes: (attributes: Record<string, string | number | boolean>) =>
    tracingService.addAttributes(attributes),
  event: (name: string, attributes?: Record<string, string | number | boolean>) =>
    tracingService.addEvent(name, attributes),
  context: () => tracingService.getCurrentTraceContext(),
  database: (operation: string, collection: string) =>
    tracingService.createDatabaseSpan(operation, collection),
  external: (service: string, endpoint: string) =>
    tracingService.createExternalApiSpan(service, endpoint),
  background: (taskName: string) =>
    tracingService.createBackgroundSpan(taskName),
};
