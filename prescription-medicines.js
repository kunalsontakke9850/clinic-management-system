(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PrescriptionMedicine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNumeric(value) {
    return /^\d+(?:\.\d+)?$/.test(String(value || '').trim());
  }

  function isDurationValue(value) {
    return /^\s*\d+(?:\.\d+)?\s*(?:(?:दिवस)|days?|weeks?|months?)?\s*$/i.test(String(value || ''));
  }

  function splitSavedFields(line) {
    var raw = String(line == null ? '' : line).trim();
    if (!raw) return [];
    var separator = raw.indexOf('|') !== -1 ? '|' : ' - ';
    return raw.split(separator).map(function (part) { return part.trim(); });
  }

  function formatFrequency(value) {
    return String(value == null ? '' : value)
      .split('|')
      .map(function (part) { return part.trim(); })
      .filter(Boolean)
      .join(' आणि ');
  }

  function parseSavedMedicineLine(line) {
    var fields = splitSavedFields(line);
    var name = fields.shift() || '';
    if (!name) return null;

    var duration = '';
    if (fields.length && isDurationValue(fields[fields.length - 1])) duration = fields.pop();

    var quantity = '';
    if (fields.length && isNumeric(fields[0])) quantity = fields.shift();

    return {
      name: name,
      quantity: quantity,
      frequency: formatFrequency(fields.join(' | ')),
      duration: duration
    };
  }

  return {
    isDurationValue: isDurationValue,
    formatFrequency: formatFrequency,
    parseSavedMedicineLine: parseSavedMedicineLine
  };
}));
