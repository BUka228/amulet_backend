/**
 * Интеграционные тесты для middleware в HTTP приложении
 */

import express from 'express';
import request from 'supertest';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { clearConfigCache, setConfigValue } from '../../core/remoteConfig';

// Мокируем Remote Config
jest.mock('../../core/remoteConfig', () => ({
  isMaintenanceMode: jest.fn(),
  isApiV1Deprecated: jest.fn(),
  clearConfigCache: jest.fn(),
  setConfigValue: jest.fn(),
}));

describe('HTTP Middleware Integration', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    applyBaseMiddlewares(app);
    
    // Добавляем тестовый роут
    app.get('/v1/test', (req, res) => {
      res.json({ message: 'OK' });
    });
    
    app.get('/v2/test', (req, res) => {
      res.json({ message: 'OK v2' });
    });
    
    app.use(errorHandler());
    
    clearConfigCache();
  });

  describe('Maintenance Mode Integration', () => {
    it('should allow requests when maintenance mode is disabled', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.body.message).toBe('OK');
    });

    it('should block all requests when maintenance mode is enabled', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(503);

      expect(response.body.code).toBe('maintenance_mode');
      expect(response.body.message).toBe('Service temporarily unavailable due to maintenance');
      expect(response.body.details).toHaveProperty('retryAfter');
    });

    it('should block v2 requests when maintenance mode is enabled', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(true);

      const response = await request(app)
        .get('/v2/test')
        .expect(503);

      expect(response.body.code).toBe('maintenance_mode');
    });

    it('should continue on Remote Config error', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockRejectedValue(new Error('Config error'));

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.body.message).toBe('OK');
    });
  });

  describe('API Deprecation Integration', () => {
    it('should not add deprecation headers when API is not deprecated', async () => {
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(false);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.headers.deprecation).toBeUndefined();
      expect(response.headers.sunset).toBeUndefined();
      expect(response.headers.link).toBeUndefined();
    });

    it('should add deprecation headers for v1 API when deprecated', async () => {
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.headers.deprecation).toBe('true');
      expect(response.headers.sunset).toBe('2025-12-31T23:59:59Z');
      expect(response.headers.link).toBe('</v2/>; rel="successor-version"');
    });

    it('should not add deprecation headers for v2 API even when v1 is deprecated', async () => {
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockResolvedValue(true);

      const response = await request(app)
        .get('/v2/test')
        .expect(200);

      expect(response.headers.deprecation).toBeUndefined();
      expect(response.headers.sunset).toBeUndefined();
      expect(response.headers.link).toBeUndefined();
    });

    it('should continue on Remote Config error', async () => {
      const { isApiV1Deprecated } = require('../../core/remoteConfig');
      isApiV1Deprecated.mockRejectedValue(new Error('Config error'));

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.headers.deprecation).toBeUndefined();
    });
  });

  describe('Combined Middleware Behavior', () => {
    it('should apply maintenance mode before deprecation headers', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(true);
      isApiV1Deprecated.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(503);

      // Maintenance mode должен блокировать запрос до проверки депрекации
      expect(response.body.code).toBe('maintenance_mode');
      expect(response.headers.deprecation).toBeUndefined();
    });

    it('should apply deprecation headers when maintenance mode is disabled', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);
      isApiV1Deprecated.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.headers.deprecation).toBe('true');
    });

    it('should handle both middleware errors gracefully', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockRejectedValue(new Error('Maintenance error'));
      isApiV1Deprecated.mockRejectedValue(new Error('Deprecation error'));

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.body.message).toBe('OK');
    });
  });

  describe('Request ID and Headers', () => {
    it('should add request ID header', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);
      isApiV1Deprecated.mockResolvedValue(false);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should preserve existing request ID', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);
      isApiV1Deprecated.mockResolvedValue(false);

      const customRequestId = 'custom-request-id-123';
      const response = await request(app)
        .get('/v1/test')
        .set('X-Request-ID', customRequestId)
        .expect(200);

      expect(response.headers['x-request-id']).toBe(customRequestId);
    });
  });

  describe('Error Response Format', () => {
    it('should return proper error format for maintenance mode', async () => {
      const { isMaintenanceMode } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(503);

      expect(response.body).toHaveProperty('code', 'maintenance_mode');
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('details');
      expect(response.body.details).toHaveProperty('retryAfter');
    });

    it('should return proper error format for API deprecation', async () => {
      const { isMaintenanceMode, isApiV1Deprecated } = require('../../core/remoteConfig');
      isMaintenanceMode.mockResolvedValue(false);
      isApiV1Deprecated.mockResolvedValue(true);

      const response = await request(app)
        .get('/v1/test')
        .expect(200);

      // API deprecation не блокирует запрос, только добавляет заголовки
      expect(response.body.message).toBe('OK');
      expect(response.headers.deprecation).toBe('true');
    });
  });
});
