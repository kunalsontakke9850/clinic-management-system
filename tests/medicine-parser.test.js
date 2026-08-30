'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const MedicineParser = require('../prescription-medicines.js');

test('medicine parser keeps pipe-separated frequency out of duration', function () {
  const parsed = MedicineParser.parseSavedMedicineLine(
    'Augmentin 625 Mg | 6 | सकाळी जेवणानंतर | संध्याकाळी जेवणानंतर | 3 दिवस'
  );

  assert.deepEqual(parsed, {
    name: 'Augmentin 625 Mg',
    quantity: '6',
    frequency: 'सकाळी जेवणानंतर आणि संध्याकाळी जेवणानंतर',
    duration: '3 दिवस'
  });
});

test('medicine parser supports old records without a quantity field', function () {
  const parsed = MedicineParser.parseSavedMedicineLine(
    'Metronidazole 200mg | सकाळी जेवणानंतर | संध्याकाळी जेवणानंतर | 5 दिवस'
  );

  assert.deepEqual(parsed, {
    name: 'Metronidazole 200mg',
    quantity: '',
    frequency: 'सकाळी जेवणानंतर आणि संध्याकाळी जेवणानंतर',
    duration: '5 दिवस'
  });
});

test('frequency formatter replaces legacy pipes with Marathi and', function () {
  assert.equal(
    MedicineParser.formatFrequency('सकाळी | दुपारी | संध्याकाळी'),
    'सकाळी आणि दुपारी आणि संध्याकाळी'
  );
  assert.equal(MedicineParser.formatFrequency('रात्री'), 'रात्री');
});

test('medicine parser accepts numeric durations and legacy dash separators', function () {
  const parsed = MedicineParser.parseSavedMedicineLine('Zerodol-SP - रात्री - 3');

  assert.deepEqual(parsed, {
    name: 'Zerodol-SP',
    quantity: '',
    frequency: 'रात्री',
    duration: '3'
  });
});
