/**
 * Amulet Backend - Firebase Cloud Functions
 * 
 * Основные функции:
 * - api: HTTP API с middleware аутентификации
 * - auth: функции аутентификации и авторизации
 */

// Инициализируем телеметрию в самом начале
import './core/telemetry';

import {setGlobalOptions} from "firebase-functions";
import * as logger from "firebase-functions/logger";


// Импорт API функций
import { api } from './api/test';

// Импорт фоновых функций
import { processUserDeletion } from './background/deleteUser';
import { processOutbox } from './background/outboxWorker';
import { scheduledCleanup } from './background/scheduledCleanup';
import { practiceRemindersHandler, scheduledPracticeRemindersHandler } from './background/practiceReminders';
import { otaNotificationsHandler } from './background/otaNotifications';
import { aggregateStats, manualStatsAggregation } from './background/statsAggregator';

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

// Экспорт API функций
export { api };

// Экспорт фоновых функций
export { processUserDeletion };
export { processOutbox };
export { scheduledCleanup };
export { practiceRemindersHandler, scheduledPracticeRemindersHandler };
export { otaNotificationsHandler };
export { aggregateStats, manualStatsAggregation };

logger.info('Amulet Backend functions loaded', {structuredData: true});
