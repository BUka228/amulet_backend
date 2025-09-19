/**
 * Интеграционные тесты для API правил
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { app } from '../../api/test';
import request from 'supertest';

describe('Rules API Integration Tests', () => {
  const testUserId = 'test-user-rules';
  const testHeaders = {
    'X-Test-Uid': testUserId,
    'Content-Type': 'application/json'
  };

  // Глобальная настройка эмуляторов уже выполняется в support/setup.ts через beforeAll/afterAll

  beforeEach(async () => {
    // Очистка тестовых данных
    // В реальном тесте здесь была бы очистка Firestore
  });

  describe('GET /v1/rules', () => {
    test('should return empty list for new user', async () => {
      const response = await request(app)
        .get('/v1/rules')
        .set(testHeaders);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ items: [] });
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .get('/v1/rules');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /v1/rules', () => {
    test('should create rule successfully', async () => {
      const ruleData = {
        trigger: {
          type: 'device_gesture',
          params: {
            gesture: 'double_tap',
            deviceId: 'device123'
          }
        },
        action: {
          type: 'start_practice',
          params: {
            practiceId: 'practice123',
            intensity: 0.8
          }
        },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(ruleData);

      expect(response.status).toBe(201);
      expect(response.body.rule).toMatchObject({
        ownerId: testUserId,
        trigger: ruleData.trigger,
        action: ruleData.action,
        enabled: true,
        triggerCount: 0
      });
      expect(response.body.rule.id).toBeDefined();
      expect(response.body.rule.createdAt).toBeDefined();
      expect(response.body.rule.updatedAt).toBeDefined();
    });

    test('should create rule with schedule', async () => {
      const ruleData = {
        trigger: {
          type: 'time',
          params: {
            hour: 9,
            minute: 0
          }
        },
        action: {
          type: 'notification',
          params: {
            title: 'Morning Practice',
            message: 'Time for your daily meditation'
          }
        },
        schedule: {
          timezone: 'UTC',
          cron: '0 9 * * *'
        },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(ruleData);

      expect(response.status).toBe(201);
      expect(response.body.rule.schedule).toEqual(ruleData.schedule);
    });

    test('should validate rule data', async () => {
      const invalidRuleData = {
        trigger: {
          type: 'invalid_type', // Invalid trigger type
          params: {}
        },
        action: {
          type: 'start_practice',
          params: {}
        },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(invalidRuleData);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_argument');
    });

    test('should require authentication', async () => {
      const ruleData = {
        trigger: { type: 'device_gesture', params: {} },
        action: { type: 'start_practice', params: {} },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .send(ruleData);

      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /v1/rules/:ruleId', () => {
    let ruleId: string;

    beforeEach(async () => {
      // Создаем правило для тестов
      const ruleData = {
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice123' } },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(ruleData);

      ruleId = response.body.rule.id;
    });

    test('should update rule successfully', async () => {
      const updateData = {
        enabled: false
      };

      const response = await request(app)
        .patch(`/v1/rules/${ruleId}`)
        .set(testHeaders)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.rule.enabled).toBe(false);
      expect(response.body.rule.updatedAt).toBeDefined();
    });

    test('should update rule trigger and action', async () => {
      const updateData = {
        trigger: {
          type: 'calendar',
          params: {
            eventTitle: 'Important Meeting',
            minutesBefore: 5
          }
        },
        action: {
          type: 'send_hug',
          params: {
            toUserId: 'partner123',
            emotion: { color: '#FF6B6B', patternId: 'calm' }
          }
        }
      };

      const response = await request(app)
        .patch(`/v1/rules/${ruleId}`)
        .set(testHeaders)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.rule.trigger).toEqual(updateData.trigger);
      expect(response.body.rule.action).toEqual(updateData.action);
    });

    test('should handle rule not found', async () => {
      const updateData = { enabled: false };

      const response = await request(app)
        .patch('/v1/rules/nonexistent-rule')
        .set(testHeaders)
        .send(updateData);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    test('should validate update data', async () => {
      const invalidUpdateData = {
        trigger: {
          type: 'invalid_type', // Invalid trigger type
          params: {}
        }
      };

      const response = await request(app)
        .patch(`/v1/rules/${ruleId}`)
        .set(testHeaders)
        .send(invalidUpdateData);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_argument');
    });
  });

  describe('DELETE /v1/rules/:ruleId', () => {
    let ruleId: string;

    beforeEach(async () => {
      // Создаем правило для тестов
      const ruleData = {
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice123' } },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(ruleData);

      ruleId = response.body.rule.id;
    });

    test('should delete rule successfully', async () => {
      const response = await request(app)
        .delete(`/v1/rules/${ruleId}`)
        .set(testHeaders);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });

    test('should handle rule not found', async () => {
      const response = await request(app)
        .delete('/v1/rules/nonexistent-rule')
        .set(testHeaders);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('not_found');
    });

    test('should require authentication', async () => {
      const response = await request(app)
        .delete(`/v1/rules/${ruleId}`);

      expect(response.status).toBe(401);
    });
  });

  describe('Rule ownership', () => {
    let ruleId: string;
    const otherUserId = 'other-user-rules';

    beforeEach(async () => {
      // Создаем правило от имени testUserId
      const ruleData = {
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice123' } },
        enabled: true
      };

      const response = await request(app)
        .post('/v1/rules')
        .set(testHeaders)
        .send(ruleData);

      ruleId = response.body.rule.id;
    });

    test('should not allow other user to update rule', async () => {
      const updateData = { enabled: false };

      const response = await request(app)
        .patch(`/v1/rules/${ruleId}`)
        .set({
          'X-Test-Uid': otherUserId,
          'Content-Type': 'application/json'
        })
        .send(updateData);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('permission_denied');
    });

    test('should not allow other user to delete rule', async () => {
      const response = await request(app)
        .delete(`/v1/rules/${ruleId}`)
        .set({
          'X-Test-Uid': otherUserId,
          'Content-Type': 'application/json'
        });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('permission_denied');
    });
  });
});


