'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const appsScript = fs.readFileSync(path.join(projectRoot, 'Apps-Script-Code.gs'), 'utf8');

test('Instructions appears below Work Done with matching chips and editable field', function () {
  const workIndex = html.indexOf('class="work-done-wrap"');
  const instructionIndex = html.indexOf('id="instructions"');
  assert.ok(workIndex >= 0, 'Work Done section must exist');
  assert.ok(instructionIndex > workIndex, 'Instructions must appear below Work Done');
  assert.match(html.slice(workIndex, instructionIndex + 2000), /id="piChipsInstructions"/);
  assert.match(html.slice(workIndex, instructionIndex + 2000), /<div class="section-label">Instructions<\/div>/);
  assert.match(html, /<textarea[^>]*id="instructions"[^>]*>/, 'Instructions must be an editable textarea');
});

test('Instructions uses suggestions, saves separately, resets, and prints', function () {
  assert.match(html, /instructions:\s*'clinic_sugg_instructions'/, 'Instructions needs saved suggestions');
  assert.match(html, /instructions:\s*\[/, 'Instructions needs starter suggestions');
  assert.match(html, /base:\s*'instructions'[^\n]*field:\s*'instructions'/, 'Instructions needs a quick-add field configuration');
  assert.match(html, /instructions:\s*cap\(v\('instructions'\)\)/, 'Instructions must be saved in patient records');
  assert.match(html, /'workDone','instructions','followupDate'/, 'Instructions must reset with a new visit');
  assert.match(html, /\{ id: 'instructions'/, 'Instructions must be handled by print cleanup');
  assert.match(html, /var instructions\s*=\s*String\(r\.instructions/, 'Previous prescriptions must read Instructions');
  assert.match(html, /instructions \? sec\('Instructions'/, 'Previous prescriptions must display Instructions');
  assert.match(appsScript, /'workDone','instructions'(?:,'visitId')?(?:,'paymentHistory')?\]/, 'Apps Script field contract must include Instructions');
});
