import * as admin from 'firebase-admin';

/**
 * Централизованная инициализация Firebase Admin SDK (singleton)
 * Автоматически использует эмулятор, если задан FIRESTORE_EMULATOR_HOST
 */
export function initializeFirebase(): void {
  if (admin.apps.length === 0) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'amulet-test' });
      // eslint-disable-next-line no-console
      console.log('Firebase Admin SDK initialized for EMULATOR.');
    } else {
      admin.initializeApp();
      // eslint-disable-next-line no-console
      console.log('Firebase Admin SDK initialized for PRODUCTION.');
    }
  }
}

export const db = admin.firestore();
export const auth = admin.auth();
export const storage = admin.storage();
export const messaging = admin.messaging();
export const appCheck = admin.appCheck();
