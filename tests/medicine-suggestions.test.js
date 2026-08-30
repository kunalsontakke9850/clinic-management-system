'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('suggested medicines fill the first row with an empty name instead of adding a new row', function () {
  const addSuggestion = html.match(/function piAddMed\(n, f, d\) \{[\s\S]*?function piRenderTextChips/);
  assert.ok(addSuggestion, 'Suggested medicine handler must exist');
  assert.match(addSuggestion[0], /return ni && !ni\.value\.trim\(\)/, 'A row is available when its medicine name is blank');
  assert.doesNotMatch(addSuggestion[0], /!fs\.value.*!di\.value/, 'Default frequency and duration must not make a blank name unavailable');
  assert.match(addSuggestion[0], /if \(di && d\) di\.value = d/, 'A suggestion must update duration only when it provides one');
});

test('suggestion history reads frequency and duration from quantity-aware medicine records', function () {
  assert.match(html, /function piParseMedicineLine\(line\)/, 'Medicine history needs a dedicated parser');
  assert.match(html, /quantityToken\s*=\s*p\[0\]/, 'Parser must detect quantity-aware records by their numeric quantity token');
  assert.match(html, /frequencyParts\s*=\s*p\.slice\(/, 'Parser must rebuild frequency parts from the saved tokens');
  assert.match(html, /return \{ name: name, quantity: quantity, frequency: frequency, duration: duration \}/, 'Parser must return normalized medicine fields');
});

test('suggestion history does not mistake a pipe-separated frequency or medicine name for duration', function () {
  assert.match(html, /function piParseMedicineLine\(line\)/, 'Medicine history needs a dedicated parser');
  assert.match(html, /p\[p\.length\s*-\s*1\]/, 'Duration must come from the final saved token');
  assert.match(html, /isDurationValue\(durationToken\)/, 'Only a valid duration token may populate duration');
  assert.match(html, /frequencyParts\s*=\s*p\.slice\(/, 'Frequency parts must be rebuilt without contaminating duration');
});
