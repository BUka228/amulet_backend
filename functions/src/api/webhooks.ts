import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../core/firebase';
import { sendError } from '../core/http';
import * as logger from 'firebase-functions/logger';

export const webhooksRouter = express.Router();

// Хранилище секретов интеграций: читаем из Firestore коллекции `integrations/{integrationKey}`
async function loadIntegrationSecret(integrationKey: string): Promise<{ secret: string; replayTtlSec: number } | null> {
  try {
    const doc = await db.collection('integrations').doc(integrationKey).get();
    if (!doc.exists) return null;
    const data = doc.data() as { secret?: string; replayTtlSec?: number };
    const secret = data?.secret || process.env[`WEBHOOK_${integrationKey.toUpperCase()}_SECRET`] || '';
    const replayTtlSec = Number(data?.replayTtlSec ?? process.env.WEBHOOK_REPLAY_TTL_SEC ?? 300);
    if (!secret) return null;
    return { secret, replayTtlSec: Number.isFinite(replayTtlSec) ? replayTtlSec : 300 };
  } catch (e) {
    logger.error('Failed to load integration secret', { integrationKey, error: e instanceof Error ? e.message : 'Unknown' });
    return null;
  }
}

function constantTimeEqual(a: string, b: string) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function isReplay(signatureId: string, ttlSec: number): Promise<boolean> {
  const now = Date.now();
  const docRef = db.collection('webhookReplays').doc(signatureId);
  const snap = await docRef.get();
  if (snap.exists) {
    const data = snap.data() as { expiresAt: number } | undefined;
    if (data && now < data.expiresAt) return true;
  }
  await docRef.set({ expiresAt: now + ttlSec * 1000 }, { merge: false });
  return false;
}

// Публичный обработчик: POST /v1/webhooks/:integrationKey
webhooksRouter.post('/webhooks/:integrationKey', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response) => {
  const { integrationKey } = req.params;

  const signatureHeader = (req.header('x-signature') || req.header('X-Signature') || '').toString();
  const timestampHeader = (req.header('x-timestamp') || req.header('X-Timestamp') || '').toString();
  const idHeader = (req.header('x-id') || req.header('X-Id') || '').toString();

  if (!signatureHeader || !timestampHeader || !idHeader) {
    return sendError(res, { code: 'invalid_argument', message: 'Missing signature headers' });
  }

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 10 * 60 * 1000) {
    return sendError(res, { code: 'failed_precondition', message: 'Timestamp skew too large' });
  }

  const config = await loadIntegrationSecret(integrationKey);
  if (!config) {
    return sendError(res, { code: 'not_found', message: 'Integration not configured' });
  }

  // Anti-replay: idempotent по заголовку X-Id в пределах TTL
  if (await isReplay(`${integrationKey}:${idHeader}`, config.replayTtlSec)) {
    return sendError(res, { code: 'already_exists', message: 'Replay detected' });
  }

  // Подпись: HMAC SHA-256 от `${ts}.${rawBody}`
  const raw = (req.body as Buffer) ?? Buffer.from('');
  const payloadToSign = Buffer.concat([Buffer.from(String(ts)), Buffer.from('.') , raw]);
  const expected = crypto.createHmac('sha256', config.secret).update(payloadToSign).digest('hex');

  if (!constantTimeEqual(expected, signatureHeader)) {
    return sendError(res, { code: 'permission_denied', message: 'Invalid signature' });
  }

  // Пример: записываем событие в коллекцию inboundWebhooks для дальнейшей обработки воркером
  try {
    const docRef = await db.collection('inboundWebhooks').add({
      integrationKey,
      receivedAt: new Date().toISOString(),
      timestamp: ts,
      id: idHeader,
      payloadBase64: raw.toString('base64'),
      processed: false,
      createdAt: new Date(),
    });
    logger.info('Webhook accepted', { integrationKey, id: idHeader, docId: docRef.id });
    return res.status(202).json({ accepted: true });
  } catch (e) {
    logger.error('Failed to persist webhook', { integrationKey, error: e instanceof Error ? e.message : 'Unknown' });
    return sendError(res, { code: 'unavailable', message: 'Storage unavailable' });
  }
});

export default webhooksRouter;


