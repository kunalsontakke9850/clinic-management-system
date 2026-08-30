'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');

test('public configuration contains only safe defaults and permits an ignored local override', function () {
  const config = fs.readFileSync(path.join(projectRoot, 'config.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  assert.match(config, /GOOGLE_SHEETS_URL:\s*['"]{2}/, 'the public configuration must not include a live endpoint');
  assert.match(config, /APP_WRITE_KEY:\s*['"]{2}/, 'the public configuration must not include a live write key');
  assert.match(config, /doctorName:\s*['"]Clinic Doctor['"]/, 'the public configuration must use a non-client placeholder');
  assert.ok(html.indexOf('src="config.local.js"') > html.indexOf('src="config.js"'), 'an ignored local configuration must load after public defaults');
});

test('repository hygiene files protect generated and local-only content', function () {
  const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  ['node_modules/', 'dist/', 'config.local.js', 'Trial 2/', 'images/Header.png', 'images/QRCode.png', 'docs/superpowers/'].forEach(function (entry) {
    assert.match(gitignore, new RegExp('^' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), entry + ' must be ignored');
  });
});

test('Apps Script does not include a usable fallback write key', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'Apps-Script-Code.gs'), 'utf8');
  assert.match(script, /var DEFAULT_APP_WRITE_KEY\s*=\s*['"]{2}/, 'the write key must be supplied through Apps Script properties');
});

test('publishable source does not contain known client identifiers', function () {
  const clientName = String.fromCharCode(84, 117, 115, 104, 97, 114, 32, 82, 111, 116, 104, 101);
  const clinicName = String.fromCharCode(82, 97, 106, 97, 110, 97, 110, 100, 105, 110, 105);
  const phone = String.fromCharCode(57, 56, 55, 54, 53, 52, 51, 50, 49, 48);
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: projectRoot,
    encoding: 'utf8'
  }).trim().split(/\r?\n/).filter(Boolean);

  files.forEach(function (file) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.doesNotMatch(source, new RegExp(clientName, 'i'), file + ' must not disclose client identity');
    assert.doesNotMatch(source, new RegExp(clinicName, 'i'), file + ' must not disclose clinic identity');
    assert.doesNotMatch(source, new RegExp(phone), file + ' must not disclose a client phone number');
  });
});
