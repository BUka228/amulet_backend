import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../core/firebase';
import { sendNotification } from '../core/pushNotifications';
import * as logger from 'firebase-functions/logger';

/**
 * Функция для отправки уведомлений о доступных обновлениях OTA
 * Запускается ежедневно в 10:00 UTC
 */
export const otaNotificationsHandler = onSchedule({
  schedule: '0 10 * * *', // Ежедневно в 10:00 UTC
  timeZone: 'UTC',
  memory: '256MiB',
  timeoutSeconds: 300,
}, async (event) => {
  logger.info('Starting OTA notifications job', {
    scheduledTime: event.scheduleTime,
  });

  try {
    // Получаем все активные устройства
    const devicesSnapshot = await db
      .collection('devices')
      .where('status', '==', 'active')
      .get();

    let notificationsSent = 0;
    let errors = 0;
    let devicesChecked = 0;

    for (const deviceDoc of devicesSnapshot.docs) {
      try {
        const deviceData = deviceDoc.data();
        const deviceId = deviceDoc.id;
        const ownerId = deviceData.ownerId;
        const hardwareVersion = deviceData.hardwareVersion;
        const currentFirmware = deviceData.firmwareVersion;
        
        if (!ownerId || !hardwareVersion || !currentFirmware) {
          continue;
        }

        devicesChecked++;

        // Проверяем, есть ли более новая прошивка для данного аппаратного обеспечения
        const firmwareSnapshot = await db
          .collection('firmware')
          .where('hardwareVersion', '==', hardwareVersion)
          .where('status', '==', 'published')
          .orderBy('version', 'desc')
          .limit(1)
          .get();

        if (firmwareSnapshot.empty) {
          continue;
        }

        const latestFirmware = firmwareSnapshot.docs[0].data();
        const latestVersion = latestFirmware.version;
        
        // Сравниваем версии (предполагаем семантическое версионирование)
        if (isNewerVersion(latestVersion, currentFirmware)) {
          // Проверяем, не отправляли ли уже уведомление об этом обновлении
          const notificationKey = `ota_${deviceId}_${latestVersion}`;
          const existingNotification = await db
            .collection('otaNotifications')
            .doc(notificationKey)
            .get();

          if (existingNotification.exists) {
            continue; // Уже отправляли
          }

          // Отправляем уведомление
          const result = await sendNotification(
            ownerId,
            'ota.available',
            {
              type: 'ota.available',
              deviceId,
              hardwareVersion: hardwareVersion.toString(),
              currentVersion: currentFirmware,
              newVersion: latestVersion,
              firmwareId: firmwareSnapshot.docs[0].id,
            },
            deviceData.language || 'en'
          );

          if (result.delivered) {
            // Сохраняем запись об отправленном уведомлении
            await db.collection('otaNotifications').doc(notificationKey).set({
              deviceId,
              ownerId,
              hardwareVersion,
              currentVersion: currentFirmware,
              newVersion: latestVersion,
              firmwareId: firmwareSnapshot.docs[0].id,
              sentAt: new Date(),
              delivered: true,
            });

            notificationsSent++;
            logger.info('OTA notification sent', {
              deviceId,
              ownerId,
              hardwareVersion,
              currentVersion: currentFirmware,
              newVersion: latestVersion,
              tokensCount: result.tokensCount,
            });
          }
        }
      } catch (deviceError) {
        errors++;
        logger.error('Failed to process device for OTA notification', {
          deviceId: deviceDoc.id,
          error: deviceError instanceof Error ? deviceError.message : 'Unknown error',
        });
      }
    }

    logger.info('OTA notifications job completed', {
      devicesChecked,
      notificationsSent,
      errors,
      scheduledTime: event.scheduleTime,
    });
  } catch (error) {
    logger.error('OTA notifications job failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      scheduledTime: event.scheduleTime,
    });
  }
});

/**
 * Функция для отправки уведомлений о критических обновлениях OTA
 * Запускается принудительно через API или по расписанию
 */
export async function sendCriticalOtaNotification(
  hardwareVersion: number,
  criticalVersion: string,
  reason: string
): Promise<{ notificationsSent: number; errors: number }> {
  logger.info('Starting critical OTA notification', {
    hardwareVersion,
    criticalVersion,
    reason,
  });

  try {
    // Получаем все устройства с указанной версией аппаратного обеспечения
    const devicesSnapshot = await db
      .collection('devices')
      .where('hardwareVersion', '==', hardwareVersion)
      .where('status', '==', 'active')
      .get();

    let notificationsSent = 0;
    let errors = 0;

    for (const deviceDoc of devicesSnapshot.docs) {
      try {
        const deviceData = deviceDoc.data();
        const deviceId = deviceDoc.id;
        const ownerId = deviceData.ownerId;
        const currentFirmware = deviceData.firmwareVersion;
        
        if (!ownerId || !currentFirmware) {
          continue;
        }

        // Проверяем, нуждается ли устройство в критическом обновлении
        if (!isNewerVersion(criticalVersion, currentFirmware)) {
          continue;
        }

        // Отправляем критическое уведомление
        const result = await sendNotification(
          ownerId,
          'ota.available',
          {
            type: 'ota.available',
            deviceId,
            hardwareVersion: hardwareVersion.toString(),
            currentVersion: currentFirmware,
            newVersion: criticalVersion,
            critical: 'true',
            reason,
          },
          deviceData.language || 'en'
        );

        if (result.delivered) {
          notificationsSent++;
          logger.info('Critical OTA notification sent', {
            deviceId,
            ownerId,
            hardwareVersion,
            currentVersion: currentFirmware,
            criticalVersion,
            reason,
            tokensCount: result.tokensCount,
          });
        }
      } catch (deviceError) {
        errors++;
        logger.error('Failed to process device for critical OTA notification', {
          deviceId: deviceDoc.id,
          error: deviceError instanceof Error ? deviceError.message : 'Unknown error',
        });
      }
    }

    logger.info('Critical OTA notification completed', {
      hardwareVersion,
      criticalVersion,
      reason,
      notificationsSent,
      errors,
    });

    return { notificationsSent, errors };
  } catch (error) {
    logger.error('Critical OTA notification failed', {
      hardwareVersion,
      criticalVersion,
      reason,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return { notificationsSent: 0, errors: 1 };
  }
}

/**
 * Сравнивает версии прошивки (семантическое версионирование)
 * Возвращает true, если newVersion новее currentVersion
 */
function isNewerVersion(newVersion: string, currentVersion: string): boolean {
  try {
    const newParts = newVersion.split('.').map(Number);
    const currentParts = currentVersion.split('.').map(Number);
    
    // Дополняем массивы нулями до одинаковой длины
    const maxLength = Math.max(newParts.length, currentParts.length);
    while (newParts.length < maxLength) newParts.push(0);
    while (currentParts.length < maxLength) currentParts.push(0);
    
    for (let i = 0; i < maxLength; i++) {
      if (newParts[i] > currentParts[i]) {
        return true;
      } else if (newParts[i] < currentParts[i]) {
        return false;
      }
    }
    
    return false; // Версии одинаковые
  } catch (error) {
    logger.error('Failed to compare firmware versions', {
      newVersion,
      currentVersion,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

