import request from 'supertest';
import { describe, it, expect, beforeAll } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';
import { applyBaseMiddlewares, errorHandler } from '../../core/http';
import { i18nMiddleware } from '../../core/i18n';
import devicesRouter from '../../api/devices';
import { db } from '../../core/firebase';

describe('Devices API (/v1/devices*)', () => {
  const app = express();
  applyBaseMiddlewares(app);
  app.use(i18nMiddleware());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const testUid = (req.headers['x-test-uid'] as string) || '';
    if (!req.auth && testUid) {
      (req as unknown as { auth: unknown }).auth = {
        user: { uid: testUid, customClaims: {} },
        token: 'test-token',
        isAuthenticated: true,
      };
    }
    next();
  });
  app.use('/v1', devicesRouter);
  app.use(errorHandler());
  const agent = request(app);
  const headers = { 'X-Test-Uid': 'u_integration_devices_1' } as Record<string, string>;

  beforeAll(() => {
    if (admin.apps.length === 0) {
      admin.initializeApp({ projectId: 'amulet-test' });
    }
  });

  async function seedClaimToken(serial: string, token: string, ttlSeconds = 120) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
    const ref = db.collection('claimTokens').doc();
    await ref.set({
      id: ref.id,
      serial,
      tokenHash,
      used: false,
      createdAt: now,
      expiresAt,
    });
  }

  it('POST /v1/devices.claim creates a device and returns it', async () => {
    await seedClaimToken('AMU-200-XYZ-001', 'otp123');
    const res = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-001', claimToken: 'otp123', name: 'Мой амулет' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('device');
    expect(res.body.device.ownerId).toBe('u_integration_devices_1');
    expect(res.body.device.serial).toBe('AMU-200-XYZ-001');
  });

  it('GET /v1/devices returns list including claimed device', async () => {
    await seedClaimToken('AMU-200-XYZ-002', 'otp999');
    await agent.post('/v1/devices.claim').set(headers).send({ serial: 'AMU-200-XYZ-002', claimToken: 'otp999' });
    const res = await agent.get('/v1/devices').set(headers);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices.length).toBeGreaterThan(0);
  });

  it('GET /v1/devices/:id returns device details if owner', async () => {
    await seedClaimToken('AMU-200-XYZ-003', 'otp003');
    const created = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-003', claimToken: 'otp003' });
    const id = created.body.device.id;
    const res = await agent.get(`/v1/devices/${id}`).set(headers);
    expect(res.status).toBe(200);
    expect(res.body.device.id).toBe(id);
  });

  it('PATCH /v1/devices/:id updates name/settings', async () => {
    await seedClaimToken('AMU-200-XYZ-004', 'otp004');
    const created = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-004', claimToken: 'otp004' });
    const id = created.body.device.id;
    const res = await agent
      .patch(`/v1/devices/${id}`)
      .set(headers)
      .send({ name: 'Новое имя', settings: { brightness: 80 } });
    expect(res.status).toBe(200);
    expect(res.body.device.name).toBe('Новое имя');
    expect(res.body.device.settings.brightness).toBe(80);
  });

  it('POST /v1/devices/:id/unclaim removes ownership', async () => {
    await seedClaimToken('AMU-200-XYZ-005', 'otp005');
    const created = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-005', claimToken: 'otp005' });
    const id = created.body.device.id;
    const res = await agent.post(`/v1/devices/${id}/unclaim`).set(headers).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // Негативные сценарии
  it('returns 403 when claimToken is invalid', async () => {
    await seedClaimToken('AMU-200-XYZ-006', 'valid');
    const res = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-006', claimToken: 'invalid' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('permission_denied');
  });

  it('prevents non-owner from reading/updating/unclaiming device (403)', async () => {
    await seedClaimToken('AMU-200-XYZ-007', 'otp007');
    const created = await agent
      .post('/v1/devices.claim')
      .set(headers)
      .send({ serial: 'AMU-200-XYZ-007', claimToken: 'otp007' });
    const id = created.body.device.id;
    const otherHeaders = { 'X-Test-Uid': 'u_another_user' } as Record<string, string>;
    const r1 = await agent.get(`/v1/devices/${id}`).set(otherHeaders);
    expect(r1.status).toBe(403);
    const r2 = await agent.patch(`/v1/devices/${id}`).set(otherHeaders).send({ name: 'nope' });
    expect(r2.status).toBe(403);
    const r3 = await agent.post(`/v1/devices/${id}/unclaim`).set(otherHeaders).send({});
    expect(r3.status).toBe(403);
  });

  it('returns 400 on invalid body (fails Zod)', async () => {
    const res = await agent.post('/v1/devices.claim').set(headers).send({ serial: 123, claimToken: null });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_argument');
  });

  it('returns 404 for non-existent device on GET', async () => {
    const res = await agent.get('/v1/devices/non-existent-id').set(headers);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});


