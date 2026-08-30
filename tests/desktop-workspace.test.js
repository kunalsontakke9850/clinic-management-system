'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const WORKSPACE_FILE = path.join(__dirname, '..', 'desktop-workspace.js');

function loadWorkspace(options) {
  const settings = options || {};
  const patient = settings.patient || {};
  const activeView = settings.activeView || 'home';
  const reception = settings.receptionVisible ? '<section id="receptionView"></section>' : '';
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="control-panel"><button data-toolbar-context="global">Search Patient</button></div>
    <div id="topNav"><button class="nav-tab active" data-view="${activeView}">Home</button></div>
    <section id="homeView"></section>
    <div class="page-wrapper"><div id="prescription"></div></div>
    ${reception}
    <input id="patName" value="${patient.name || ''}">
    <input id="patAge" value="${patient.age || ''}">
    <select id="patGender"><option value="F"${patient.gender === 'F' ? ' selected' : ''}>F</option><option value="M"${patient.gender === 'M' ? ' selected' : ''}>M</option></select>
    <input id="patPhone" value="${patient.phone || ''}">
    <input id="patDate" value="${patient.date || ''}">
  </body></html>`, { url: 'https://clinic.test/' });
  const window = dom.window;
  const switches = [];
  window.innerWidth = settings.innerWidth || 1440;
  if (settings.navigationCollapsed) window.localStorage.setItem('clinic_management_desktop_navigation_collapsed', '1');
  window.switchView = function (view) { switches.push(view); };
  window.Receptionist = { showReception: function () {} };
  const context = { window, document: window.document, navigator: window.navigator, CustomEvent: window.CustomEvent, setInterval, clearInterval, console };
  if (fs.existsSync(WORKSPACE_FILE)) vm.runInNewContext(fs.readFileSync(WORKSPACE_FILE, 'utf8'), context, { filename: 'desktop-workspace.js' });
  return { window, document: window.document, switches, api: window.DesktopWorkspace };
}

test('desktop workspace keeps every doctor destination reachable', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  assert.ok(fixture.api, 'DesktopWorkspace must be available');
  fixture.api.init();
  const views = Array.from(fixture.document.querySelectorAll('[data-desktop-view]')).map(function (button) { return button.getAttribute('data-desktop-view'); });
  assert.deepEqual(views, ['home', 'prescription', 'appointments', 'finance', 'expenses', 'report', 'payments', 'settings']);
});

test('desktop navigation labels its existing home destination as Home', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  fixture.api.init();
  assert.equal(fixture.document.querySelector('[data-desktop-view="home"]').textContent.trim(), 'Home');
});

test('doctor navigation can be minimized and restored without losing access to its controls', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  fixture.api.init();

  assert.equal(fixture.document.getElementById('desktopNavToggle').textContent.trim(), '‹');
  fixture.document.getElementById('desktopNavToggle').click();
  assert.equal(fixture.document.body.classList.contains('desktop-nav-collapsed'), true);
  assert.equal(fixture.document.getElementById('desktopNavRestore').hidden, false);
  assert.equal(fixture.document.getElementById('desktopNavRestore').textContent.trim(), '›');
  assert.equal(fixture.window.localStorage.getItem('clinic_management_desktop_navigation_collapsed'), '1');

  fixture.document.getElementById('desktopNavRestore').click();
  assert.equal(fixture.document.body.classList.contains('desktop-nav-collapsed'), false);
  assert.equal(fixture.document.getElementById('desktopNavRestore').hidden, true);
  assert.equal(fixture.document.querySelectorAll('[data-desktop-view]').length, 8);
});

test('desktop navigation reopens in its previously minimized state', function () {
  const fixture = loadWorkspace({ innerWidth: 1440, navigationCollapsed: true });
  fixture.api.init();
  assert.equal(fixture.document.body.classList.contains('desktop-nav-collapsed'), true);
  assert.equal(fixture.document.getElementById('desktopNavRestore').hidden, false);
});

test('desktop workspace removes the added top bar while retaining the existing command panel', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  assert.ok(fixture.api, 'DesktopWorkspace must be available');
  fixture.api.init();
  assert.equal(fixture.document.querySelector('#desktopAppShell .desktop-appbar'), null);
  assert.equal(fixture.document.querySelector('#desktopAppShell #desktopSyncStatus'), null);
  assert.ok(fixture.document.querySelector('.control-panel [data-toolbar-context="global"]'));
});

test('desktop navigation rail uses the compact laptop width', function () {
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop-workspace.css'), 'utf8');
  assert.match(css, /--dw-rail-width:\s*190px/);
});

test('minimized navigation keeps a content gutter instead of overlapping the doctor header', function () {
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop-workspace.css'), 'utf8');
  const collapsedRule = css.match(/body\.doctor-desktop\.desktop-nav-collapsed\s*\{[\s\S]*?\}/);
  assert.ok(collapsedRule, 'minimized navigation rule must exist');
  assert.match(collapsedRule[0], /--dw-rail-width:\s*42px/);
  assert.match(collapsedRule[0], /--dw-rail-gap:\s*14px/);
});

test('compact workspace preference narrows the doctor navigation only when selected', function () {
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop-workspace.css'), 'utf8');
  assert.match(css, /body\.doctor-desktop\.doctor-density-compact\s*\{\s*--dw-rail-width:\s*176px/);
});

test('desktop controls do not add a focus outline around active fields', function () {
  const css = fs.readFileSync(path.join(__dirname, '..', 'desktop-workspace.css'), 'utf8');
  assert.match(css, /:focus-visible\s*\{\s*outline:\s*none\s*!important/);
});

test('desktop workspace does not render a Current Patient strip', function () {
  const fixture = loadWorkspace({ innerWidth: 1440, activeView: 'prescription', patient: { name: 'Asha Patil', age: '36', gender: 'F', phone: '0000000000', date: '2026-08-26' } });
  assert.ok(fixture.api, 'DesktopWorkspace must be available');
  fixture.api.init();
  assert.equal(fixture.document.getElementById('desktopPatientContext'), null);
  assert.equal(fixture.document.querySelector('.page-wrapper').textContent, '');
});

test('desktop navigation delegates to the existing switchView function', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  assert.ok(fixture.api, 'DesktopWorkspace must be available');
  fixture.api.init();
  fixture.document.querySelector('[data-desktop-view="finance"]').click();
  assert.deepEqual(fixture.switches, ['finance']);
});

test('desktop shell is hidden in Reception and visible in doctor mode', function () {
  const fixture = loadWorkspace({ innerWidth: 1440 });
  assert.ok(fixture.api, 'DesktopWorkspace must be available');
  fixture.api.init();
  fixture.document.dispatchEvent(new fixture.window.CustomEvent('clinic:doctor-shell', { detail: { visible: false } }));
  assert.equal(fixture.document.querySelector('#desktopAppShell').hidden, true);
  fixture.document.dispatchEvent(new fixture.window.CustomEvent('clinic:doctor-shell', { detail: { visible: true } }));
  assert.equal(fixture.document.querySelector('#desktopAppShell').hidden, false);
});

test('the product entry point loads the desktop workspace after clinic modules', function () {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const workspaceCss = html.indexOf('href="desktop-workspace.css"');
  const workspaceJs = html.indexOf('src="desktop-workspace.js"');
  assert.ok(workspaceCss > -1, 'desktop workspace CSS must be loaded by the application');
  assert.ok(workspaceJs > html.indexOf('src="finance-ui.js"'), 'desktop workspace must load after clinic modules expose their APIs');
});
