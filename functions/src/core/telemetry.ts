/**
 * Инициализация OpenTelemetry для трейсинга и метрик
 * 
 * Настраивает:
 * - Трейсинг с Cloud Trace
 * - Метрики с Cloud Monitoring
 * - Автоматическую инструментацию
 * 
 * ВНИМАНИЕ: OpenTelemetry пакеты не установлены в package.json
 * Для включения трейсинга установите зависимости:
 * npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http @opentelemetry/sdk-metrics
 */

// import { NodeSDK } from '@opentelemetry/sdk-node';
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
// import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

// Инициализируем OpenTelemetry только в продакшене
// Временно отключено из-за проблем с совместимостью версий
// if (false && (process.env.NODE_ENV === 'production' || process.env.FUNCTIONS_EMULATOR !== 'true')) {
//   const sdk = new NodeSDK({
//     traceExporter: new OTLPTraceExporter({
//       url: 'https://cloudtrace.googleapis.com/v1/projects',
//     }),
//     metricReader: new PeriodicExportingMetricReader({
//       exporter: new OTLPMetricExporter({
//         url: 'https://monitoring.googleapis.com/v1/projects',
//       }),
//       exportIntervalMillis: 60000, // Экспортируем метрики каждую минуту
//     }),
//     instrumentations: [
//       getNodeAutoInstrumentations({
//         // Отключаем инструментацию, которая может конфликтовать
//         '@opentelemetry/instrumentation-fs': {
//           enabled: false,
//         },
//         '@opentelemetry/instrumentation-dns': {
//           enabled: false,
//         },
//       }),
//     ],
//     serviceName: 'amulet-backend',
//     serviceVersion: process.env.FUNCTION_VERSION || '1.0.0',
//   });

//   sdk.start();
//   console.log('OpenTelemetry initialized');
// }
console.log('OpenTelemetry disabled due to version conflicts');

export {};
