/**
 * Интеграционные тесты для API вебхуков
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { app } from '../../api/test';
import request from 'supertest';
import crypto from 'crypto';
import { db } from '../../core/firebase';

describe('Webhooks API Integration Tests', () => {
  const integrationKey = 'test-integration-key';
  const secret = 'test-secret-key';

  beforeAll(async () => {
    // Создаем тестовую интеграцию вебхука в эмуляторе Firestore
    await db.collection('webhooks').doc(integrationKey).set({
      integrationKey,
      secret,
      isActive: true,
      usageCount: 0,
      allowedOrigins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  beforeEach(async () => {
    // Очистка тестовых данных
    // В реальном тесте здесь была бы очистка Firestore
  });

  describe('POST /v1/webhooks/:integrationKey', () => {
    test('should process webhook successfully', async () => {
      const payload = { test: 'data', timestamp: Date.now() };
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const timestamp = Date.now();

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ accepted: true });
    });

    test('should reject webhook with missing signature', async () => {
      const payload = { test: 'data' };

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_argument');
      expect(response.body.message).toContain('Missing X-Signature header');
    });

    test('should reject webhook with invalid signature', async () => {
      const payload = { test: 'data' };
      const invalidSignature = 'invalid-signature';
      const timestamp = Date.now();

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': invalidSignature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('permission_denied');
      expect(response.body.message).toContain('Invalid signature');
    });

    test('should reject webhook for non-existent integration', async () => {
      const payload = { test: 'data' };
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const timestamp = Date.now();

      const response = await request(app)
        .post('/v1/webhooks/nonexistent-integration')
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
      expect(response.body.message).toContain('Integration not found');
    });

    test('should reject webhook with old timestamp', async () => {
      const payload = { test: 'data' };
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': oldTimestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(response.status).toBe(412);
      expect(response.body.code).toBe('failed_precondition');
      expect(response.body.message).toContain('Request rejected (replay protection)');
    });

    test('should reject webhook replay attack', async () => {
      const payload = { test: 'data' };
      const payloadString = JSON.stringify(payload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const timestamp = Date.now();

      // Первый запрос должен пройти
      const firstResponse = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(firstResponse.status).toBe(202);

      // Второй запрос с той же подписью должен быть отклонен
      const secondResponse = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload);

      expect(secondResponse.status).toBe(412);
      expect(secondResponse.body.code).toBe('failed_precondition');
      expect(secondResponse.body.message).toContain('Request rejected (replay protection)');
    });

    test('should handle different payloads with same signature', async () => {
      const payload1 = { test: 'data1' };
      const payload2 = { test: 'data2' };
      const signature1 = crypto.createHmac('sha256', secret).update(JSON.stringify(payload1)).digest('hex');
      const signature2 = crypto.createHmac('sha256', secret).update(JSON.stringify(payload2)).digest('hex');
      const timestamp = Date.now();

      const response1 = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature1,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload1);

      const response2 = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature2,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(payload2);

      expect(response1.status).toBe(202);
      expect(response2.status).toBe(202);
    });

    test('should handle webhook with complex payload', async () => {
      const complexPayload = {
        event: 'user_action',
        data: {
          userId: 'user123',
          action: 'completed_practice',
          practiceId: 'practice123',
          duration: 300,
          metadata: {
            deviceId: 'device123',
            timestamp: Date.now(),
            location: { lat: 55.7558, lng: 37.6176 }
          }
        },
        timestamp: Date.now()
      };

      const payloadString = JSON.stringify(complexPayload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const timestamp = Date.now();

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(complexPayload);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ accepted: true });
    });

    test('should handle webhook with empty payload', async () => {
      const emptyPayload = {};
      const payloadString = JSON.stringify(emptyPayload);
      const signature = crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
      const timestamp = Date.now();

      const response = await request(app)
        .post(`/v1/webhooks/${integrationKey}`)
        .set({
          'X-Signature': signature,
          'X-Timestamp': timestamp.toString(),
          'Content-Type': 'application/json'
        })
        .send(emptyPayload);

      expect(response.status).toBe(202);
      expect(response.body).toEqual({ accepted: true });
    });
  });
});


