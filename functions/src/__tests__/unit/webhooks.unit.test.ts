/**
 * Unit тесты для API вебхуков
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { Request, Response } from 'express';
import { webhooksRouter } from '../../api/webhooks';
import crypto from 'crypto';

// Мок для Firebase Admin (в фабрике — чтобы избежать hoist-ошибок)
jest.mock('../../core/firebase', () => {
  const collection = jest.fn();
  return {
    db: {
      collection
    },
    __collectionMock: collection,
  } as any;
});

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => 'server-timestamp'),
    increment: jest.fn((value) => ({ increment: value }))
  }
}));

describe('Webhooks API Unit Tests', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockCollection: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection = (require('../../core/firebase').__collectionMock) as jest.Mock;
    
    mockRequest = {
      headers: {},
      body: {},
      params: { integrationKey: 'test-integration' }
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('POST /webhooks/:integrationKey', () => {
    test('should process webhook successfully', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const timestamp = Date.now();

      // Мок для получения секрета
      const mockWebhookDoc = {
        exists: true,
        data: () => ({
          secret,
          isActive: true
        })
      };

      // Мок для проверки replay protection
      const mockReplayDoc = {
        exists: false
      };

      // Мок для поиска правил
      const mockRulesSnapshot = {
        docs: []
      };

      mockCollection
        .mockReturnValueOnce({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(mockWebhookDoc)
          })
        })
        .mockReturnValueOnce({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(mockReplayDoc),
            set: jest.fn().mockResolvedValue({})
          })
        })
        .mockReturnValueOnce({
          where: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue(mockRulesSnapshot)
            })
          })
        })
        .mockReturnValueOnce({
          doc: jest.fn().mockReturnValue({
            update: jest.fn().mockResolvedValue({})
          })
        });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(202);
      expect(mockResponse.json).toHaveBeenCalledWith({ accepted: true });
    });

    test('should reject webhook with missing signature', async () => {
      const req = {
        ...mockRequest,
        headers: {},
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(400);
    });

    test('should reject webhook with invalid signature', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const invalidSignature = 'invalid-signature';
      const timestamp = Date.now();

      const mockWebhookDoc = {
        exists: true,
        data: () => ({
          secret,
          isActive: true
        })
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockWebhookDoc)
        })
      });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': invalidSignature,
          'x-timestamp': timestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(403);
    });

    test('should reject webhook for inactive integration', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const timestamp = Date.now();

      const mockWebhookDoc = {
        exists: true,
        data: () => ({
          secret,
          isActive: false // Inactive integration
        })
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockWebhookDoc)
        })
      });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    test('should reject webhook for non-existent integration', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const timestamp = Date.now();

      const mockWebhookDoc = {
        exists: false
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockWebhookDoc)
        })
      });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(404);
    });

    test('should reject webhook with old timestamp', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 minutes ago

      const mockWebhookDoc = {
        exists: true,
        data: () => ({
          secret,
          isActive: true
        })
      };

      mockCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(mockWebhookDoc)
        })
      });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': signature,
          'x-timestamp': oldTimestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(412);
    });

    test('should reject webhook replay attack', async () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ test: 'data' });
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const timestamp = Date.now();

      const mockWebhookDoc = {
        exists: true,
        data: () => ({
          secret,
          isActive: true
        })
      };

      // Мок для проверки replay protection - подпись уже использовалась
      const mockReplayDoc = {
        exists: true
      };

      mockCollection
        .mockReturnValueOnce({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(mockWebhookDoc)
          })
        })
        .mockReturnValueOnce({
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue(mockReplayDoc)
          })
        });

      const req = {
        ...mockRequest,
        headers: {
          'x-signature': signature,
          'x-timestamp': timestamp.toString()
        },
        body: { test: 'data' }
      } as Request;
      const res = mockResponse as Response;

      const handler = webhooksRouter.stack.find(layer => layer.route?.path === '/webhooks/:integrationKey')?.route?.stack?.[0]?.handle;
      if (handler) {
        await handler(req, res);
      }

      expect(mockResponse.status).toHaveBeenCalledWith(412);
    });
  });
});


