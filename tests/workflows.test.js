'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('CI workflow uses current actions and the complete Node 20 test contract', function () {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /node-version:\s*["']?20/);
  assert.match(workflow, /cache:\s*["']?npm/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /timeout-minutes:\s*10/);
});

test('release workflow verifies and uploads an unsigned Windows build artifact', function () {
  const workflowPath = path.join(root, '.github', 'workflows', 'release.yml');
  assert.ok(fs.existsSync(workflowPath), 'release workflow must exist');
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tags:\s*\n\s*- ['"]?v\*/);
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /node-version:\s*["']?20/);
  assert.match(workflow, /npm ci\b/);
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run dist/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /path:\s*dist\//);
  assert.match(workflow, /name:\s*clinic-management-system-windows/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /secrets\./);
});
