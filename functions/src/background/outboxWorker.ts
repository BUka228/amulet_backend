import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import * as logger from 'firebase-functions/logger';
import { db } from '../core/firebase';
import { getMessaging } from 'firebase-admin/messaging';

export const processOutbox = onDocumentWritten('outbox/{id}', async (event) => {
  try {
    const after = event.data?.after?.data() as
      | { id: string; type: string; status: string; payload: Record<string, unknown>; attempts: number }
      | undefined;
    if (!after) return;
    if (after.status !== 'pending') return;

    const docRef = db.collection('outbox').doc(after.id);
    // mark processing to avoid races
    await docRef.set({ status: 'processing' }, { merge: true });

    if (after.type === 'pattern.shared') {
      const { toUserId, title, patternId, fromUserId } = after.payload as {
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

      await docRef.set({ status: 'delivered', deliveredAt: new Date(), attempts: after.attempts + 1 }, { merge: true });
      return;
    }

    // unknown type
    await docRef.set({ status: 'skipped', attempts: after.attempts + 1 }, { merge: true });
  } catch (error) {
    const id = event.params?.id;
    logger.error('Outbox processing failed', { id, error: error instanceof Error ? error.message : String(error) });
    if (id) {
      await db.collection('outbox').doc(id).set({ status: 'pending', lastError: error instanceof Error ? error.message : String(error) }, { merge: true });
    }
  }
});


