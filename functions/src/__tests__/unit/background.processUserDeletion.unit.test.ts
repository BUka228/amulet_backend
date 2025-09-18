import { processUserDeletionHandler } from '../../background/deleteUser';
import { db } from '../../core/firebase';

// Подготовим тестовые данные и событие Pub/Sub
function buildPubSubEvent(payload: unknown) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  return {
    data: {
      message: {
        data,
        messageId: 'm1'
      }
    }
  } as unknown as Parameters<typeof processUserDeletion>[0];
}

describe('processUserDeletion background function', () => {
  const userId = 'u_bg_1';

  beforeEach(async () => {
    await db.collection('users').doc(userId).set({
      id: userId,
      displayName: 'To Delete',
      isDeleted: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      pushTokens: []
    });
  });

  afterEach(async () => {
    await db.collection('users').doc(userId).delete();
  });

  it('anonymizes user data and sets job status to completed', async () => {
    const jobId = 'job_bg_1';
    await db.collection('deletionJobs').doc(jobId).set({ jobId, status: 'pending', userId });
    await processUserDeletionHandler({ jobId, userId, requestedAt: new Date().toISOString(), priority: 'normal' });

    const userSnap = await db.collection('users').doc(userId).get();
    expect(userSnap.data()?.isDeleted).toBe(true);

    const jobSnap = await db.collection('deletionJobs').doc(jobId).get();
    expect(jobSnap.data()?.status).toBe('completed');
  });
});


