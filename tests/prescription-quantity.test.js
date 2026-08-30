'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('medicine rows include an editable quantity defaulting to 6 between name and frequency', function () {
  const header = html.match(/<th>Medicine Name<\/th>[\s\S]*?<th style="width:210px">Frequency<\/th>/);
  assert.ok(header, 'Quantity header must sit between Medicine Name and Frequency');
  assert.match(header[0], /<th[^>]*>Quantity<\/th>/, 'Quantity column header must exist');

  const row = html.match(/<td><input class="med-input"[^>]*list="medList"[\s\S]*?<td class="med-freq">/);
  assert.ok(row, 'Medicine row must contain the quantity control before frequency');
  assert.match(row[0], /class="med-input qty-input"[^>]*type="number"[^>]*value="6"/, 'Quantity must be editable and default to 6');
  assert.match(html, /<th style="width:84px;text-align:center;white-space:nowrap">Quantity<\/th>/, 'Quantity header must have enough non-overlapping width');
});

test('medicine frequency choices use pipes without confusing duration parsing', function () {
  const select = html.match(/<select class="med-freq-sel">[\s\S]*?<\/select>/);
  assert.ok(select, 'Medicine frequency choices must exist');
  assert.match(select[0], /सकाळी \| दुपारी \| संध्याकाळी/);
  assert.match(select[0], /सकाळी \| दुपारी \| संध्याकाळी-जेवणानंतर/);
  assert.doesNotMatch(select[0], /सकाळी आणि दुपारी आणि संध्याकाळी/, 'Frequency choices should use pipes instead of Marathi and');
});

test('saved and printed medicine records include quantity while supporting old records', function () {
  assert.match(html, /const qty\s*=\s*tr\.querySelector\('\.qty-input'\)/, 'Save flow must read quantity');
  assert.match(html, /meds\.push\(\[mName, qty, freq, dur\]\.join\(' \\| '\)\)/, 'Save flow must persist quantity');
  assert.match(html, /medRows\.push\(\{ name, qty, freq, dur \}\)/, 'Print flow must read quantity');
  assert.match(html, /var parsed = window\.PrescriptionMedicine\.parseSavedMedicineLine\(line\)/, 'Past prescription display must parse saved medicine lines safely');
  assert.match(html, /var mQty = parsed\.quantity \|\| '6'/, 'Old records without quantity must display the default quantity');
  assert.match(html, /var row = window\.PrescriptionMedicine\.parseSavedMedicineLine\(line\)/, 'Edit flow must parse saved medicine lines safely');
});

test('initial medicine rows include the requested sixth gargling frequency row', function () {
  const initialRows = html.match(/function addInitialMedRows\(\) \{[\s\S]*?\n  \}/);
  assert.ok(initialRows, 'Initial medicine row builder must exist');
  assert.match(initialRows[0], /for \(var i = 0; i < 4; i\+\+\) addMedRow\('सकाळी जेवणानंतर आणि संध्याकाळी जेवणानंतर'\);/, 'The first four rows must use the requested frequency');
  assert.match(initialRows[0], /addMedRow\('जेवणापूर्वी सकाळी आणि जेवणापूर्वी संध्याकाळी'\)/, 'The fifth row must use the requested frequency');
  assert.match(initialRows[0], /addMedRow\('सकाळी आणि संध्याकाळी गुळण्या करणे'\)/, 'The sixth row must use the attached frequency');
});
