import express, { Request, Response, NextFunction } from 'express';
import { authenticateToken } from '../core/auth';
import { sendError } from '../core/http';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../core/firebase';
import { z } from 'zod';
import * as logger from 'firebase-functions/logger';
import { GetFirmwareResponse, ReportFirmwareRequest } from '../types/http';
import { Firmware } from '../types/firestore';

export const otaRouter = express.Router();

// В тестовой среде разрешаем аноним и подставляем X-Test-Uid контекстом в app
otaRouter.use(
  authenticateToken({ allowAnonymous: process.env.NODE_ENV === 'test' })
);

// Схемы валидации
const firmwareReportSchema = z.object({
  fromVersion: z.string().min(1).max(50),
  toVersion: z.string().min(1).max(50),
  status: z.enum(['success', 'failed', 'cancelled']),
  errorCode: z.string().max(100).optional(),
  errorMessage: z.string().max(500).optional(),
}).strict();

function validateFirmwareReport() {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      firmwareReportSchema.parse(req.body ?? {});
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation error';
      return sendError(res, { code: 'invalid_argument', message });
    }
  };
}

// GET /v1/ota/firmware/latest — проверка обновления прошивки
otaRouter.get('/ota/firmware/latest', async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  const { hardware, currentFirmware } = req.query as { hardware?: string; currentFirmware?: string };
  
  // Валидация параметров
  if (!hardware || !currentFirmware) {
    return sendError(res, { 
      code: 'invalid_argument', 
      message: 'Missing required parameters: hardware and currentFirmware' 
    });
  }

  const hardwareVersion = parseInt(hardware.toString(), 10);
  if (isNaN(hardwareVersion)) {
    return sendError(res, { 
      code: 'invalid_argument', 
      message: 'Invalid hardware version' 
    });
  }

  try {
    // Ищем доступные прошивки для данной версии железа
    const firmwareQuery = db
      .collection('firmware')
      .where('hardwareVersion', '==', hardwareVersion)
      .where('isActive', '==', true)
      .orderBy('publishedAt', 'desc')
      .limit(1);

    const firmwareSnap = await firmwareQuery.get();
    
    if (firmwareSnap.empty) {
      return sendError(res, { 
        code: 'not_found', 
        message: 'No firmware available for this hardware version' 
      });
    }

    const firmware = firmwareSnap.docs[0].data() as Firmware;
    
    // Проверяем, нужна ли обновление
    if (firmware.version === currentFirmware) {
      return res.status(200).json({
        version: firmware.version,
        notes: firmware.releaseNotes,
        url: firmware.downloadUrl,
        checksum: firmware.checksum,
        size: firmware.size,
        updateAvailable: false
      } as GetFirmwareResponse & { updateAvailable: boolean });
    }

    // Проверяем совместимость версий
    if (firmware.minFirmwareVersion && currentFirmware < firmware.minFirmwareVersion) {
      return sendError(res, { 
        code: 'failed_precondition', 
        message: `Current firmware version ${currentFirmware} is too old. Minimum required: ${firmware.minFirmwareVersion}` 
      });
    }

    if (firmware.maxFirmwareVersion && currentFirmware > firmware.maxFirmwareVersion) {
      return sendError(res, { 
        code: 'failed_precondition', 
        message: `Current firmware version ${currentFirmware} is too new. Maximum supported: ${firmware.maxFirmwareVersion}` 
      });
    }

    // Проверяем rollout percentage (для постепенного развёртывания)
    const rolloutCheck = Math.random() * 100;
    if (rolloutCheck > firmware.rolloutPercentage) {
      return res.status(200).json({
        version: firmware.version,
        notes: firmware.releaseNotes,
        url: firmware.downloadUrl,
        checksum: firmware.checksum,
        size: firmware.size,
        updateAvailable: false,
        rolloutReason: 'Not eligible for rollout'
      } as GetFirmwareResponse & { updateAvailable: boolean; rolloutReason?: string });
    }

    return res.status(200).json({
      version: firmware.version,
      notes: firmware.releaseNotes,
      url: firmware.downloadUrl,
      checksum: firmware.checksum,
      size: firmware.size,
      updateAvailable: true
    } as GetFirmwareResponse & { updateAvailable: boolean });

  } catch (error) {
    logger.error('Firmware check failed', {
      uid,
      hardware,
      currentFirmware,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

// POST /v1/devices/:id/firmware/report — отчёт об установке прошивки
otaRouter.post('/devices/:id/firmware/report', validateFirmwareReport(), async (req: Request, res: Response) => {
  const uid = req.auth?.user.uid;
  if (!uid) {
    return sendError(res, { code: 'unauthenticated', message: 'Authentication required' });
  }

  const deviceId = req.params.id;
  const { fromVersion, toVersion, status, errorCode, errorMessage } = req.body as ReportFirmwareRequest;

  try {
    // Проверяем, что устройство принадлежит пользователю
    const deviceRef = db.collection('devices').doc(deviceId);
    const deviceSnap = await deviceRef.get();
    
    if (!deviceSnap.exists) {
      return sendError(res, { code: 'not_found', message: 'Device not found' });
    }

    const deviceData = deviceSnap.data() as Record<string, unknown>;
    if ((deviceData['ownerId'] as string | undefined) !== uid) {
      return sendError(res, { code: 'permission_denied', message: 'Access denied' });
    }

    const now = FieldValue.serverTimestamp();
    
    // Создаём отчёт об установке
    const reportRef = db.collection('firmwareReports').doc();
    await reportRef.set({
      id: reportRef.id,
      deviceId,
      ownerId: uid,
      fromVersion,
      toVersion,
      status,
      errorCode: errorCode || null,
      errorMessage: errorMessage || null,
      reportedAt: now,
      createdAt: now,
    });

    // Обновляем версию прошивки на устройстве при успешной установке
    if (status === 'success') {
      await deviceRef.update({
        firmwareVersion: toVersion,
        updatedAt: now,
      });
    }

    // Логируем результат для мониторинга
    logger.info('Firmware report received', {
      deviceId,
      ownerId: uid,
      fromVersion,
      toVersion,
      status,
      errorCode,
      requestId: req.headers['x-request-id'],
    });

    return res.status(200).json({ ok: true });

  } catch (error) {
    logger.error('Firmware report failed', {
      uid,
      deviceId,
      fromVersion,
      toVersion,
      status,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: req.headers['x-request-id'],
    });
    return sendError(res, { code: 'unavailable', message: 'Database unavailable' });
  }
});

export default otaRouter;
