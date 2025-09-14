/**
 * Настройка тестового окружения
 */

// import * as admin from 'firebase-admin';

// Мок для Firebase Admin SDK
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  apps: [],
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn(),
    getUser: jest.fn(),
    createCustomToken: jest.fn(),
    setCustomUserClaims: jest.fn()
  })),
  firestore: jest.fn(() => ({
    collection: jest.fn(),
    doc: jest.fn(),
    runTransaction: jest.fn()
  })),
  storage: jest.fn(() => ({
    bucket: jest.fn()
  }))
}));

// Глобальные настройки для тестов
beforeAll(() => {
  // Инициализация моков
  console.log('Setting up test environment...');
});

afterAll(() => {
  // Очистка после тестов
  console.log('Cleaning up test environment...');
});

// Глобальные утилиты для тестов
declare global {
  var createMockUser: (overrides?: any) => any;
  var createMockDecodedToken: (overrides?: any) => any;
}

global.createMockUser = (overrides = {}) => ({
  uid: 'test-uid',
  email: 'test@example.com',
  displayName: 'Test User',
  emailVerified: true,
  disabled: false,
  metadata: {
    creationTime: '2023-01-01T00:00:00Z',
    lastSignInTime: '2023-01-01T00:00:00Z'
  },
  customClaims: {},
  ...overrides
});

global.createMockDecodedToken = (overrides = {}) => ({
  uid: 'test-uid',
  email: 'test@example.com',
  email_verified: true,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
  ...overrides
});
