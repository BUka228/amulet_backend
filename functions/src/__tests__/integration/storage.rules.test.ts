import { describe, beforeAll, afterAll, beforeEach, test } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

function resolveStorageRulesPath(): string {
  // Тесты запускаются из каталога functions, а файл правил лежит на уровень выше
  return path.resolve(process.cwd(), '..', 'storage.rules');
}

describe('Storage Security Rules', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'amulet-test',
      storage: {
        rules: readFileSync(resolveStorageRulesPath(), 'utf8')
      }
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearStorage();
  });

  test('avatars: владелец может загрузить и прочитать свой аватар, чужой — нет', async () => {
    const owner = testEnv.authenticatedContext('user_owner');
    const stranger = testEnv.authenticatedContext('user_stranger');

    const ownerStorage = owner.storage();
    const strangerStorage = stranger.storage();

    const avatarPath = `avatars/user_owner/avatar.png`;
    const ownerRef = ref(ownerStorage, avatarPath);
    const strangerRef = ref(strangerStorage, avatarPath);

    const png1x1 = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6360000002000154A20B450000000049454E44AE426082',
      'hex'
    );

    await assertSucceeds(uploadBytes(ownerRef, png1x1, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ownerRef));
    await assertFails(getBytes(strangerRef));
  });

  test('avatars: неверный contentType отклоняется', async () => {
    const owner = testEnv.authenticatedContext('user_owner');
    const ownerStorage = owner.storage();
    const avatarRef = ref(ownerStorage, 'avatars/user_owner/avatar.txt');
    const buf = Buffer.from('not an image');
    await assertFails(uploadBytes(avatarRef, buf, { contentType: 'text/plain' }));
  });

  test('avatars: превышение размера отклоняется (>5MB)', async () => {
    const owner = testEnv.authenticatedContext('user_owner');
    const ownerStorage = owner.storage();
    const bigBuf = Buffer.alloc(5 * 1024 * 1024 + 1, 0x00);
    const refBig = ref(ownerStorage, 'avatars/user_owner/big.png');
    await assertFails(uploadBytes(refBig, bigBuf, { contentType: 'image/png' }));
  });

  test('audio/practices: публичное чтение доступно без аутентификации, запись только админ', async () => {
    const admin = testEnv.authenticatedContext('admin_user', { admin: true });
    const anon = testEnv.unauthenticatedContext();
    const user = testEnv.authenticatedContext('regular_user');

    const adminStorage = admin.storage();
    const anonStorage = anon.storage();
    const userStorage = user.storage();

    const objPath = 'audio/practices/pr1/demo.mp3';
    const adminRef = ref(adminStorage, objPath);
    const anonRef = ref(anonStorage, objPath);
    const userRef = ref(userStorage, objPath);

    const mp3 = Buffer.from('4944330300000000000F', 'hex');

    // Запись админом
    await assertSucceeds(uploadBytes(adminRef, mp3, { contentType: 'audio/mpeg' }));

    // Публичное чтение
    await assertSucceeds(getBytes(anonRef));

    // Запись обычным пользователем запрещена
    await assertFails(uploadBytes(userRef, mp3, { contentType: 'audio/mpeg' }));
  });

  test('audio/practices: неверный contentType отклоняется', async () => {
    const admin = testEnv.authenticatedContext('admin_user', { admin: true });
    const s = admin.storage();
    const refBad = ref(s, 'audio/practices/pr1/demo.txt');
    const buf = Buffer.from('not audio');
    await assertFails(uploadBytes(refBad, buf, { contentType: 'text/plain' }));
  });

  test('firmware: публичное чтение, запись только админ и только octet-stream', async () => {
    const admin = testEnv.authenticatedContext('admin_user', { admin: true });
    const anon = testEnv.unauthenticatedContext();
    const user = testEnv.authenticatedContext('regular_user');

    const adminStorage = admin.storage();
    const anonStorage = anon.storage();
    const userStorage = user.storage();

    const fwPath = 'firmware/200/2.0.0/firmware.bin';
    const adminRef = ref(adminStorage, fwPath);
    const anonRef = ref(anonStorage, fwPath);
    const userRef = ref(userStorage, fwPath);

    const fw = Buffer.from('FIRMWARE_DUMMY');

    await assertSucceeds(uploadBytes(adminRef, fw, { contentType: 'application/octet-stream' }));
    await assertSucceeds(getBytes(anonRef));
    await assertFails(uploadBytes(userRef, fw, { contentType: 'application/octet-stream' }));
  });
});


