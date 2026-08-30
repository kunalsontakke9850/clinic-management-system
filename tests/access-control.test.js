'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* -------------------------------------------------------
   Helpers to load admin.js and access-control.js in a VM
------------------------------------------------------- */
function buildStore(overrides) {
  let currentUser = overrides && overrides.user
    ? overrides.user
    : { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
  return {
    getCurrentUser() { return currentUser; },
    setCurrentUser(u) { currentUser = u; },
    clearCurrentUser() {
      currentUser = { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
      return currentUser;
    }
  };
}

function loadAdmin(fetchImpl, userOrStore) {
  const container = { id: 'admin-modal-container', innerHTML: '' };
  const store = (userOrStore && userOrStore.getCurrentUser)
    ? userOrStore
    : buildStore({ user: userOrStore });
  const context = {
    document: {
      getElementById(id) { return id === 'admin-modal-container' ? container : null; },
      createElement() { return { textContent: '', appendChild() {} }; },
      body: { appendChild() {} }
    },
    CONFIG: { GOOGLE_SHEETS_URL: 'https://script.google.com/macros/s/test/exec', APP_VERSION: '3.6.1' },
    FinanceCore: { genOperationId() { return 'OP-TEST'; } },
    FinanceStore: store,
    fetch: fetchImpl || (async () => ({ ok: true, json: async () => ({ ok: true }) })),
    prompt() { return '2468'; },
    alert() {},
    confirm() { return true; },
    console,
    Date,
    JSON,
    encodeURIComponent,
    Object
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'admin.js' });
  return { tools: context.AdminTools, store: context.FinanceStore };
}

function loadAccessControl(adminTools, store, switchViewImpl) {
  // Minimal fake DOM for access-control.js
  const elements = {};
  const hiddenSet = new Set();
  function makeEl(id) {
    const el = {
      id,
      textContent: '',
      hidden: hiddenSet.has(id),
      style: { display: '' },
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el['_attr_' + k] = v; },
      getAttribute(k) { return el['_attr_' + k]; },
      addEventListener(ev, fn) { el['_on_' + ev] = fn; },
      focus() {},
      querySelector(sel) { return null; },
      querySelectorAll() { return []; }
    };
    elements[id] = el;
    return el;
  }
  // Pre-build the required modal elements
  const requiredIds = [
    'currentRoleBadge', 'doctorLoginBtn', 'doctorLogoutBtn', 'doctorActionToolbar',
    'doctorLoginModal', 'doctorLoginTitle', 'doctorLoginDescription',
    'doctorPinInput', 'doctorLoginForm', 'doctorLoginSubmit', 'doctorLoginCancel',
    'doctorLoginClose', 'doctorLoginStatus'
  ];
  requiredIds.forEach(makeEl);

  const doctorOnlyEls = [];
  let calledSwitchView = null;
  const context = {
    document: {
      getElementById(id) { return elements[id] || makeEl(id); },
      querySelectorAll(sel) {
        if (sel === '.doctor-only') return doctorOnlyEls;
        return [];
      },
      addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') fn(); }
    },
    FinanceStore: store || buildStore(),
    AdminTools: adminTools,
    switchView(view, opts) {
      calledSwitchView = { view, opts };
      return true;
    },
    console,
    Date,
    Object
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'access-control.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'access-control.js' });
  return {
    ac: context.AccessControl,
    elements,
    getCalledSwitchView() { return calledSwitchView; },
    store: context.FinanceStore
  };
}

/* -------------------------------------------------------
   ADMIN.JS ADDITIONAL TESTS
------------------------------------------------------- */
test('loginWithPin sends adminLogin and stores session', async function () {
  const requests = [];
  const { tools, store } = loadAdmin(async function (url, options) {
    requests.push({ url, options });
    return {
      ok: true,
      json: async () => ({
        ok: true, sessionToken: 'TOK-999', userId: 'doctor', role: 'admin',
        name: 'Dr. Test', expiresInSeconds: 21600
      })
    };
  });

  const user = await tools.loginWithPin('2468');
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.action, 'adminLogin');
  assert.equal(body.payload.pin, '2468');
  assert.equal(user.sessionToken, 'TOK-999');
  assert.equal(user.role, 'admin');
  assert.ok(user.sessionExpiresAt > Date.now(), 'sessionExpiresAt should be in the future');
  assert.equal(store.getCurrentUser().sessionToken, 'TOK-999');
});

test('loginWithPin rejects blank PIN without calling fetch', async function () {
  let fetchCalled = false;
  const { tools } = loadAdmin(async () => { fetchCalled = true; return { ok: true, json: async () => ({ ok: true }) }; });
  await assert.rejects(() => tools.loginWithPin('  '), /PIN is required/);
  assert.equal(fetchCalled, false);
});

test('loginWithPin with invalid PIN from server does not elevate user', async function () {
  const { tools, store } = loadAdmin(async () => ({
    ok: true,
    json: async () => ({ ok: false, message: 'Invalid admin PIN' })
  }));
  await assert.rejects(() => tools.loginWithPin('0000'), /Invalid admin PIN/);
  const user = store.getCurrentUser();
  assert.equal(user.role, 'receptionist');
  assert.equal(user.sessionToken, undefined);
});

