jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        data: [{ name: 'MGX Probiotic', description: 'Daily probiotic blend' }],
        error: null
      })
    })
  })
}));

process.env.SUPABASE_URL = 'http://fake';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-key';

const { assembleContext } = require('../src/knowledge');

describe('assembleContext', () => {
  test('returns an object with systemPrompt, knowledgeBase, and products', async () => {
    const ctx = await assembleContext('test@example.com');
    expect(ctx).toHaveProperty('systemPrompt');
    expect(ctx).toHaveProperty('knowledgeBase');
    expect(ctx).toHaveProperty('products');
    expect(typeof ctx.systemPrompt).toBe('string');
    expect(typeof ctx.knowledgeBase).toBe('string');
    expect(Array.isArray(ctx.products)).toBe(true);
  });

  test('systemPrompt contains humanizer instruction', () => {
    return assembleContext('test@example.com').then(ctx => {
      expect(ctx.systemPrompt).toContain('acknowledge the customer');
    });
  });

  test('systemPrompt includes MGX role definition', () => {
    return assembleContext('test@example.com').then(ctx => {
      expect(ctx.systemPrompt).toContain('Microgenix');
    });
  });
});
