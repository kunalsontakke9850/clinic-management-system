'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAdmin(fetchImpl, user) {
  const container = { id: 'admin-modal-container', innerHTML: '' };
  let currentUser = user || { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
  const document = {
    getElementById(id) { return id === 'admin-modal-container' ? container : null; },
    createElement() { return container; },
    body: { appendChild() {} }
  };
  const context = {
    document,
    CONFIG: { GOOGLE_SHEETS_URL: 'https://script.google.com/macros/s/test/exec', APP_VERSION: '3.6.1' },
    FinanceCore: { genOperationId() { return 'OP-ADMIN-TEST'; } },
    FinanceStore: {
      getCurrentUser() { return currentUser; },
      setCurrentUser(next) { currentUser = next; }
    },
    fetch: fetchImpl,
    prompt() { return '2468'; },
    alert() {},
    console,
    Date,
    JSON,
    encodeURIComponent
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'admin.js' });
  return { tools: context.AdminTools, container, getUser() { return currentUser; } };
}

test('admin PIN is verified by the server and the returned session is stored', async function () {
  const requests = [];
  const loaded = loadAdmin(async function (url, options) {
    requests.push({ url, options });
    return { ok: true, json: async function () {
      return { ok: true, sessionToken: 'SESSION-TOKEN', userId: 'doctor', role: 'admin', name: 'Doctor' };
    } };
  });

  const ok = await loaded.tools.ensureAdminSession();

  assert.equal(ok, true);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.action, 'adminLogin');
  assert.equal(body.payload.pin, '2468');
  assert.equal(loaded.getUser().sessionToken, 'SESSION-TOKEN');
});

test('audit log uses the protected GET endpoint and top-level audit response', async function () {
  const requests = [];
  const loaded = loadAdmin(async function (url, options) {
    requests.push({ url, options: options || {} });
    return { ok: true, json: async function () {
      return { ok: true, audit: [{
        timestamp: '2026-08-21T10:00:00+05:30', userId: 'doctor', entityType: 'Bill',
        entityId: 'BIL-1', action: 'POST', afterJson: '{"status":"POSTED"}'
      }] };
    } };
  }, { userId: 'doctor', role: 'admin', name: 'Doctor', sessionToken: 'SESSION-TOKEN' });

  await loaded.tools.openAudit();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].url, /action=audit/);
  assert.match(requests[0].url, /sessionToken=SESSION-TOKEN/);
  assert.match(loaded.container.innerHTML, /BIL-1/);
});
