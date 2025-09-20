/**
 * Инициализация OpenTelemetry для трейсинга и метрик
 * 
 * Настраивает:
 * - Трейсинг с Cloud Trace
 * - Автоматическую инструментацию
 * 
 * ВНИМАНИЕ: Из-за проблем с совместимостью версий OpenTelemetry,
 * используется упрощенная инициализация только для трейсинга.
 * Метрики отправляются через Cloud Monitoring API напрямую.
 */

// Получаем project ID
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;

// Инициализируем OpenTelemetry только в продакшене или при явном включении
const shouldInitialize = 
  (process.env.NODE_ENV === 'production' && process.env.FUNCTIONS_EMULATOR !== 'true') ||
  process.env.ENABLE_TELEMETRY === 'true';

if (shouldInitialize && projectId) {
  try {
    // Динамический импорт для избежания проблем с совместимостью
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');

    const sdk = new NodeSDK({
      traceExporter: new OTLPTraceExporter({
        url: 'https://cloudtrace.googleapis.com/v1/traces:batchWrite',
        headers: {
          'x-goog-user-project': projectId,
        },
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Отключаем инструментацию, которая может конфликтовать
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-dns': {
            enabled: false,
          },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
          },
        }),
      ],
      resource: new Resource({
        'service.name': 'amulet-backend',
        'service.version': process.env.FUNCTION_VERSION || '1.0.0',
        'deployment.environment': process.env.NODE_ENV || 'development',
        'cloud.provider': 'gcp',
        'cloud.platform': 'gcp_cloud_functions',
        'cloud.region': process.env.FUNCTION_REGION || 'us-central1',
      }),
    });

    sdk.start();
    console.log(`✅ OpenTelemetry initialized for project: ${projectId}`);
  } catch (error) {
    console.error('❌ Failed to initialize OpenTelemetry:', error);
    console.log('OpenTelemetry will be disabled');
  }
} else {
  console.log('OpenTelemetry disabled - not in production mode or project ID not set');
  if (!projectId) {
    console.log('Set GOOGLE_CLOUD_PROJECT environment variable to enable telemetry');
  }
}

export {};
