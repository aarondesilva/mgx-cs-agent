process.env.DB_PATH = ':memory:';
process.env.SUPPORT_EMAIL = 'support@microgenix.com';
process.env.ESCALATION_EMAIL = 'tigertiger@microgenix.net';
process.env.FULFILLMENT_EMAIL = 'fulfillment@microgenix.net';
process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake';
process.env.ANTHROPIC_API_KEY = 'fake';
process.env.WOOCOMMERCE_URL = 'http://fake.com';
process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_fake';
process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_fake';
process.env.GMAIL_CLIENT_ID = 'fake';
process.env.GMAIL_CLIENT_SECRET = 'fake';
process.env.GMAIL_REFRESH_TOKEN = 'fake';

jest.mock('../src/pipeline', () => ({
  processMessage: jest.fn().mockResolvedValue({ replied: true, escalated: false }),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: () => ({ select: () => ({ data: [], error: null }) }) })
}));
jest.mock('@woocommerce/woocommerce-rest-api', () => ({
  default: jest.fn(() => ({}))
}));

const { initDb } = require('../src/db');
initDb();

const request = require('supertest');
const app = require('../src/server');

describe('POST /webhook', () => {
  test('returns 200 with received status', async () => {
    const res = await request(app)
      .post('/webhook')
      .send({ customerEmail: 'test@test.com', customerName: 'Test', message: 'Hello' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('received');
  });

  test('returns 400 when customerEmail is missing', async () => {
    const res = await request(app)
      .post('/webhook')
      .send({ message: 'Hello' });

    expect(res.status).toBe(400);
  });

  test('returns 400 when message is missing', async () => {
    const res = await request(app)
      .post('/webhook')
      .send({ customerEmail: 'test@test.com' });

    expect(res.status).toBe(400);
  });

  test('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
