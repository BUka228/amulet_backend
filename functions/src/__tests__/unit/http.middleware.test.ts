/**
 * Тесты для новых middleware в http.ts
 */

import { Request, Response, NextFunction } from 'express';
import { maintenanceModeMiddleware, apiDeprecationMiddleware } from '../../core/http';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';

// Мокируем Remote Config
jest.mock('../../core/remoteConfig', () => ({
  isMaintenanceMode: jest.fn(),
  isApiV1Deprecated: jest.fn(),
  clearConfigCache: jest.fn(),
  setConfigValue: jest.fn(),
}));

// Мокируем sendError
jest.mock('../../core/http', () => {
  const originalModule = jest.requireActual('../../core/http');
  return {
    ...originalModule,
    sendError: jest.fn((res, error) => {
      res.status(503).json(error);
    })
  };
});

describe('HTTP Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let mockSendError: jest.Mock;

  beforeEach(() => {
    mockReq = {
      path: '/v1/test',
      headers: {}
    };
    
    mockSendError = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis()
    };
    
    mockNext = jest.fn();
    
    // Очищаем моки
    jest.clearAllMocks();
    clearConfigCache();
  });

  describe('maintenanceModeMiddleware', () => {
    it('should allow requests when maintenance mode is disabled', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);

      const middleware = maintenanceModeMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should block requests when maintenance mode is enabled', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(true);

      const middleware = maintenanceModeMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({
        code: 'maintenance_mode',
        message: 'Service temporarily unavailable due to maintenance',
        details: { retryAfter: 3600 }
      });
    });

    it('should continue on Remote Config error', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockRejectedValue(new Error('Config error'));

      const middleware = maintenanceModeMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('apiDeprecationMiddleware', () => {
    it('should not add headers for non-v1 paths when API is not deprecated', async () => {
      mockReq.path = '/v2/test';
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(false);

      const middleware = apiDeprecationMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('should not add headers for v1 paths when API is not deprecated', async () => {
      mockReq.path = '/v1/test';
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(false);

      const middleware = apiDeprecationMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('should add deprecation headers for v1 paths when API is deprecated', async () => {
      mockReq.path = '/v1/test';
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(true);

      const middleware = apiDeprecationMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Deprecation', 'true');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Sunset', '2025-12-31T23:59:59Z');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Link', '</v2/>; rel="successor-version"');
    });

    it('should not add headers for non-v1 paths even when API is deprecated', async () => {
      mockReq.path = '/v2/test';
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(true);

      const middleware = apiDeprecationMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });

    it('should continue on Remote Config error', async () => {
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockRejectedValue(new Error('Config error'));

      const middleware = apiDeprecationMiddleware();
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.setHeader).not.toHaveBeenCalled();
    });
  });
});
