import { POST } from '../../app/api/audit/route';

// Mock the db module
jest.mock('@/db', () => ({
  db: {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([{ id: '550e8400-e29b-41d4-a716-446655440000' }])
      })
    })
  }
}));

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const validPayload = {
  entity_type: 'user',
  entity_id: 'user-123',
  action: 'create',
  actor_id: 'admin-456'
};

const createRequest = (body: any) => {
  return new Request('http://localhost/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
};

describe('/api/audit', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST with valid body returns 201 and a UUID', async () => {
    const request = createRequest(validPayload);
    const response = await POST(request);
    
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toMatch(UUID_V4_REGEX);
  });

  test('POST with missing entity_type returns 400', async () => {
    const { entity_type, ...payload } = validPayload;
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('POST with missing entity_id returns 400', async () => {
    const { entity_id, ...payload } = validPayload;
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('POST with missing action returns 400', async () => {
    const { action, ...payload } = validPayload;
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('POST with missing actor_id returns 400', async () => {
    const { actor_id, ...payload } = validPayload;
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('POST with empty string on required field returns 400', async () => {
    const payload = { ...validPayload, entity_type: '' };
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('POST with optional payload present returns 201', async () => {
    const payload = { ...validPayload, payload: { key: 'value' } };
    const request = createRequest(payload);
    const response = await POST(request);
    
    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.id).toMatch(UUID_V4_REGEX);
  });

  test('No GET export exists', async () => {
    const AuditRoute = await import('../../app/api/audit/route');
    expect(typeof AuditRoute.GET).toBe('undefined');
  });

  test('No DELETE export exists', async () => {
    const AuditRoute = await import('../../app/api/audit/route');
    expect(typeof AuditRoute.DELETE).toBe('undefined');
  });

  test('No PUT export exists', async () => {
    const AuditRoute = await import('../../app/api/audit/route');
    expect(typeof AuditRoute.PUT).toBe('undefined');
  });

  test('No PATCH export exists', async () => {
    const AuditRoute = await import('../../app/api/audit/route');
    expect(typeof AuditRoute.PATCH).toBe('undefined');
  });

  test('DB error returns 500 without stack trace', async () => {
    // Mock db to throw error
    const { db } = require('@/db');
    db.insert.mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockRejectedValue(new Error('Database error'))
      })
    });

    const request = createRequest(validPayload);
    const response = await POST(request);
    
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Internal server error');
    expect(data.stack).toBeUndefined();
  });
});