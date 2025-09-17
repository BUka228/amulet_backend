import { describe, beforeAll, afterAll, beforeEach, test } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, query, where, getDocs } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

function resolveFirestoreRulesPath(): string {
  // Тесты запускаются из каталога functions, а файл правил лежит на уровень выше
  return path.resolve(process.cwd(), '..', 'firestore.rules');
}

describe('Firestore Security Rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test',
      firestore: {
        rules: readFileSync(resolveFirestoreRulesPath(), 'utf8')
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  describe('Users collection', () => {
    test('владелец может читать и обновлять свой профиль', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Создаём профиль
      await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user_owner'), {
        displayName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // Читаем профиль
      await assertSucceeds(getDoc(doc(ownerDb, 'users', 'user_owner')));
      
      // Обновляем профиль
      await assertSucceeds(updateDoc(doc(ownerDb, 'users', 'user_owner'), {
        displayName: 'Updated User',
        updatedAt: new Date()
      }));
    });

    test('чужой профиль нельзя читать', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const ownerDb = owner.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём профиль владельца
      await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user_owner'), {
        displayName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'users', 'user_owner')));
    });

    test('создание профиля требует все обязательные поля', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Неполный профиль должен быть отклонён
      await assertFails(setDoc(doc(ownerDb, 'users', 'user_owner'), {
        displayName: 'Test User'
        // отсутствуют createdAt, updatedAt
      }));

      // Полный профиль должен пройти
      await assertSucceeds(setDoc(doc(ownerDb, 'users', 'user_owner'), {
        displayName: 'Test User',
        createdAt: new Date(),
        updatedAt: new Date()
      }));
    });
  });

  describe('Devices collection', () => {
    test('владелец может управлять своим устройством', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Создаём устройство
      await assertSucceeds(setDoc(doc(ownerDb, 'devices', 'device_1'), {
        ownerId: 'user_owner',
        serial: 'AMU-200-001',
        hardwareVersion: 200,
        firmwareVersion: 205,
        pairedAt: new Date()
      }));

      // Читаем устройство
      await assertSucceeds(getDoc(doc(ownerDb, 'devices', 'device_1')));
      
      // Обновляем устройство
      await assertSucceeds(updateDoc(doc(ownerDb, 'devices', 'device_1'), {
        name: 'My Amulet'
      }));
    });

    test('чужое устройство нельзя читать', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const ownerDb = owner.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём устройство владельца
      await assertSucceeds(setDoc(doc(ownerDb, 'devices', 'device_1'), {
        ownerId: 'user_owner',
        serial: 'AMU-200-001',
        hardwareVersion: 200,
        firmwareVersion: 205,
        pairedAt: new Date()
      }));

      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'devices', 'device_1')));
    });

    test('нельзя изменить ownerId или serial устройства', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Создаём устройство
      await assertSucceeds(setDoc(doc(ownerDb, 'devices', 'device_1'), {
        ownerId: 'user_owner',
        serial: 'AMU-200-001',
        hardwareVersion: 200,
        firmwareVersion: 205,
        pairedAt: new Date()
      }));

      // Попытка изменить ownerId должна быть отклонена
      await assertFails(updateDoc(doc(ownerDb, 'devices', 'device_1'), {
        ownerId: 'user_stranger'
      }));

      // Попытка изменить serial должна быть отклонена
      await assertFails(updateDoc(doc(ownerDb, 'devices', 'device_1'), {
        serial: 'AMU-200-002'
      }));
    });
  });

  describe('Hugs collection', () => {
    test('отправитель и получатель могут читать объятие', async () => {
      const sender = testEnv.authenticatedContext('user_sender');
      const receiver = testEnv.authenticatedContext('user_receiver');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const senderDb = sender.firestore();
      const receiverDb = receiver.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём объятие
      await assertSucceeds(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender',
        toUserId: 'user_receiver',
        pairId: null,
        emotion: {
          color: '#FF0000',
          patternId: 'pattern_1'
        },
        createdAt: new Date()
      }));

      // Отправитель может читать
      await assertSucceeds(getDoc(doc(senderDb, 'hugs', 'hug_1')));
      
      // Получатель может читать
      await assertSucceeds(getDoc(doc(receiverDb, 'hugs', 'hug_1')));
      
      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'hugs', 'hug_1')));
    });

    test('создание объятия требует корректные поля', async () => {
      const sender = testEnv.authenticatedContext('user_sender');
      const senderDb = sender.firestore();
      
      // Неполное объятие должно быть отклонено
      await assertFails(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender'
        // отсутствуют emotion, createdAt
      }));

      // Объятие без получателя должно быть отклонено
      await assertFails(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender',
        emotion: { color: '#FF0000', patternId: 'pattern_1' },
        createdAt: new Date()
        // отсутствуют toUserId и pairId
      }));

      // Корректное объятие должно пройти
      await assertSucceeds(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender',
        toUserId: 'user_receiver',
        pairId: null,
        emotion: {
          color: '#FF0000',
          patternId: 'pattern_1'
        },
        createdAt: new Date()
      }));
    });

    test('цвет эмоции должен быть в формате HEX', async () => {
      const sender = testEnv.authenticatedContext('user_sender');
      const senderDb = sender.firestore();
      
      // Неверный формат цвета должен быть отклонён
      await assertFails(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender',
        toUserId: 'user_receiver',
        emotion: {
          color: 'red', // неверный формат
          patternId: 'pattern_1'
        },
        createdAt: new Date()
      }));

      // Корректный HEX цвет должен пройти
      await assertSucceeds(setDoc(doc(senderDb, 'hugs', 'hug_1'), {
        fromUserId: 'user_sender',
        toUserId: 'user_receiver',
        pairId: null,
        emotion: {
          color: '#FF0000',
          patternId: 'pattern_1'
        },
        createdAt: new Date()
      }));
    });
  });

  describe('Practices collection', () => {
    test('практики доступны для чтения всем', async () => {
      const admin = testEnv.authenticatedContext('admin_user', { admin: true });
      const user = testEnv.authenticatedContext('regular_user');
      const anon = testEnv.unauthenticatedContext();
      const adminDb = admin.firestore();
      const userDb = user.firestore();
      const anonDb = anon.firestore();
      
      // Админ создаёт практику
      await assertSucceeds(setDoc(doc(adminDb, 'practices', 'practice_1'), {
        type: 'breath',
        title: 'Test Practice',
        desc: 'Test Description',
        durationSec: 300
      }));

      // Все могут читать
      await assertSucceeds(getDoc(doc(userDb, 'practices', 'practice_1')));
      await assertSucceeds(getDoc(doc(anonDb, 'practices', 'practice_1')));
    });

    test('только админ может создавать/изменять практики', async () => {
      const admin = testEnv.authenticatedContext('admin_user', { admin: true });
      const user = testEnv.authenticatedContext('regular_user');
      const adminDb = admin.firestore();
      const userDb = user.firestore();
      
      // Админ может создавать
      await assertSucceeds(setDoc(doc(adminDb, 'practices', 'practice_1'), {
        type: 'breath',
        title: 'Test Practice',
        desc: 'Test Description',
        durationSec: 300
      }));

      // Обычный пользователь не может создавать
      await assertFails(setDoc(doc(userDb, 'practices', 'practice_2'), {
        type: 'breath',
        title: 'Test Practice 2',
        desc: 'Test Description 2',
        durationSec: 300
      }));

      // Обычный пользователь не может изменять
      await assertFails(updateDoc(doc(userDb, 'practices', 'practice_1'), {
        title: 'Updated Practice'
      }));
    });
  });

  describe('Patterns collection', () => {
    test('публичные паттерны доступны всем', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const anon = testEnv.unauthenticatedContext();
      const ownerDb = owner.firestore();
      const strangerDb = stranger.firestore();
      const anonDb = anon.firestore();
      
      // Создаём публичный паттерн
      await assertSucceeds(setDoc(doc(ownerDb, 'patterns', 'pattern_1'), {
        ownerId: 'user_owner',
        kind: 'light',
        spec: { type: 'breathing', hardwareVersion: 200 },
        public: true,
        hardwareVersion: 200,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // Все могут читать публичный паттерн
      await assertSucceeds(getDoc(doc(strangerDb, 'patterns', 'pattern_1')));
      await assertSucceeds(getDoc(doc(anonDb, 'patterns', 'pattern_1')));
    });

    test('приватные паттерны доступны только владельцу', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const ownerDb = owner.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём приватный паттерн
      await assertSucceeds(setDoc(doc(ownerDb, 'patterns', 'pattern_1'), {
        ownerId: 'user_owner',
        kind: 'light',
        spec: { type: 'breathing', hardwareVersion: 200 },
        public: false,
        hardwareVersion: 200,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // Владелец может читать
      await assertSucceeds(getDoc(doc(ownerDb, 'patterns', 'pattern_1')));
      
      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'patterns', 'pattern_1')));
    });

    test('создание паттерна требует все обязательные поля', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Неполный паттерн должен быть отклонён
      await assertFails(setDoc(doc(ownerDb, 'patterns', 'pattern_1'), {
        ownerId: 'user_owner',
        kind: 'light'
        // отсутствуют spec, public, hardwareVersion, createdAt, updatedAt
      }));

      // Полный паттерн должен пройти
      await assertSucceeds(setDoc(doc(ownerDb, 'patterns', 'pattern_1'), {
        ownerId: 'user_owner',
        kind: 'light',
        spec: { type: 'breathing', hardwareVersion: 200 },
        public: true,
        hardwareVersion: 200,
        createdAt: new Date(),
        updatedAt: new Date()
      }));
    });
  });

  describe('Pairs collection', () => {
    test('участники пары могут читать и обновлять пару', async () => {
      const member1 = testEnv.authenticatedContext('user_1');
      const member2 = testEnv.authenticatedContext('user_2');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const member1Db = member1.firestore();
      const member2Db = member2.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём пару
      await assertSucceeds(setDoc(doc(member1Db, 'pairs', 'pair_1'), {
        memberIds: ['user_1', 'user_2'],
        status: 'active',
        createdAt: new Date()
      }));

      // Оба участника могут читать
      await assertSucceeds(getDoc(doc(member1Db, 'pairs', 'pair_1')));
      await assertSucceeds(getDoc(doc(member2Db, 'pairs', 'pair_1')));
      
      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'pairs', 'pair_1')));
      
      // Участники могут обновлять (но не блокировать без админских прав)
      await assertSucceeds(updateDoc(doc(member1Db, 'pairs', 'pair_1'), {
        status: 'active'
      }));
    });

    test('создание пары требует корректные поля', async () => {
      const member1 = testEnv.authenticatedContext('user_1');
      const member1Db = member1.firestore();
      
      // Неполная пара должна быть отклонена
      await assertFails(setDoc(doc(member1Db, 'pairs', 'pair_1'), {
        memberIds: ['user_1']
        // отсутствуют status, createdAt
      }));

      // Пара с неправильным количеством участников должна быть отклонена
      await assertFails(setDoc(doc(member1Db, 'pairs', 'pair_1'), {
        memberIds: ['user_1'],
        status: 'active',
        createdAt: new Date()
      }));

      // Корректная пара должна пройти
      await assertSucceeds(setDoc(doc(member1Db, 'pairs', 'pair_1'), {
        memberIds: ['user_1', 'user_2'],
        status: 'active',
        createdAt: new Date()
      }));
    });
  });

  describe('Sessions collection', () => {
    test('владелец может управлять своими сессиями', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const stranger = testEnv.authenticatedContext('user_stranger');
      const ownerDb = owner.firestore();
      const strangerDb = stranger.firestore();
      
      // Создаём сессию
      await assertSucceeds(setDoc(doc(ownerDb, 'sessions', 'session_1'), {
        ownerId: 'user_owner',
        practiceId: 'practice_1',
        status: 'started',
        startedAt: new Date()
      }));

      // Владелец может читать и обновлять
      await assertSucceeds(getDoc(doc(ownerDb, 'sessions', 'session_1')));
      await assertSucceeds(updateDoc(doc(ownerDb, 'sessions', 'session_1'), {
        status: 'completed'
      }));
      
      // Чужой не может читать
      await assertFails(getDoc(doc(strangerDb, 'sessions', 'session_1')));
    });

    test('создание сессии требует все обязательные поля', async () => {
      const owner = testEnv.authenticatedContext('user_owner');
      const ownerDb = owner.firestore();
      
      // Неполная сессия должна быть отклонена
      await assertFails(setDoc(doc(ownerDb, 'sessions', 'session_1'), {
        ownerId: 'user_owner'
        // отсутствуют practiceId, status, startedAt
      }));

      // Полная сессия должна пройти
      await assertSucceeds(setDoc(doc(ownerDb, 'sessions', 'session_1'), {
        ownerId: 'user_owner',
        practiceId: 'practice_1',
        status: 'started',
        startedAt: new Date()
      }));
    });
  });

  describe('Telemetry collection', () => {
    test('только админ может читать телеметрию', async () => {
      const admin = testEnv.authenticatedContext('admin_user', { admin: true });
      const user = testEnv.authenticatedContext('regular_user');
      const adminDb = admin.firestore();
      const userDb = user.firestore();
      
      // Создаём телеметрию
      await assertSucceeds(setDoc(doc(userDb, 'telemetry', 'telemetry_1'), {
        deviceId: 'device_1',
        timestamp: new Date(),
        data: { battery: 85 }
      }));

      // Админ может читать
      await assertSucceeds(getDoc(doc(adminDb, 'telemetry', 'telemetry_1')));
      
      // Обычный пользователь не может читать
      await assertFails(getDoc(doc(userDb, 'telemetry', 'telemetry_1')));
    });

    test('создание телеметрии требует корректные поля', async () => {
      const user = testEnv.authenticatedContext('regular_user');
      const userDb = user.firestore();
      
      // Телеметрия без обязательных полей должна быть отклонена
      await assertFails(setDoc(doc(userDb, 'telemetry', 'telemetry_1'), {
        data: { battery: 85 }
        // отсутствуют deviceId, timestamp
      }));

      // Корректная телеметрия должна пройти
      await assertSucceeds(setDoc(doc(userDb, 'telemetry', 'telemetry_1'), {
        deviceId: 'device_1',
        timestamp: new Date(),
        data: { battery: 85 }
      }));
    });
  });
});
