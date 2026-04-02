jest.mock('@woocommerce/woocommerce-rest-api', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        data: [
          {
            id: 1042,
            status: 'processing',
            billing: { email: 'jane@example.com', first_name: 'Jane' },
            shipping: { address_1: '123 Main St', city: 'Austin', state: 'TX', postcode: '78701' },
            line_items: [{ name: 'MGX Probiotic', quantity: 1, price: '29.99' }],
            meta_data: [{ key: '_wc_shipment_tracking_items', value: JSON.stringify([{ tracking_number: 'USPS123', tracking_provider: 'USPS' }]) }]
          }
        ]
      }),
      put: jest.fn().mockResolvedValue({ data: { id: 1042, status: 'completed' } }),
      post: jest.fn().mockResolvedValue({ data: { id: 55, code: 'MGX-ABC123', amount: '10' } })
    }))
  };
});

process.env.WOOCOMMERCE_URL = 'http://fake.com';
process.env.WOOCOMMERCE_CONSUMER_KEY = 'ck_fake';
process.env.WOOCOMMERCE_CONSUMER_SECRET = 'cs_fake';

const {
  toolDefinitions,
  handleToolCall,
} = require('../src/woocommerce');

describe('toolDefinitions', () => {
  test('exports 8 tool definitions', () => {
    expect(toolDefinitions).toHaveLength(8);
  });

  test('each tool has name, description, and input_schema', () => {
    for (const tool of toolDefinitions) {
      expect(tool).toHaveProperty('name');
      expect(tool).toHaveProperty('description');
      expect(tool).toHaveProperty('input_schema');
    }
  });

  const expectedTools = [
    'get_order_by_email',
    'get_order_by_id',
    'get_tracking_info',
    'update_order_status',
    'update_shipping_address',
    'resend_order_email',
    'add_order_note',
    'create_coupon_code',
  ];

  for (const name of expectedTools) {
    test(`includes tool: ${name}`, () => {
      expect(toolDefinitions.map(t => t.name)).toContain(name);
    });
  }
});

describe('handleToolCall', () => {
  test('get_order_by_email returns order list', async () => {
    const result = await handleToolCall('get_order_by_email', { email: 'jane@example.com' });
    expect(result).toContain('MGX Probiotic');
    expect(result).toContain('1042');
  });

  test('create_coupon_code returns code', async () => {
    const result = await handleToolCall('create_coupon_code', { amount: '10', expiryDays: 30 });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('unknown tool returns error string', async () => {
    const result = await handleToolCall('nonexistent_tool', {});
    expect(result).toContain('Unknown tool');
  });
});
