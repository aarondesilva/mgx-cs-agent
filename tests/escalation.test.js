const mockSendMail = jest.fn().mockResolvedValue({ messageId: 'fake-id' });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail })),
}));

process.env.SUPPORT_EMAIL = 'support@microgenix.com';
process.env.ESCALATION_EMAIL = 'tigertiger@microgenix.net';
process.env.FULFILLMENT_EMAIL = 'fulfillment@microgenix.net';
process.env.GMAIL_CLIENT_ID = 'fake-id';
process.env.GMAIL_CLIENT_SECRET = 'fake-secret';
process.env.GMAIL_REFRESH_TOKEN = 'fake-token';

const { shouldEscalate, sendEscalationEmail } = require('../src/escalation');

describe('shouldEscalate', () => {
  test('returns false when no triggers fire', () => {
    const classification = { escalateCustomer: false, escalateFulfillment: false, confidence: 0.9 };
    const result = shouldEscalate(classification);
    expect(result.customer).toBe(false);
    expect(result.fulfillment).toBe(false);
  });

  test('returns customer=true when escalateCustomer is true', () => {
    const classification = { escalateCustomer: true, escalateFulfillment: false, escalateReason: 'upset customer' };
    const result = shouldEscalate(classification);
    expect(result.customer).toBe(true);
    expect(result.customerReason).toBe('upset customer');
  });

  test('returns fulfillment=true when escalateFulfillment is true', () => {
    const classification = { escalateCustomer: false, escalateFulfillment: true, escalateReason: 'lost package' };
    const result = shouldEscalate(classification);
    expect(result.fulfillment).toBe(true);
  });

  test('both can be true simultaneously', () => {
    const classification = { escalateCustomer: true, escalateFulfillment: true, escalateReason: 'angry + lost package' };
    const result = shouldEscalate(classification);
    expect(result.customer).toBe(true);
    expect(result.fulfillment).toBe(true);
  });
});

describe('sendEscalationEmail', () => {
  beforeEach(() => mockSendMail.mockClear());

  test('sends to ESCALATION_EMAIL for customer escalation', async () => {
    await sendEscalationEmail({
      to: process.env.ESCALATION_EMAIL,
      customerEmail: 'jane@test.com',
      thread: [{ role: 'customer', content: 'I am so frustrated.' }],
      reason: 'Customer upset',
      orderId: null,
    });

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const call = mockSendMail.mock.calls[0][0];
    expect(call.to).toBe('tigertiger@microgenix.net');
    expect(call.subject).toContain('jane@test.com');
    expect(call.text).toContain('Customer upset');
  });
});
