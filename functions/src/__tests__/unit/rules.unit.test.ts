/**
 * Unit тесты для API правил
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';
import { rulesRouter } from '../../api/rules';
import { sendError } from '../../core/http';

// Мок для Firebase Admin (объявляем внутри фабрики, чтобы избежать hoist-ошибок)
jest.mock('../../core/firebase', () => {
  const collection = jest.fn();
  return {
    db: {
      collection
    },
    // экспортируем для доступа из теста
    __collectionMock: collection,
  } as any;
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
    increment: jest.fn((value) => ({ increment: value }))
  }
}));

describe('Rules API Unit Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: jest.Mock;
  let mockCollection: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection = (require('../../core/firebase').__collectionMock) as jest.Mock;
    
    mockRequest = {
      headers: {},
      auth: { uid: 'test-user-id' },
      body: {}
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
  });

  describe('GET /rules', () => {
    test('should return user rules successfully', async () => {
      const mockRules = [
        {
          id: 'rule1',
          ownerId: 'test-user-id',
          trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
          action: { type: 'start_practice', params: { practiceId: 'practice1' } },
          enabled: true,
          triggerCount: 5,
          createdAt: { seconds: 1234567890, nanoseconds: 0 },
          updatedAt: { seconds: 1234567890, nanoseconds: 0 }
        }
      ];

      const mockSnapshot = {
        docs: mockRules.map(rule => ({
          id: rule.id,
          data: () => rule
        }))
      };

      mockCollection.mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(mockSnapshot)
          })
        })
      });

      const req = mockRequest as Request;
      const res = mockResponse as Response;

      // Вызываем обработчик напрямую
      const handler = rulesRouter.stack.find(layer => layer.route?.path === '/rules')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.json).toHaveBeenCalledWith({ items: mockRules });
    });

    test('should handle authentication error', async () => {
      const req = { ...mockRequest, auth: undefined, headers: {} } as Request;
      const res = mockResponse as Response;

      const handler = rulesRouter.stack.find(layer => layer.route?.path === '/rules')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(401);
    });
  });

  describe('POST /rules', () => {
    test('should create rule successfully', async () => {
      const ruleData = {
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice1' } },
        enabled: true
      };

      const mockRuleRef = {
        id: 'new-rule-id',
        get: jest.fn().mockResolvedValue({
          id: 'new-rule-id',
          data: () => ({
            ...ruleData,
            ownerId: 'test-user-id',
            triggerCount: 0,
            createdAt: { seconds: 1234567890, nanoseconds: 0 },
            updatedAt: { seconds: 1234567890, nanoseconds: 0 }
          })
        })
      };

      mockCollection.mockReturnValue({
        add: jest.fn().mockResolvedValue(mockRuleRef)
      });

      const req = { ...mockRequest, body: ruleData } as Request;
      const res = mockResponse as Response;

      const postRouteLayer = rulesRouter.stack.find(layer => layer.route?.path === '/rules' && layer.route?.methods?.post);
      const handler = postRouteLayer?.route?.stack?.slice(-1)[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(201);
      expect(mockResponse.json).toHaveBeenCalled();
    });

    test('should validate rule data', async () => {
      const invalidRuleData = {
        trigger: { type: 'invalid_type', params: {} },
        action: { type: 'start_practice', params: {} },
        enabled: true
      };

      const req = { ...mockRequest, body: invalidRuleData } as Request;
      const res = mockResponse as Response;

      const postRouteLayer = rulesRouter.stack.find(layer => layer.route?.path === '/rules' && layer.route?.methods?.post);
      const validator = postRouteLayer?.route?.stack?.[0]?.handle; // validateBody middleware
      if (validator) {
        await validator(req, res, jest.fn());
      }

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });
  });

  describe('PATCH /rules/:ruleId', () => {
    test('should update rule successfully', async () => {
      const updateData = {
        enabled: false
      };

      const existingRule = {
        id: 'rule1',
        ownerId: 'test-user-id',
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice1' } },
        enabled: true,
        triggerCount: 5,
        createdAt: { seconds: 1234567890, nanoseconds: 0 },
        updatedAt: { seconds: 1234567890, nanoseconds: 0 }
      };

      const mockRuleRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => existingRule
        }),
        update: jest.fn().mockResolvedValue({})
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockRuleRef)
      });

      const req = { 
        ...mockRequest, 
        body: updateData,
        params: { ruleId: 'rule1' }
      } as Request;
      const res = mockResponse as Response;

      const handler = rulesRouter.stack.find(layer => layer.route?.path === '/rules/:ruleId')?.route?.stack?.[1]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockRuleRef.update).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalled();
    });

    test('should handle rule not found', async () => {
      const mockRuleRef = {
        get: jest.fn().mockResolvedValue({
          exists: false
        })
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockRuleRef)
      });

      const req = { 
        ...mockRequest, 
        body: { enabled: false },
        params: { ruleId: 'nonexistent-rule' }
      } as Request;
      const res = mockResponse as Response;

      const handler = rulesRouter.stack.find(layer => layer.route?.path === '/rules/:ruleId')?.route?.stack?.[1]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    test('should handle permission denied', async () => {
      const existingRule = {
        id: 'rule1',
        ownerId: 'other-user-id', // Different owner
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice1' } },
        enabled: true
      };

      const mockRuleRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => existingRule
        })
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockRuleRef)
      });

      const req = { 
        ...mockRequest, 
        body: { enabled: false },
        params: { ruleId: 'rule1' }
      } as Request;
      const res = mockResponse as Response;

      const handler = rulesRouter.stack.find(layer => layer.route?.path === '/rules/:ruleId')?.route?.stack?.[1]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });
  });

  describe('DELETE /rules/:ruleId', () => {
    test('should delete rule successfully', async () => {
      const existingRule = {
        id: 'rule1',
        ownerId: 'test-user-id',
        trigger: { type: 'device_gesture', params: { gesture: 'double_tap' } },
        action: { type: 'start_practice', params: { practiceId: 'practice1' } },
        enabled: true
      };

      const mockRuleRef = {
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => existingRule
        }),
        delete: jest.fn().mockResolvedValue({})
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue(mockRuleRef)
      });

      const req = { 
        ...mockRequest, 
        params: { ruleId: 'rule1' }
      } as Request;
      const res = mockResponse as Response;

      const deleteRouteLayer = rulesRouter.stack.find(layer => layer.route?.path === '/rules/:ruleId' && layer.route?.methods?.delete);
      const handler = deleteRouteLayer?.route?.stack?.slice(-1)[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockRuleRef.delete).toHaveBeenCalled();
      expect(mockResponse.json).toHaveBeenCalledWith({ ok: true });
    });
  });
});


