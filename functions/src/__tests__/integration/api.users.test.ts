import request from 'supertest';
import { app } from '../../api/test';

describe('Users API (/v1/users.me*)', () => {
  const agent = request(app);
  const headers = { 'X-Test-Uid': 'u_integration_1' } as Record<string, string>;

  it('POST /v1/users.me.init creates or updates profile', async () => {
    const res = await agent
      .post('/v1/users.me.init')
      .set(headers)
      .send({ displayName: 'Alice', timezone: 'Europe/Moscow', language: 'ru-RU', consents: { marketing: false } });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.id).toBe('u_integration_1');
    expect(res.body.user.displayName).toBe('Alice');
  });

  it('GET /v1/users.me returns current profile', async () => {
    const res = await agent.get('/v1/users.me').set(headers);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.id).toBe('u_integration_1');
  });

  it('PATCH /v1/users.me updates profile fields', async () => {
    const res = await agent
      .patch('/v1/users.me')
      .set(headers)
      .send({ displayName: 'Alice Updated', avatarUrl: 'https://example.com/a.png' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('Alice Updated');
    expect(res.body.user.avatarUrl).toBe('https://example.com/a.png');
  });

  it('POST /v1/users.me/delete returns 202 with jobId', async () => {
    const res = await agent.post('/v1/users.me/delete').set(headers).send({});
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('jobId');
    expect(typeof res.body.jobId).toBe('string');
  });

  it('Validates unexpected fields (400 invalid_argument)', async () => {
    const res = await agent.post('/v1/users.me.init').set(headers).send({ unexpected: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_argument');
  });
});



