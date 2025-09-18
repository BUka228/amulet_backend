import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';
// appCheck API exists in Admin SDK v12+, but can be absent in some environments
// We will import lazily to avoid runtime crashes in tests

// Централизованная инициализация Firebase Admin SDK (singleton)
// В тестовой среде гарантируем переменные окружения для эмуляторов,
// чтобы инициализация при импорте шла к эмулятору даже до setup файлов Jest
if (process.env.NODE_ENV === 'test') {
  process.env.GOOGLE_CLOUD_PROJECT ||= 'amulet-test';
  process.env.GCLOUD_PROJECT ||= process.env.GOOGLE_CLOUD_PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST ||= 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= 'localhost:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ||= 'localhost:9199';
}
let app;
if (getApps().length > 0) {
  app = getApp();
} else {
  // В тестах используем projectId из переменной окружения
  // На продакшене Firebase Functions автоматически подставляет projectId
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
  if (projectId) {
    app = initializeApp({ projectId });
  } else {
    // Fallback: инициализация без явного projectId (для Cloud Functions)
    app = initializeApp();
  }
}

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log('Firebase Admin SDK initialized for EMULATOR.');
} else {
  console.log('Firebase Admin SDK initialized for PRODUCTION.');
}

// Экспорт сервисов в модульном стиле
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const messaging = getMessaging(app);

// Опциональная инициализация App Check (может отсутствовать в окружении)
let _appCheck: unknown = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getAppCheck } = require('firebase-admin/app-check');
  _appCheck = getAppCheck(app);
} catch (_err) {
  // appCheck недоступен (локальные тесты/старая версия) — игнорируем
}
export const appCheck = _appCheck;

// Убираем старую функцию initializeFirebase, она больше не нужна.