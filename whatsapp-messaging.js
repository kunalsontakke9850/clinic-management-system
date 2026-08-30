/*
 * WhatsApp messaging helpers.
 *
 * This module deliberately creates reviewable wa.me drafts only. It does not
 * automate WhatsApp or store a Cloud API token in the desktop app.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WhatsAppMessaging = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function normalizePhone(value) {
    var digits = String(value == null ? '' : value).replace(/\D/g, '');
    if (digits.indexOf('00') === 0) digits = digits.slice(2);
    if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
    if (digits.length === 12 && digits.indexOf('91') === 0 && /^[6-9]/.test(digits.slice(2, 3))) return digits;
    return null;
  }

  function optInStatus(value) {
    var status = String(value == null ? 'unknown' : value).trim().toLowerCase();
    return status === 'yes' || status === 'no' ? status : 'unknown';
  }

  function buildRecipients(records, options) {
    options = options || {};
    var requireOptIn = options.requireOptIn !== false;
    var byPhone = Object.create(null);
    var counts = { eligible: 0, missing: 0, unknown: 0, optedOut: 0 };
    (Array.isArray(records) ? records : []).forEach(function (record) {
      record = record || {};
      var phone = normalizePhone(record.phone);
      if (!phone) {
        counts.missing += 1;
        return;
      }
      var status = optInStatus(record.whatsappOptIn);
      var existing = byPhone[phone];
      // A positive consent wins when records for the same patient are merged.
      if (existing && existing.status === 'yes') return;
      byPhone[phone] = { phone: phone, name: String(record.name || 'Patient').trim() || 'Patient', status: status, source: record };
    });

    var eligible = [];
    Object.keys(byPhone).forEach(function (phone) {
      var recipient = byPhone[phone];
      if (!requireOptIn || recipient.status === 'yes') {
        eligible.push(recipient);
        return;
      }
      if (recipient.status === 'no') counts.optedOut += 1;
      else counts.unknown += 1;
    });
    counts.eligible = eligible.length;
    eligible.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return { eligible: eligible, counts: counts };
  }

  function renderMessage(template, values, signature) {
    var text = String(template == null ? '' : template).replace(/\{(name|clinic)\}/gi, function (_, key) {
      return String(values && values[key.toLowerCase()] != null ? values[key.toLowerCase()] : '');
    }).trim();
    var footer = String(signature == null ? '' : signature).trim();
    return footer ? (text ? text + '\n\n' + footer : footer) : text;
  }

  function buildDraftUrl(phone, message) {
    var normalized = normalizePhone(phone);
    if (!normalized) return '';
    return 'https://wa.me/' + normalized + '?text=' + encodeURIComponent(String(message == null ? '' : message));
  }

  return {
    normalizePhone: normalizePhone,
    buildRecipients: buildRecipients,
    renderMessage: renderMessage,
    buildDraftUrl: buildDraftUrl
  };
});
