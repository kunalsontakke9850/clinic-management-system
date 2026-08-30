'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('Docker test image installs from the lockfile and verifies the application', function () {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');

  assert.match(dockerfile, /^FROM node:20-[\w-]+/m, 'Docker must use the supported Node 20 image');
  assert.match(dockerfile, /COPY package\.json package-lock\.json \.\//, 'Docker must copy the dependency manifests before source files');
  assert.match(dockerfile, /RUN npm ci --ignore-scripts/, 'Docker must install exact locked dependencies without install hooks');
  assert.match(dockerfile, /RUN npm test/, 'Docker build must run the existing automated test suite');
  assert.match(dockerfile, /CMD \["npm", "test"\]/, 'Docker run must execute the test suite by default');
});

test('Docker build context excludes live clinic configuration and generated artifacts', function () {
  const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');

  ['.git/', 'node_modules/', 'dist/', 'config.local.js', '.env', 'Trial 2/', '.playwright-cli/', 'images/Header.png', 'images/QRCode.png'].forEach(function (entry) {
    assert.match(dockerignore, new RegExp('^' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), entry + ' must stay outside the Docker build context');
  });
});

test('Docker build context retains the safe sources required by the test suite', function () {
  const dockerignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8');

  assert.ok(fs.existsSync(path.join(root, 'desktop-workspace.js')), 'the desktop workspace source must be present');
  ['!.gitignore', '!desktop-workspace.js', '!.github/workflows/*.yml', '!config.local.example.js', '!receptionist.js'].forEach(function (entry) {
    assert.match(dockerignore, new RegExp('^' + entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'm'), entry + ' must be included in the Docker build context');
  });
});

test('Docker instructions accurately describe the non-GUI test container', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

  assert.match(pkg.scripts.test, /tests\/(?:\*\.test\.js|docker\.test\.js)/, 'the default test command must include the Docker contract');
  assert.match(readme, /## Docker Test Environment/, 'README must document the Docker setup');
  assert.match(readme, /does not run the Electron GUI/i, 'README must set the correct Docker runtime expectation');
});