test('hasValidAdminSession returns false for receptionist', function () {
  const { tools } = loadAdmin();
  const receptionist = { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
  assert.equal(tools.hasValidAdminSession(receptionist, Date.now()), false);
});

test('hasValidAdminSession returns false when token missing', function () {
  const { tools } = loadAdmin();
  assert.equal(tools.hasValidAdminSession({ role: 'admin' }, Date.now()), false);
});

test('hasValidAdminSession returns false for expired session', function () {
  const { tools } = loadAdmin();
  const expired = { role: 'admin', sessionToken: 'T', sessionExpiresAt: Date.now() - 1000 };
  assert.equal(tools.hasValidAdminSession(expired, Date.now()), false);
});

test('hasValidAdminSession returns true for valid unexpired doctor session', function () {
  const { tools } = loadAdmin();
  const valid = { role: 'doctor', sessionToken: 'T', sessionExpiresAt: Date.now() + 3600000 };
  assert.equal(tools.hasValidAdminSession(valid, Date.now()), true);
});

test('logout restores exactly the receptionist identity', async function () {
  const { tools, store } = loadAdmin(async () => ({
    ok: true, json: async () => ({ ok: true, sessionToken: 'TOK', userId: 'doctor', role: 'admin', name: 'Doc' })
  }));
  await tools.loginWithPin('2468');
  assert.equal(store.getCurrentUser().role, 'admin');
  const restored = tools.logout();
  assert.deepEqual(restored, { userId: 'receptionist', role: 'receptionist', name: 'Staff' });
  assert.equal(store.getCurrentUser().role, 'receptionist');
  assert.equal(store.getCurrentUser().sessionToken, undefined);
});

/* -------------------------------------------------------
   ACCESS-CONTROL.JS TESTS
------------------------------------------------------- */
describe('access-control.js', function () {
  function makeValidDoctor(nowMs) {
    return {
      userId: 'doctor', role: 'admin', name: 'Doc',
      sessionToken: 'T', sessionExpiresAt: (nowMs || Date.now()) + 3600000
    };
  }

  test('hasDoctorAccess returns false for receptionist', function () {
    const { tools, store } = loadAdmin();
    const { ac } = loadAccessControl(tools, store);
    const receptionist = { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
    assert.equal(ac.hasDoctorAccess(receptionist, Date.now()), false);
  });

  test('hasDoctorAccess returns true for valid doctor session', function () {
    const { tools, store } = loadAdmin();
    const { ac } = loadAccessControl(tools, store);
    assert.equal(ac.hasDoctorAccess(makeValidDoctor(), Date.now()), true);
  });

  test('hasDoctorAccess returns false for expired session', function () {
    const { tools, store } = loadAdmin();
    const { ac } = loadAccessControl(tools, store);
    const expired = { role: 'doctor', sessionToken: 'T', sessionExpiresAt: Date.now() - 1 };
    assert.equal(ac.hasDoctorAccess(expired, Date.now()), false);
  });

  test('canOpenView returns true for public views', function () {
    const { tools, store } = loadAdmin();
    const { ac } = loadAccessControl(tools, store);
    assert.equal(ac.canOpenView('reception'), true);
    assert.equal(ac.canOpenView('expenses'), true);
  });

  test('canOpenView returns false for protected views when not logged in', function () {
    const { tools, store } = loadAdmin();
    const { ac } = loadAccessControl(tools, store);
    assert.equal(ac.canOpenView('finance'), false);
    assert.equal(ac.canOpenView('prescription'), false);
    assert.equal(ac.canOpenView('report'), false);
  });

  test('canOpenView returns true for protected views when logged in as doctor', async function () {
    const { tools, store } = loadAdmin(async () => ({
      ok: true, json: async () => ({ ok: true, sessionToken: 'T', userId: 'doctor', role: 'admin', name: 'Doc', expiresInSeconds: 3600 })
    }));
    await tools.loginWithPin('2468');
    const { ac } = loadAccessControl(tools, store);
    assert.equal(ac.canOpenView('finance'), true);
    assert.equal(ac.canOpenView('prescription'), true);
  });

  test('requestDoctorLogin opens modal and remembers pending destination', function () {
    const { tools, store } = loadAdmin();
    const { ac, elements } = loadAccessControl(tools, store);
    ac.requestDoctorLogin('finance');
    // modal should not be hidden
    assert.notEqual(elements['doctorLoginModal'].hidden, true);
  });

  test('logoutDoctor restores receptionist identity', async function () {
    const { tools, store } = loadAdmin(async () => ({
      ok: true, json: async () => ({ ok: true, sessionToken: 'T', userId: 'doctor', role: 'admin', name: 'Doc', expiresInSeconds: 3600 })
    }));
    await tools.loginWithPin('2468');
    const { ac } = loadAccessControl(tools, store);
    ac.logoutDoctor();
    assert.equal(store.getCurrentUser().role, 'receptionist');
  });
});
