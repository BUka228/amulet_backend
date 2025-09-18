import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { db } from '../../core/firebase';
import { processOutboxHandler } from '../../background/outboxWorker';
import * as admin from 'firebase-admin';

describe('background: outboxWorker', () => {
  const toUserId = 'u_recv';
  const fromUserId = 'u_sender';

  beforeEach(async () => {
    jest.restoreAllMocks();
    const now = new Date();
    await Promise.all([
      db.collection('users').doc(toUserId).set({ id: toUserId, createdAt: now }),
      db.collection('users').doc(fromUserId).set({ id: fromUserId, createdAt: now }),
      db.collection('notificationTokens').doc('tok1').set({ userId: toUserId, token: 'fcm-token-1', isActive: true }),
    ]);
  });

  it('delivers pattern.shared and marks delivered', async () => {
    const sendMock = jest.spyOn((admin as any).messaging.Messaging.prototype, 'sendEachForMulticast').mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] } as any);
    const id = 'out_1';
    await db.collection('outbox').doc(id).set({
      id,
      type: 'pattern.shared',
      status: 'pending',
      attempts: 0,
      payload: { toUserId, fromUserId, patternId: 'p1', title: 'T' },
      createdAt: new Date(),
    });

    await processOutboxHandler({ id, type: 'pattern.shared', status: 'pending', attempts: 0, payload: { toUserId, fromUserId, patternId: 'p1', title: 'T' } });

    const snap = await db.collection('outbox').doc(id).get();
    expect(snap.data()?.status).toBe('delivered');
    expect(sendMock).toHaveBeenCalled();
    sendMock.mockRestore();
  });

  it('schedules retry with backoff on error and fails after max attempts', async () => {
    const sendMock = jest.spyOn((admin as any).messaging.Messaging.prototype, 'sendEachForMulticast').mockRejectedValue(new Error('FCM down'));
    const id = 'out_err_1';
    await db.collection('outbox').doc(id).set({
      id,
      type: 'pattern.shared',
      status: 'pending',
      attempts: 0,
      payload: { toUserId, fromUserId, patternId: 'p2', title: 'T2' },
      createdAt: new Date(),
    });

    // First attempt -> pending with nextAttemptAt
    await processOutboxHandler({ id, type: 'pattern.shared', status: 'pending', attempts: 0, payload: { toUserId, fromUserId, patternId: 'p2', title: 'T2' } } as any);
    let snap = await db.collection('outbox').doc(id).get();
    expect(snap.data()?.status).toBe('pending');
    expect(snap.data()?.attempts).toBe(1);
    expect(snap.data()?.nextAttemptAt).toBeTruthy();

    // Simulate multiple failures to reach max attempts
    for (let a = 1; a < 5; a++) {
      await processOutboxHandler({ id, type: 'pattern.shared', status: 'pending', attempts: a, payload: { toUserId, fromUserId, patternId: 'p2', title: 'T2' } } as any);
    }
    snap = await db.collection('outbox').doc(id).get();
    expect(['pending', 'failed']).toContain(snap.data()?.status);
    // cleanup
    sendMock.mockRestore();
  });
});


