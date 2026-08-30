'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('admin module parses and exposes its public tools', function () {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.js'), 'utf8');
  const context = {
    window: {},
    document: {},
    prompt() {},
    alert() {},
    fetch() {},
    console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'admin.js' });
  assert.equal(typeof context.AdminTools.openAudit, 'function');
  assert.equal(typeof context.AdminTools.openMigration, 'function');
  assert.equal(typeof context.AdminTools.loginWithPin, 'function', 'loginWithPin must be exported');
  assert.equal(typeof context.AdminTools.logout, 'function', 'logout must be exported');
  assert.equal(typeof context.AdminTools.hasValidAdminSession, 'function', 'hasValidAdminSession must be exported');
});

test('reception initialization attaches to the active reception view', function () {
  const events = [];
  const receptionView = {
    classList: { contains() { return false; } },
    addEventListener(name) { events.push(name); }
  };
  const document = {
    querySelector(selector) {
      if (selector === '#receptionView') return receptionView;
      return null;
    },
    querySelectorAll() { return []; },
    createElement() { return {}; },
    body: { appendChild() {} }
  };
  const context = {
    document,
    FinanceCore: {},
    FinanceStore: {},
    console,
    setTimeout,
    clearTimeout,
    confirm() { return false; }
  };
  context.window = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'receptionist.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'receptionist.js' });

  context.Receptionist.init();

  assert.ok(events.includes('rx-tab-shown'), 'Reception view should receive its activation listener');
});

/* ---- Structural HTML assertions (Task 6) ---- */
test('index.html loads the active reception and desktop workspace stylesheets', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const receptionMatches = html.match(/<link[^>]+href="reception\.css/g) || [];
  const desktopMatches = html.match(/<link[^>]+href="desktop-workspace\.css"/g) || [];
  assert.equal(receptionMatches.length, 1, 'the active Reception stylesheet must load exactly once');
  assert.equal(desktopMatches.length, 1, 'the desktop workspace stylesheet must load exactly once');
});

test('access-control.js is loaded after admin.js', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const adminIdx = html.indexOf('src="admin.js"');
  const acIdx = html.indexOf('src="access-control.js"');
  assert.ok(adminIdx !== -1, 'admin.js script tag must exist');
  assert.ok(acIdx !== -1, 'access-control.js script tag must exist');
  assert.ok(acIdx > adminIdx, 'access-control.js must appear after admin.js');
});

test('index.html declares the Reception entry point and every doctor destination', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<section id="receptionView" hidden/, 'Reception must be the initial entry surface');
  ['home', 'prescription', 'finance', 'expenses', 'report', 'appointments', 'payments', 'settings'].forEach(function (view) {
    assert.match(html, new RegExp('data-view="' + view + '"'), view + ' must remain declared in the doctor navigation');
  });
});

test('desktop workspace assets load after the existing doctor modules', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="desktop-workspace.js"') > html.indexOf('src="finance-ui.js"'));
});

test('the dynamic Reception modal host is declared exactly once', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const requiredIds = ['receptionView', 'homeView', 'doctorLoginModal', 'topNav'];
  requiredIds.forEach(function (id) {
    const re = new RegExp('id="' + id + '"', 'g');
    const count = (html.match(re) || []).length;
    assert.equal(count, 1, 'id="' + id + '" must appear exactly once, found ' + count);
  });
});

test('package.json build.files includes access-control.js', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('access-control.js'), 'access-control.js must be in build.files');
});

test('Electron Builder packages the desktop workspace assets', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('desktop-workspace.js'));
  assert.ok(pkg.build.files.includes('desktop-workspace.css'));
});

test('the selected test command includes the desktop workspace contract', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.match(pkg.scripts.test, /tests\/desktop-workspace\.test\.js/);
});
