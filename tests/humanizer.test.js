const { HUMANIZER_INSTRUCTION } = require('../src/humanizer');

describe('HUMANIZER_INSTRUCTION', () => {
  test('is a non-empty string', () => {
    expect(typeof HUMANIZER_INSTRUCTION).toBe('string');
    expect(HUMANIZER_INSTRUCTION.length).toBeGreaterThan(100);
  });

  test('instructs to acknowledge feeling first', () => {
    expect(HUMANIZER_INSTRUCTION).toContain("acknowledge the customer's feeling");
  });

  test('bans corporate filler words', () => {
    expect(HUMANIZER_INSTRUCTION).toContain('certainly');
    expect(HUMANIZER_INSTRUCTION).toContain('absolutely');
    expect(HUMANIZER_INSTRUCTION).toContain('valued customer');
  });

  test('bans em dashes', () => {
    expect(HUMANIZER_INSTRUCTION).toContain('em dashes');
  });

  test('requires American English', () => {
    expect(HUMANIZER_INSTRUCTION).toContain('American English');
  });

  test('requires ending with a clear next step', () => {
    expect(HUMANIZER_INSTRUCTION).toContain('next step');
  });
});
