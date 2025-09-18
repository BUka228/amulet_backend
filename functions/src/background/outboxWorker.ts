import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db } from '../core/firebase';
import { getMessaging } from 'firebase-admin/messaging';

type OutboxRecord = {
  id: string;
  type: string;
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped';
  payload: Record<string, unknown>;
  attempts: number;
  createdAt?: Date | FirebaseFirestore.Timestamp;
  deliveredAt?: Date | FirebaseFirestore.Timestamp | null;
  lastError?: string | null;
  nextAttemptAt?: Date | FirebaseFirestore.Timestamp | null;
};

const MAX_ATTEMPTS = Number.parseInt(process.env.OUTBOX_MAX_ATTEMPTS || '5', 10);
const BASE_BACKOFF_MS = Number.parseInt(process.env.OUTBOX_BASE_BACKOFF_MS || '1000', 10);

function computeBackoffMs(attempts: number): number {
  const capped = Math.min(attempts, 6);
  const jitter = Math.floor(Math.random() * 250);
  return BASE_BACKOFF_MS * Math.pow(2, capped) + jitter;
}

export async function processOutboxHandler(record: OutboxRecord): Promise<void> {
  if (!record || record.status !== 'pending') return;

  const now = new Date();
  const nextAtRaw = record.nextAttemptAt as Date | FirebaseFirestore.Timestamp | undefined;
  const nextAt = nextAtRaw instanceof Date ? nextAtRaw : nextAtRaw?.toDate?.();
  if (nextAt && nextAt.getTime() > now.getTime()) {
    // Not yet time to retry
    return;
  }

  const docRef = db.collection('outbox').doc(record.id);
  // Mark processing to avoid races
  await docRef.set({ status: 'processing' }, { merge: true });

  try {
    if (record.type === 'pattern.shared') {
      const { toUserId, title, patternId, fromUserId } = record.payload as {
        toUserId?: string;
        title?: string;
        patternId: string;
        fromUserId: string;
      };

      if (toUserId) {
        const tokensSnap = await db
          .collection('notificationTokens')
          .where('userId', '==', toUserId)
          .where('isActive', '==', true)
          .get();
        const tokens = tokensSnap.docs
          .map((d) => (d.data() as { token?: string }).token)
          .filter(Boolean) as string[];
        if (tokens.length > 0) {
          await getMessaging().sendEachForMulticast({
            tokens,
            notification: {
              title: 'Новый паттерн',
              body: `Пользователь поделился с вами паттерном "${title ?? 'Новый паттерн'}"`,
            },
            data: {
              type: 'pattern.shared',
              patternId,
              fromUserId,
              title: title ?? '',
            },
          });
        }
      }

      await docRef.set({ status: 'delivered', deliveredAt: new Date(), attempts: record.attempts + 1, lastError: null, nextAttemptAt: null }, { merge: true });
      return;
    }

    // unknown type
    await docRef.set({ status: 'skipped', attempts: record.attempts + 1 }, { merge: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attemptsNext = record.attempts + 1;
    if (attemptsNext >= MAX_ATTEMPTS) {
      await docRef.set({ status: 'failed', attempts: attemptsNext, lastError: message, nextAttemptAt: null }, { merge: true });
      return;
    }
    const backoffMs = computeBackoffMs(record.attempts);
    const nextAttemptAt = new Date(Date.now() + backoffMs);
    await docRef.set({ status: 'pending', attempts: attemptsNext, lastError: message, nextAttemptAt }, { merge: true });
    logger.error('Outbox processing failed, scheduled retry', { id: record.id, attemptsNext, backoffMs, error: message });
  }
}

export const processOutbox = onDocumentWritten('outbox/{id}', async (event) => {
  const after = event.data?.after?.data() as OutboxRecord | undefined;
  if (!after) return;
  try {
    await processOutboxHandler({ ...after, id: after.id || event.params.id });
  } catch (err) {
    const id = event.params?.id;
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Outbox processing top-level failure', { id, error: message });
    if (id) {
      const ref = db.collection('outbox').doc(id);
      const attemptsNext = (after.attempts ?? 0) + 1;
      const backoffMs = computeBackoffMs(after.attempts ?? 0);
      const nextAttemptAt = new Date(Date.now() + backoffMs);
      await ref.set({ status: attemptsNext >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts: attemptsNext, lastError: message, nextAttemptAt: attemptsNext >= MAX_ATTEMPTS ? null : nextAttemptAt }, { merge: true });
    }
  }
});


