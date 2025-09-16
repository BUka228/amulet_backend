/**
 * Скрипт загрузки тестовых файлов в Firebase Storage
 * - avatars/{userId}/avatar.png (приватно: доступен только владельцу)
 * - audio/practices/{practiceId}/demo.mp3 (публично доступен на чтение)
 * - firmware/{hardwareVersion}/{semver}/firmware.bin (публично доступен на чтение)
 */

import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// Инициализация Firebase Admin
const app = initializeApp();
const storage = getStorage(app);

async function uploadBuffer(
  bucketName: string,
  filePath: string,
  buffer: Buffer,
  contentType: string,
  metadata: Record<string, string> = {}
) {
  const bucket = storage.bucket(bucketName);
  const file = bucket.file(filePath);
  await file.save(buffer, {
    contentType,
    metadata: { metadata }
  });
  return `gs://${bucketName}/${filePath}`;
}

function createPng1x1(): Buffer {
  // Минимальный PNG (1x1 прозрачный пиксель)
  return Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6360000002000154A20B450000000049454E44AE426082',
    'hex'
  );
}

function createDummyMp3(): Buffer {
  // Минимальная заглушка: ID3 тег + немного данных
  const id3 = Buffer.from('4944330300000000000F', 'hex'); // ID3v2 header
  const payload = Buffer.from('Test MP3 payload');
  return Buffer.concat([id3, payload]);
}

function createDummyFirmware(): Buffer {
  // Бинарная заглушка прошивки
  return Buffer.from('FIRMWARE_DUMMY_1.0.0');
}

async function main() {
  try {
    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || process.env.GCLOUD_PROJECT || 'emu-bucket';

    console.log('🚀 Начинаем загрузку тестовых файлов в Storage...');

    // 1) Avatar (private to owner)
    const userId = 'user_test_1';
    const avatarPath = `avatars/${userId}/avatar.png`;
    const avatarUrl = await uploadBuffer(
      bucketName,
      avatarPath,
      createPng1x1(),
      'image/png'
    );
    console.log(`✅ Аватар загружен: ${avatarUrl}`);

    // 2) Practice audio (public read by rules)
    const practiceId = 'practice_test_1';
    const audioPath = `audio/practices/${practiceId}/demo.mp3`;
    const audioUrl = await uploadBuffer(
      bucketName,
      audioPath,
      createDummyMp3(),
      'audio/mpeg'
    );
    console.log(`✅ Аудио загружено: ${audioUrl}`);

    // 3) Firmware (public read by rules)
    const firmwarePath = `firmware/200/2.0.0/firmware.bin`;
    const fwUrl = await uploadBuffer(
      bucketName,
      firmwarePath,
      createDummyFirmware(),
      'application/octet-stream'
    );
    console.log(`✅ Прошивка загружена: ${fwUrl}`);

    console.log('🎉 Загрузка тестовых файлов завершена.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Ошибка при загрузке файлов в Storage:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


