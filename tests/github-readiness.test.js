'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = path.join(__dirname, '..');

function listSourceFiles(root) {
  try {
    return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8'
    }).trim().split(/\r?\n/).filter(Boolean);
  } catch (error) {
    const files = [];
    const ignoredDirectories = new Set(['.git', 'node_modules']);

    function visit(directory, relativeDirectory) {
      fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
        const relativePath = path.join(relativeDirectory, entry.name);
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!ignoredDirectories.has(entry.name)) visit(absolutePath, relativePath);
        } else if (entry.isFile()) {
          files.push(relativePath);
        }
      });
    }

    visit(root, '');
    return files;
  }
}

test('public configuration contains only safe defaults and permits an ignored local override', function () {
  const config = fs.readFileSync(path.join(projectRoot, 'config.js'), 'utf8');
  const localExample = fs.readFileSync(path.join(projectRoot, 'config.local.example.js'), 'utf8');
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  assert.match(config, /GOOGLE_SHEETS_URL:\s*['"]{2}/, 'the public configuration must not include a live endpoint');
  assert.match(config, /APP_WRITE_KEY:\s*['"]{2}/, 'the public configuration must not include a live write key');
  assert.match(config, /doctorName:\s*['"]Clinic Doctor['"]/, 'the public configuration must use a non-client placeholder');
  assert.ok(html.indexOf('src="config.local.js"') > html.indexOf('src="config.js"'), 'an ignored local configuration must load after public defaults');
  assert.match(localExample, /example\.invalid/, 'the local configuration example must use a clearly non-live endpoint');
  assert.doesNotMatch(localExample, /script\.google\.com\/macros\/s\//, 'the local configuration example must not resemble a production Apps Script URL');
});

test('default test command runs every maintained node:test file', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test tests/*.test.js');
});

test('portfolio documentation is complete and does not overclaim', function () {
  const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');
  ['Impact', 'Problem', 'Key Features', 'Tech Stack', 'Architecture', 'Automated Testing', 'Continuous Integration', 'Docker', 'Demo', 'Build', 'Privacy & Security', 'Screenshots', 'Future Improvements'].forEach(function (heading) {
    assert.match(readme, new RegExp('^## .*' + heading.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'm'), heading + ' section is required');
  });
  assert.match(readme, /actions\/workflows\/ci\.yml/, 'README must link to the CI workflow');
  assert.match(readme, /\?demo=1/, 'README must document the opt-in demo mode');
  assert.match(readme, /npm run dist/, 'README must document the Windows build command');
  assert.doesNotMatch(readme, /Dockerize the application/i, 'completed Docker work must not be listed as a future improvement');
});

test('repository hygiene files protect generated and local-only content', function () {
  const gitignore = fs.readFileSync(path.join(projectRoot, '.gitignore'), 'utf8');
  ['node_modules/', 'dist/', 'config.local.js', 'Trial 2/', 'images/Header.png', 'images/QRCode.png', 'docs/superpowers/'].forEach(function (entry) {
    assert.match(gitignore, new RegExp('^' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), entry + ' must be ignored');
  });
});

test('repository allowlist includes the desktop workspace source', function () {
  const result = require('node:child_process').spawnSync('git', ['check-ignore', '-q', 'desktop-workspace.js'], {
    cwd: projectRoot
  });

  assert.notEqual(result.status, 0, 'desktop-workspace.js must be publishable source, not ignored');
});

test('Apps Script does not include a usable fallback write key', function () {
  const script = fs.readFileSync(path.join(projectRoot, 'Apps-Script-Code.gs'), 'utf8');
  assert.match(script, /var DEFAULT_APP_WRITE_KEY\s*=\s*['"]{2}/, 'the write key must be supplied through Apps Script properties');
});

test('publishable source does not contain known client identifiers', function () {
  const clientName = String.fromCharCode(84, 117, 115, 104, 97, 114, 32, 82, 111, 116, 104, 101);
  const clinicName = String.fromCharCode(82, 97, 106, 97, 110, 97, 110, 100, 105, 110, 105);
  const phone = String.fromCharCode(57, 56, 55, 54, 53, 52, 51, 50, 49, 48);
  const files = listSourceFiles(projectRoot);

  files.forEach(function (file) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    assert.doesNotMatch(source, new RegExp(clientName, 'i'), file + ' must not disclose client identity');
    assert.doesNotMatch(source, new RegExp(clinicName, 'i'), file + ' must not disclose clinic identity');
    assert.doesNotMatch(source, new RegExp(phone), file + ' must not disclose a client phone number');
  });
});
