'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const FinanceCore = require('../finance-core.js');

const projectRoot = path.resolve(__dirname, '..');
const receptionSource = fs.readFileSync(path.join(projectRoot, 'reception.js'), 'utf8');
const whatsappSource = fs.readFileSync(path.join(projectRoot, 'whatsapp-messaging.js'), 'utf8');
const receptionCss = fs.readFileSync(path.join(projectRoot, 'reception.css'), 'utf8');
const TEST_TODAY = FinanceCore.toISTDateString(new Date());
const TEST_PREVIOUS = FinanceCore.toISTDateString(new Date(new Date(TEST_TODAY + 'T00:00:00+05:30').getTime() - 86400000));
const TEST_MOBILE = '9'.repeat(10);

test('Reception has a visual collection queue with fast refresh and partial-payment action', function () {
  assert.match(receptionSource, /collectionTasks/);
  assert.match(receptionSource, /setInterval\([\s\S]{0,180}2000/);
  assert.match(receptionSource, /FinanceStore\.recordPayment\(/);
  assert.match(receptionSource, /remainingAmount/);
  assert.match(receptionSource, /Collect at reception/);
  assert.doesNotMatch(receptionSource, /new\s+Audio|\.play\(\)|beep/i, 'collection notification must stay visual-only');
});

test('returning doctor login forcibly hides setup-only fields in the rendered modal', function () {
  assert.match(receptionCss, /#trPinRow\[hidden\],\s*#trConfirmRow\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('Reception CSS provides compact professional Settings disclosure rows', function () {
  assert.match(receptionCss, /\.tr-settings-list\s*\{/);
  assert.match(receptionCss, /\.tr-settings-disclosure\s*\{/);
  assert.match(receptionCss, /\.tr-settings-panel\[hidden\]\s*\{\s*display:\s*none/);
});

test('Reception removes Amount Due controls and captures WhatsApp consent', function () {
  const dom = makeFixture();
  try {
    dom.window.ClinicReception.renderReception();
    assert.equal(dom.window.document.getElementById('trRcDue'), null);
    assert.match(dom.window.document.getElementById('trReceptionForm').textContent, /WhatsApp updates/i);
    assert.ok(dom.window.document.getElementById('trRcWhatsappOptIn'));
    assert.doesNotMatch(dom.window.document.getElementById('trRcList').textContent, /Amount Due/i);
  } finally {
    dom.window.close();
  }
});

test('visible UI copy capitalizes a lower-case first word without altering the rest', function () {
  const dom = makeFixture();
  try {
    assert.equal(dom.window.ClinicReception.capitalizeFirstWord('prescription display'), 'Prescription display');
  } finally {
    dom.window.close();
  }
});

test('Reception records a smaller payment and keeps the remainder on the task', function () {
  const dom = makeFixture();
  const cache = {
    bills: [{ billId: 'BIL-COLLECT', visitId: 'VIS-COLLECT', patientId: 'PAT-COLLECT', netBillAmount: 6000 }],
    payments: [{ billId: 'BIL-COLLECT', amount: 3000, transactionType: 'PAYMENT', status: 'ACTIVE' }],
    collectionTasks: [{ taskId: 'COL-COLLECT', billId: 'BIL-COLLECT', visitId: 'VIS-COLLECT', patientId: 'PAT-COLLECT', patientName: 'Asha', phone: '0000000000', requestedAmount: 3000, collectedAmount: 0, remainingAmount: 3000, status: 'REQUESTED', requestedAt: '2026-08-23' }]
  };
  const calls = [];
  dom.window.FinanceCore = FinanceCore;
  dom.window.FinanceStore = {
    getReceptionCache() { return cache; },
    refreshReceptionDay() { return Promise.resolve({ ok: true, data: cache }); },
    recordPayment(payment) { calls.push(['payment', payment.amount, payment.paymentMode]); cache.payments.push(Object.assign({}, payment, { status: 'ACTIVE' })); return { operationId: 'OP-COLLECT' }; },
    updateCollectionTask(task) { calls.push(['task', task.remainingAmount]); cache.collectionTasks[0] = task; return { operationId: 'OP-TASK' }; }
  };
  dom.window.ClinicReception.renderReception();
  const input = dom.window.document.querySelector('[data-collection-input="COL-COLLECT"]');
  const mode = dom.window.document.querySelector('[data-collection-mode="COL-COLLECT"]');
  mode.value = 'UPI';
  input.value = '2000';
  dom.window.document.querySelector('[data-collection-action="collect"]').click();

  assert.deepEqual(calls, [['payment', 2000, 'UPI'], ['task', 1000]]);
  assert.equal(cache.collectionTasks[0].remainingAmount, 1000);
  assert.match(dom.window.document.getElementById('trCollectionAlert').textContent, /remains due/);
  dom.window.close();
});

test('Reception collection requests provide a manual refresh with an in-progress state', async function () {
  const dom = makeFixture();
  try {
    let refreshCalls = 0;
    dom.window.FinanceStore = {
      getReceptionCache() { return { bills: [], payments: [], collectionTasks: [] }; },
      refreshReceptionDay() {
        refreshCalls += 1;
        return Promise.resolve({ ok: true });
      }
    };
    dom.window.ClinicReception.renderReception();
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
    refreshCalls = 0;

    const button = dom.window.document.getElementById('trCollectionRefresh');
    assert.ok(button, 'collection requests should provide a refresh button');
    button.click();
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, 'Refreshing…');
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
    assert.equal(refreshCalls, 1);
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Refresh');
  } finally {
    dom.window.close();
  }
});

function makeFixture() {
  const dom = new JSDOM(`<!doctype html>
    <html><body>
      <section id="receptionView" hidden></section>
      <section id="homeView" hidden></section>
      <div id="doctorLoginModal" hidden></div>
      <div class="control-panel" style="visibility:hidden">
        <button class="btn" data-toolbar-context="prescription-only">Save Patient</button>
        <button class="btn" data-toolbar-context="prescription-only">Print Prescription</button>
        <button class="btn" data-toolbar-context="global">Search Patient</button>
      </div>
      <nav class="top-nav" id="topNav" style="visibility:hidden">
        <button class="nav-tab" data-view="home">Home</button>
      </nav>
      <section id="settingsView" hidden></section>
      <main class="page-wrapper" style="visibility:hidden">
        <section class="tab-page" id="prescriptionView"></section>
        <section class="tab-page" id="expensesView"></section>
        <section class="tab-page" id="reportView"></section>
        <section class="tab-page" id="appointmentsView"></section>
      </main>
      <input id="patName"><input id="patAge"><select id="patGender"><option value="M">M</option><option value="F">F</option></select>
      <input id="patAddress"><input id="patPhone"><input id="patDate">
      <input id="showQR" type="checkbox"><div id="qrCodeSection"></div>
    </body></html>`, { url: 'https://Clinic.test/', runScripts: 'outside-only' });

  const { window } = dom;
  window.CONFIG = { APPS_SCRIPT_URL: '' };
  window.confirm = () => true;
  window.fetch = async () => { throw new Error('offline'); };
  window.switchView = () => {};
  window.resetFormSilent = () => {};
  const source = fs.readFileSync(path.join(projectRoot, 'reception.js'), 'utf8');
  vm.runInContext(whatsappSource, dom.getInternalVMContext(), { filename: 'whatsapp-messaging.js' });
  vm.runInContext(source, dom.getInternalVMContext(), { filename: 'reception.js' });
  window.ClinicReception.boot();
  return dom;
}

describe('Clinic Reception and Home workflow', () => {
  let dom;

  beforeEach(() => {
    dom = makeFixture();
  });

  afterEach(() => {
    dom.window.close();
  });

  test('boot starts in Reception and hides doctor content', () => {
    assert.equal(dom.window.document.getElementById('receptionView').hidden, false);
    assert.equal(dom.window.document.querySelector('.control-panel').style.visibility, 'hidden');
    assert.equal(dom.window.document.getElementById('topNav').style.visibility, 'hidden');
  });

  test('setup asks for PIN and confirmation once, then later login asks only for the main password', async () => {
    const { window } = dom;
    const openButton = window.document.getElementById('trDoctorLogin');
    const pinRow = () => window.document.getElementById('trPinRow');
    const confirmRow = () => window.document.getElementById('trConfirmRow');
    const pinInput = () => window.document.getElementById('trLoginPin');
    const confirmInput = () => window.document.getElementById('trLoginConfirm');

    openButton.click();
    assert.equal(pinRow().hidden, false);
    assert.equal(confirmRow().hidden, false);
    assert.equal(pinInput().disabled, false);
    assert.equal(confirmInput().disabled, false);
    assert.equal(pinInput().required, true);
    assert.equal(confirmInput().required, true);

    window.document.getElementById('trLoginPassword').value = 'doctor-pass';
    pinInput().value = '1234';
    confirmInput().value = 'doctor-pass';
    window.document.getElementById('trLoginForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.ClinicReceptionAuth.logout();
    openButton.click();
    assert.equal(pinRow().hidden, true);
    assert.equal(confirmRow().hidden, true);
    assert.equal(pinInput().disabled, true);
    assert.equal(confirmInput().disabled, true);
    assert.equal(pinInput().required, false);
    assert.equal(confirmInput().required, false);
    assert.equal(window.document.getElementById('trLoginSubmit').textContent, 'Login');
  });

  test('first-time setup stores hashes and successful login opens Home', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    assert.doesNotMatch(window.localStorage.getItem('Clinic_doctor_auth_v1'), /doctor-pass|1234/);
    assert.equal(await window.ClinicReceptionAuth.login('wrong-pass'), false);
    assert.equal(await window.ClinicReceptionAuth.login('doctor-pass'), true);
    assert.equal(window.document.getElementById('receptionView').hidden, true);
    assert.equal(window.document.getElementById('homeView').hidden, false);
    assert.equal(window.document.querySelector('[data-view="home"]').classList.contains('active'), true);
  });

  test('Settings lets an authenticated doctor change the login password without storing plaintext', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    window.switchView('settings');
    assert.equal(window.document.getElementById('settingsView').hidden, false);
    assert.ok(window.document.getElementById('trPasswordForm'));

    window.document.getElementById('trCurrentPassword').value = 'wrong-pass';
    window.document.getElementById('trNewPassword').value = 'new-doctor-pass';
    window.document.getElementById('trConfirmPassword').value = 'new-doctor-pass';
    window.document.getElementById('trPasswordForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.getElementById('trPasswordStatus').textContent, /Current password/i);

    window.document.getElementById('trCurrentPassword').value = 'doctor-pass';
    window.document.getElementById('trPasswordForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(window.document.getElementById('trPasswordStatus').textContent, /updated/i);
    assert.doesNotMatch(window.localStorage.getItem('Clinic_doctor_auth_v1'), /doctor-pass|new-doctor-pass/);

    window.ClinicReceptionAuth.logout();
    assert.equal(await window.ClinicReceptionAuth.login('doctor-pass'), false);
    assert.equal(await window.ClinicReceptionAuth.login('new-doctor-pass'), true);
  });

  test('Settings preferences persist safe values without a Reception amount field', async () => {
    const { window } = dom;
    assert.equal(typeof window.ClinicReception.saveSettingsPreferences, 'function');
    window.ClinicReception.saveSettingsPreferences({ density: 'compact', autoLockMinutes: '30' });
    assert.deepEqual(JSON.parse(JSON.stringify(window.ClinicReception.getSettingsPreferences())), { density: 'compact', autoLockMinutes: 30, whatsappClinicName: 'Clinic Management System', whatsappTemplate: 'Hello {name},\nWarm wishes from {clinic}.', whatsappSignature: 'Clinic Doctor' });
    assert.equal(window.document.body.classList.contains('doctor-density-compact'), true);
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    window.ClinicReceptionAuth.logout();
    assert.equal(window.document.getElementById('trRcDue'), null);
  });

  test('Settings saves QR and workspace choices, exposes sync state, and delegates local backup export', () => {
    const { window } = dom;
    let backupCalls = 0;
    const qrValues = [];
    window.exportSavedCSV = () => { backupCalls += 1; };
    window.toggleQR = (checkbox) => { qrValues.push(checkbox.checked); };
    window.FinanceStore = { getSyncStatus: () => ({ status: 'pending', pendingCount: 2 }) };
    window.ClinicReception.renderSettings();

    assert.match(window.document.getElementById('trSettingsSync').textContent, /2 changes waiting to sync/);
    window.document.getElementById('trSettingsDensity').value = 'compact';
    window.document.getElementById('trSettingsAutoLock').value = '30';
    window.document.querySelector('[data-settings-save]').click();
    assert.deepEqual(JSON.parse(JSON.stringify(window.ClinicReception.getSettingsPreferences())), { density: 'compact', autoLockMinutes: 30, whatsappClinicName: 'Clinic Management System', whatsappTemplate: 'Hello {name},\nWarm wishes from {clinic}.', whatsappSignature: 'Clinic Doctor' });

    window.document.getElementById('trSettingsQR').click();
    assert.deepEqual(qrValues, [true]);
    window.document.getElementById('trSettingsBackup').click();
    assert.equal(backupCalls, 1);
  });

test('Settings keeps professional option panels compact and updates a saved-value summary', () => {
    const { window } = dom;
    window.ClinicReception.renderSettings();

    const controls = Array.from(window.document.querySelectorAll('[data-settings-section]'));
    assert.equal(controls.length, 6);
    assert.equal(controls.every(function (button) { return button.getAttribute('aria-expanded') === 'false'; }), true);
    assert.equal(Array.from(window.document.querySelectorAll('[data-settings-panel]')).every(function (panel) { return panel.hidden; }), true);

    window.document.getElementById('trSettingsWorkspaceToggle').click();
    assert.equal(window.document.getElementById('trSettingsWorkspacePanel').hidden, false);

    window.document.getElementById('trSettingsNewPatientToggle').click();
    assert.equal(window.document.getElementById('trSettingsWorkspacePanel').hidden, true);
    assert.equal(window.document.getElementById('trSettingsNewPatientPanel').hidden, false);

    window.document.querySelector('[data-settings-save]').click();
    assert.equal(window.document.getElementById('trSettingsNewPatientSummary').textContent, 'Reception setup');
});

test('Settings opens the selected option as a full-width professional workspace card', () => {
  const { window } = dom;
  window.ClinicReception.renderSettings();
  const toggle = window.document.getElementById('trSettingsWorkspaceToggle');
  const card = toggle.closest('.tr-settings-disclosure');

  assert.equal(card.classList.contains('tr-settings-disclosure--workspace'), true);
  toggle.click();
  assert.equal(card.classList.contains('is-open'), true);
  assert.equal(card.getAttribute('data-settings-card'), 'workspace');
});

test('WhatsApp settings review requires confirmation before opening each draft', () => {
  const { window } = dom;
  const opened = [];
  let confirmations = 0;
  window.open = (url) => { opened.push(url); };
  window.confirm = () => { confirmations += 1; return true; };
  window.ClinicReceptionStore.createPatient({ name: 'Patient A', phone: TEST_MOBILE, whatsappOptIn: 'yes' }, new Date());
  window.ClinicReception.renderSettings();
  window.document.getElementById('trSettingsWhatsappToggle').click();
  assert.equal(window.document.getElementById('trSettingsWhatsappPanel').hidden, false);
  assert.ok(window.document.getElementById('trSettingsWhatsAppTemplate'));
  assert.match(window.document.getElementById('trSettingsWhatsAppSummary').textContent, /1 eligible/);
  window.document.getElementById('trSettingsWhatsAppClinic').value = 'Clinic Management System';
  window.document.getElementById('trSettingsWhatsAppTemplate').value = 'Hello {name}, happy Diwali!';
  window.document.getElementById('trSettingsWhatsAppSignature').value = 'Dr. Clinic';
  window.document.getElementById('trSettingsWhatsAppSave').click();
  assert.equal(window.ClinicReception.getSettingsPreferences().whatsappClinicName, 'Clinic Management System');
  window.document.getElementById('trSettingsWhatsAppStart').click();
  const send = window.document.querySelector('[data-wa-review-send]');
  assert.ok(send);
  send.click();
  assert.equal(confirmations, 1);
  assert.equal(opened.length, 1);
  assert.match(opened[0], new RegExp('wa\\.me/91' + TEST_MOBILE));
});

  test('Home hides prescription toolbar actions while keeping Search Patient available', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    const actions = [...window.document.querySelectorAll('[data-toolbar-context="prescription-only"]')];
    const search = window.document.querySelector('[data-toolbar-context="global"]');

    assert.equal(actions.every((button) => button.hidden), true);
    assert.equal(search.hidden, false);

    window.switchView('prescription');
    assert.equal(actions.every((button) => !button.hidden), true);
    assert.equal(search.hidden, false);

    window.switchView('home');
    assert.equal(actions.every((button) => button.hidden), true);
  });

  test('saving a patient creates a waiting queue entry and supports phone search', () => {
    const { window } = dom;
    const patient = window.ClinicReceptionStore.createPatient({
      name: 'Asha Test', age: '30', phone: '0000000000'
    }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    assert.equal(patient.workflowStatus, 'waiting');
    assert.equal(window.ClinicReceptionStore.listPatients(TEST_TODAY).length, 1);
    assert.equal(window.ClinicReceptionStore.search(window.ClinicReceptionStore.listPatients(TEST_TODAY), '0000000000').length, 1);
  });

  test('Home escapes patient names and Prescription prefills existing fields', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    const patient = window.ClinicReceptionStore.createPatient({
      name: '<img src=x onerror=alert(1)>', age: '30', gender: 'F',
      address: 'Main Street', phone: '0000000000'
    }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    window.ClinicReception.renderHome();
    const cards = window.document.getElementById('trHomeCards').innerHTML;
    assert.doesNotMatch(cards, /<img src=x/);
    assert.match(cards, /&lt;img/);
    window.ClinicReception.openPrescription(patient.id);
    assert.equal(window.document.getElementById('patName').value, patient.name);
    assert.equal(window.document.getElementById('patAge').value, '30');
    assert.equal(window.document.getElementById('patGender').value, 'F');
    assert.equal(window.document.getElementById('patPhone').value, '0000000000');
    assert.equal(window.document.getElementById('patDate').value, TEST_TODAY);
  });

  test('Home uses a centered Suraj-style workspace and can show previous patients', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    window.ClinicReceptionStore.createPatient({ name: 'Today Patient' }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    const previous = window.ClinicReceptionStore.createPatient({ name: 'Previous Patient', date: TEST_PREVIOUS }, new Date(TEST_PREVIOUS + 'T10:00:00+05:30'));
    window.ClinicReceptionStore.completePatient(previous.id, new Date(TEST_PREVIOUS + 'T11:00:00+05:30'));
    window.ClinicReception.renderHome();

    assert.ok(window.document.getElementById('trHomeWorkspace'), 'Home needs one centered queue workspace');
    assert.ok(window.document.querySelector('.tr-home-queue-heading'), 'Home needs the compact centered queue heading');
    assert.ok(window.document.querySelector('.tr-home-counts'), 'Home needs centered compact counters');
    assert.ok(window.document.querySelector('.tr-home-search-row'), 'Home needs the centered search row');
    assert.ok(window.document.getElementById('trHomeSummary'), 'Home needs a queue summary line');
    assert.equal(window.document.querySelectorAll('#trHomeWorkspace .tr-stat').length, 2);
    assert.ok(window.document.getElementById('trHomePreviousPatients'), 'Home needs a Previous Patients action');
    assert.match(window.document.getElementById('trHomeSummary').textContent, /1 Waiting · 0 Completed/);
    assert.match(window.document.getElementById('trHomeCards').textContent, /Today Patient/);
    assert.doesNotMatch(window.document.getElementById('trHomeCards').textContent, /Previous Patient/);
    const card = window.document.querySelector('#trHomeCards .tr-queue-card');
    assert.ok(card.querySelector('.tr-queue-accent'), 'Queue cards need the Suraj-style red accent');
    assert.ok(card.querySelector('.tr-queue-body'), 'Queue cards need a compact body wrapper');
    assert.ok(card.querySelector('.tr-queue-meta'), 'Queue cards need a single patient metadata line');

    window.document.getElementById('trHomePreviousPatients').click();
    assert.match(window.document.getElementById('trHomeCards').textContent, /Previous Patient/);
    assert.match(window.document.getElementById('trHomeSummary').textContent, /Previous patients/);
  });

  test('Remove moves a patient from Waiting to Completed without deleting history', () => {
    const { window } = dom;
    const patient = window.ClinicReceptionStore.createPatient({ name: 'Asha Test' }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    window.ClinicReceptionStore.completePatient(patient.id, new Date(TEST_TODAY + 'T11:00:00+05:30'));
    const saved = window.ClinicReceptionStore.listPatients(TEST_TODAY)[0];
    assert.equal(saved.workflowStatus, 'finalized');
    assert.equal(saved.receptionDone, true);
    assert.equal(window.ClinicReceptionStore.counts(TEST_TODAY).waiting, 0);
    assert.equal(window.ClinicReceptionStore.counts(TEST_TODAY).completed, 1);
  });

  test('logout returns the app to Reception', async () => {
    const { window } = dom;
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    window.ClinicReceptionAuth.logout();
    assert.equal(window.document.getElementById('receptionView').hidden, false);
    assert.equal(window.document.getElementById('homeView').hidden, true);
    assert.equal(window.document.querySelector('.control-panel').style.visibility, 'hidden');
  });

  test('doctor and reception shell transitions notify desktop workspace components', async () => {
    const { window } = dom;
    const visibility = [];
    window.document.addEventListener('clinic:doctor-shell', (event) => visibility.push(event.detail.visible));
    await window.ClinicReceptionAuth.setup('doctor-pass', '1234');
    await window.ClinicReceptionAuth.login('doctor-pass');
    window.ClinicReceptionAuth.logout();
    assert.equal(visibility.includes(true), true);
    assert.equal(visibility.at(-1), false);
  });

  test('Reception supports date filtering and renders Edit, Delete, and Mark as done actions', async () => {
    const { window } = dom;
    const patient = window.ClinicReceptionStore.createPatient({
      name: 'Reception Action Patient', age: '41', phone: '0000000001'
    }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    window.ClinicReception.renderReception();
    const dateInput = window.document.getElementById('trRcDate');
    assert.ok(dateInput, 'Reception needs a day selector');
    assert.match(window.document.getElementById('trRcList').innerHTML, /data-action="edit"/);
    assert.match(window.document.getElementById('trRcList').innerHTML, /data-action="delete"/);
    assert.match(window.document.getElementById('trRcList').innerHTML, /data-action="done"/);
    dateInput.value = TEST_PREVIOUS;
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(window.document.getElementById('trRcList').textContent, /No patients registered/);
    dateInput.value = TEST_TODAY;
    dateInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(window.document.getElementById('trRcList').textContent, /Reception Action Patient/);
    const doneButton = window.document.querySelector('[data-action="done"][data-id="' + patient.id + '"]');
    doneButton.click();
    await Promise.resolve();
    assert.equal(window.ClinicReceptionStore.findPatient(patient.id).workflowStatus, 'finalized');
  });

  test('Reception Edit updates a patient and Delete removes it after confirmation', async () => {
    const { window } = dom;
    window.confirm = () => true;
    const patient = window.ClinicReceptionStore.createPatient({ name: 'Original Patient', phone: '0000000002' }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    window.ClinicReception.renderReception();
    window.document.querySelector('[data-action="edit"][data-id="' + patient.id + '"]').click();
    assert.equal(window.document.getElementById('trRcName').value, 'Original Patient');
    window.document.getElementById('trRcName').value = 'Updated Patient';
    window.document.getElementById('trReceptionForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(window.ClinicReceptionStore.findPatient(patient.id).name, 'Updated Patient');
    window.document.querySelector('[data-action="delete"][data-id="' + patient.id + '"]').click();
    await Promise.resolve();
    assert.equal(window.ClinicReceptionStore.findPatient(patient.id), null);
  });

  test('Reception follows the centered Suraj-style workspace pattern', () => {
    const { window } = dom;
    window.ClinicReceptionStore.createPatient({ name: 'Pattern Patient', phone: '0000000003' }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    window.ClinicReception.renderReception();
    const reception = window.document.getElementById('receptionView');
    assert.ok(reception.querySelector('.tr-reception-workspace'), 'Reception needs a centered workspace wrapper');
    assert.ok(reception.querySelector('.tr-reception-top'), 'Reception needs the compact clinic header pattern');
    assert.ok(reception.querySelector('.tr-reception-form-card'), 'Reception needs a registration card');
    assert.ok(reception.querySelector('.tr-reception-list-card'), 'Reception needs a registered-patients card');
    assert.ok(reception.querySelector('.tr-reception-table'), 'Reception patient rows need a table-style container');
    assert.match(reception.querySelector('.tr-reception-table').innerHTML, /tr-list-header/);
  });

  test('Reception sync posts the record contract and keeps local data offline', async () => {
    const { window } = dom;
    let posted;
    window.CONFIG.GOOGLE_SHEETS_URL = 'https://example.test/reception';
    window.fetch = async (url, options) => {
      posted = { url, body: JSON.parse(options.body) };
      throw new Error('offline');
    };
    const patient = window.ClinicReceptionStore.createPatient({ name: 'Offline Patient' }, new Date(TEST_TODAY + 'T10:00:00+05:30'));
    const result = await window.ClinicReception.sync(patient);
    assert.equal(result.status, 'local');
    assert.equal(posted.url, 'https://example.test/reception');
    assert.equal(posted.body.sheet, 'Reception');
    assert.equal(posted.body.id, patient.id);
    assert.equal(window.ClinicReceptionStore.findPatient(patient.id).name, 'Offline Patient');
  });
});

test('Apps Script contains the Reception sheet contract and locked upsert path', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'Apps-Script-Code.gs'), 'utf8');
  assert.match(source, /RECEPTION_FIELDS/);
  assert.match(source, /sheet\s*===?\s*['"]Reception['"]|sheet\s*==\s*['"]Reception['"]/);
  assert.match(source, /LockService\.getScriptLock\(\)/);
  assert.match(source, /workflowStatus/);
  assert.match(source, /deleteReception/);
});

test('Reception CSS provides touch targets and a mobile no-overflow layout', () => {
  const css = fs.readFileSync(path.join(projectRoot, 'reception.css'), 'utf8');
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /\.tr-home-workspace[^}]*max-width:\s*1050px/s);
  assert.match(css, /\.tr-home-queue-heading[^}]*text-align:\s*center/s);
  assert.match(css, /\.tr-home-counts[^}]*justify-content:\s*center/s);
  assert.match(css, /\.tr-home-counts \.tr-stat[^}]*min-height:\s*64px/s);
  assert.match(css, /\.tr-home-search-row[^}]*max-width:\s*750px/s);
  assert.match(css, /\.tr-home-search-row \.tr-search[^}]*min-height:\s*46px/s);
  assert.match(css, /\.tr-home-stats/);
  assert.match(css, /\.tr-home-shell[^}]*background:/s);
  assert.match(css, /\.tr-home-toolbar[^}]*width:\s*100%/s);
  assert.match(css, /\.tr-search:focus-within[^}]*outline:/s);
  assert.match(css, /\.tr-search input:focus[^}]*outline:\s*0/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.tr-home-stats[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.tr-home-toolbar[^}]*gap:/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.top-nav[^}]*flex-wrap:\s*nowrap\s*!important/s);
  assert.match(css, /\.tr-queue-grid[^}]*max-width:\s*812px/s);
  assert.match(css, /\.tr-queue-grid[^}]*gap:\s*8px/s);
  assert.match(css, /\.tr-queue-card[^}]*width:\s*100%[^}]*max-width:\s*none[^}]*padding:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.tr-queue-accent[^}]*height:\s*4px/s);
  assert.match(css, /\.tr-queue-body[^}]*padding:\s*8px 12px/s);
  assert.match(css, /\.tr-queue-submeta[^}]*display:\s*none/s);
  assert.match(css, /\.tr-queue-actions[^}]*display:\s*flex[^}]*gap:\s*8px/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*\.tr-queue-actions[^}]*grid-template-columns:\s*1fr 1fr/s);
  assert.match(css, /\.tr-reception-workspace[^}]*max-width:\s*900px/s);
  assert.match(css, /\.tr-reception-top/);
  assert.match(css, /\.tr-reception-table/);
  assert.match(css, /\.tr-reception-filters\s+\.tr-search[^}]*flex-direction:\s*row/s);
});

test('index places the doctor toolbar and navigation before the Home content area', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const toolbarPosition = html.indexOf('<div class="control-panel">');
  const navigationPosition = html.indexOf('<div class="top-nav" id="topNav">');
  const homePosition = html.indexOf('<section id="homeView"');
  assert.ok(toolbarPosition >= 0, 'doctor toolbar must exist');
  assert.ok(navigationPosition > toolbarPosition, 'navigation must follow the toolbar');
  assert.ok(homePosition > navigationPosition, 'Home must render below the doctor navigation');
  assert.match(html, /data-toolbar-context="global"[^>]*onclick="openSearchModal\(\)"/);
});
