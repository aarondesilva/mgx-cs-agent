'use strict';

jest.mock('@anthropic-ai/sdk', () => ({
  default: jest.fn(() => ({
    messages: { create: jest.fn() },
  })),
}));

const { isCustomerSender, decodeMimeWord, decodeBody, stripHtml, parseMbox } = require('../scripts/seed-kb');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('isCustomerSender', () => {
  test('returns true for gmail customer', () => {
    expect(isCustomerSender('Customer Name <customer@gmail.com>')).toBe(true);
  });

  test('returns false for microgenix.net', () => {
    expect(isCustomerSender('Willow <hello@microgenix.net>')).toBe(false);
  });

  test('returns false for facebookmail.com', () => {
    expect(isCustomerSender('notification@facebookmail.com')).toBe(false);
  });

  test('returns false for linkedin.com', () => {
    expect(isCustomerSender('messages-noreply@linkedin.com')).toBe(false);
  });
});

describe('decodeMimeWord', () => {
  test('decodes UTF-8 quoted-printable encoded subject', () => {
    const encoded = '=?UTF-8?Q?Re=3A_Order_Confirmation?=';
    expect(decodeMimeWord(encoded)).toBe('Re: Order Confirmation');
  });

  test('passes through plain strings unchanged', () => {
    expect(decodeMimeWord('Hello World')).toBe('Hello World');
  });
});

describe('decodeBody', () => {
  test('decodes quoted-printable soft line breaks', () => {
    const qp = 'Hello=\nWorld';
    expect(decodeBody(qp, 'quoted-printable')).toBe('HelloWorld');
  });

  test('decodes quoted-printable hex sequences', () => {
    const qp = 'caf=C3=A9';
    expect(decodeBody(qp, 'quoted-printable')).toContain('café');
  });

  test('decodes base64', () => {
    const b64 = Buffer.from('Hello from customer').toString('base64');
    expect(decodeBody(b64, 'base64')).toBe('Hello from customer');
  });

  test('returns payload unchanged for unknown encoding', () => {
    expect(decodeBody('plain text', '')).toBe('plain text');
  });
});

describe('stripHtml', () => {
  test('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  test('removes script tags and content', () => {
    expect(stripHtml('<script>alert(1)</script>text')).toBe('text');
  });

  test('decodes common HTML entities', () => {
    expect(stripHtml('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });
});

describe('parseMbox', () => {
  test('extracts customer thread from valid mbox', () => {
    const mbox = [
      'From customer@gmail.com Mon Jan 01 00:00:00 2024',
      'From: Customer <customer@gmail.com>',
      'Subject: Order question',
      'Content-Transfer-Encoding: 7bit',
      '',
      'Hi, when will my order ship?',
      '',
    ].join('\n');

    const tmpFile = path.join(os.tmpdir(), 'test.mbox');
    fs.writeFileSync(tmpFile, mbox);

    const threads = parseMbox(tmpFile);
    expect(threads.length).toBe(1);
    expect(threads[0].subject).toBe('Order question');
    expect(threads[0].messages[0].body).toContain('when will my order ship');

    fs.unlinkSync(tmpFile);
  });

  test('filters out non-customer senders', () => {
    const mbox = [
      'From notification@facebookmail.com Mon Jan 01 00:00:00 2024',
      'From: Facebook <notification@facebookmail.com>',
      'Subject: You have a notification',
      '',
      'Click here',
      '',
    ].join('\n');

    const tmpFile = path.join(os.tmpdir(), 'test-filter.mbox');
    fs.writeFileSync(tmpFile, mbox);

    const threads = parseMbox(tmpFile);
    expect(threads.length).toBe(0);

    fs.unlinkSync(tmpFile);
  });

  test('groups multiple messages from same sender under same subject', () => {
    const mbox = [
      'From a@gmail.com Mon Jan 01 00:00:00 2024',
      'From: A <a@gmail.com>',
      'Subject: Re: My Order',
      '',
      'First message',
      '',
      'From a@gmail.com Mon Jan 02 00:00:00 2024',
      'From: A <a@gmail.com>',
      'Subject: Re: My Order',
      '',
      'Second message',
      '',
    ].join('\n');

    const tmpFile = path.join(os.tmpdir(), 'test-group.mbox');
    fs.writeFileSync(tmpFile, mbox);

    const threads = parseMbox(tmpFile);
    expect(threads.length).toBe(1);
    expect(threads[0].messages.length).toBe(2);

    fs.unlinkSync(tmpFile);
  });
});
