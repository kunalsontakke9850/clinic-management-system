'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const WhatsAppMessaging = require('../whatsapp-messaging.js');
const TEST_MOBILE = '9'.repeat(10);
const UNKNOWN_MOBILE = '8'.repeat(10);
const OPTED_OUT_MOBILE = '7'.repeat(10);
const TEST_WHATSAPP_MOBILE = '91' + TEST_MOBILE;

test('normalisePhone accepts Indian mobile formats and rejects unusable values', function () {
  assert.equal(WhatsAppMessaging.normalizePhone('+91 ' + TEST_MOBILE.slice(0, 5) + ' ' + TEST_MOBILE.slice(5)), TEST_WHATSAPP_MOBILE);
  assert.equal(WhatsAppMessaging.normalizePhone(TEST_MOBILE), TEST_WHATSAPP_MOBILE);
  assert.equal(WhatsAppMessaging.normalizePhone('0091-' + TEST_MOBILE), TEST_WHATSAPP_MOBILE);
  assert.equal(WhatsAppMessaging.normalizePhone('12345'), null);
});

test('buildRecipients keeps only opted-in valid numbers and deduplicates patients', function () {
  const result = WhatsAppMessaging.buildRecipients([
    { name: 'Patient A', phone: TEST_MOBILE, whatsappOptIn: 'yes' },
    { name: 'Patient A Duplicate', phone: '+91 ' + TEST_MOBILE.slice(0, 5) + ' ' + TEST_MOBILE.slice(5), whatsappOptIn: 'yes' },
    { name: 'Unknown', phone: UNKNOWN_MOBILE, whatsappOptIn: 'unknown' },
    { name: 'No Consent', phone: OPTED_OUT_MOBILE, whatsappOptIn: 'no' },
    { name: 'No Number', whatsappOptIn: 'yes' }
  ], { requireOptIn: true });

  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].phone, TEST_WHATSAPP_MOBILE);
  assert.deepEqual(result.counts, { eligible: 1, missing: 1, unknown: 1, optedOut: 1 });
});

test('renderMessage interpolates patient name and appends a clean signature', function () {
  assert.equal(
    WhatsAppMessaging.renderMessage('Hello {name},\nPlease visit {clinic}.', { name: 'Asha', clinic: 'Clinic Management System' }, 'Dr. Clinic'),
    'Hello Asha,\nPlease visit Clinic Management System.\n\nDr. Clinic'
  );
});

test('buildDraftUrl creates a reviewable WhatsApp draft without auto-sending', function () {
  const url = WhatsAppMessaging.buildDraftUrl(TEST_WHATSAPP_MOBILE, 'Hello Patient');
  assert.match(url, new RegExp('^https://wa\\.me/' + TEST_WHATSAPP_MOBILE + '\\?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), 'Hello Patient');
});
