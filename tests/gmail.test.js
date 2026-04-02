const mockList = jest.fn();
const mockGet = jest.fn();
const mockSend = jest.fn();
const mockGetThread = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    gmail: jest.fn(() => ({
      users: {
        messages: {
          list: mockList,
          get: mockGet,
          send: mockSend,
        },
        threads: {
          get: mockGetThread,
        },
      },
    })),
  },
}));

process.env.GMAIL_CLIENT_ID = 'fake';
process.env.GMAIL_CLIENT_SECRET = 'fake';
process.env.GMAIL_REFRESH_TOKEN = 'fake';
process.env.SUPPORT_EMAIL = 'support@microgenix.com';

const { parseInboundMessages, sendReply } = require('../src/gmail');

describe('parseInboundMessages', () => {
  test('returns empty array when no messages', async () => {
    mockList.mockResolvedValue({ data: { messages: [] } });
    const result = await parseInboundMessages();
    expect(result).toEqual([]);
  });

  test('returns empty array when messages is undefined', async () => {
    mockList.mockResolvedValue({ data: {} });
    const result = await parseInboundMessages();
    expect(result).toEqual([]);
  });
});

describe('sendReply', () => {
  test('calls gmail.users.messages.send', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg_123' } });
    await sendReply('thread_abc', 'customer@test.com', 'Hello!');
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.userId).toBe('me');
    expect(call.requestBody.threadId).toBe('thread_abc');
  });
});
