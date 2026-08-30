'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FinanceCore = require('../finance-core.js');
const FinanceView = require('../finance-ui.js');

const indexSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const financeUiSource = fs.readFileSync(path.join(__dirname, '..', 'finance-ui.js'), 'utf8');
const paymentLedgerSource = fs.readFileSync(path.join(__dirname, '..', 'payment-ledger.js'), 'utf8');

test('mergeLegacyExpenses keeps legacy-only rows and removes finance duplicates', function () {
  const merged = FinanceView.mergeLegacyExpenses([
    { expenseId: 'EXP-1', expenseDate: '2026-08-22', description: 'Gloves', amount: 100, status: 'ACTIVE' }
  ], [
    { id: 'legacy-1', date: '2026-08-22', category: 'Supplies', description: 'Gloves', amount: 100 },
    { id: 'legacy-2', date: '2026-08-21', category: 'Rent', description: 'Rent', amount: 500 }
  ]);

  assert.equal(merged.length, 2);
  assert.equal(merged.filter(row => row.description === 'Gloves').length, 1);
  assert.equal(merged.find(row => row.id === 'legacy-2').source, 'legacy-expense');
});

test('validateEntry rejects blank descriptions and non-positive amounts', function () {
  assert.deepEqual(FinanceView.validateEntry({ description: '', amount: 100 }).errors, ['Description is required.']);
  assert.deepEqual(FinanceView.validateEntry({ description: 'Rent', amount: 0 }).errors, ['Amount must be greater than 0.']);
});

test('validateEntry accepts a complete positive finance entry', function () {
  assert.deepEqual(FinanceView.validateEntry({ description: 'Rent', amount: 500 }).errors, []);
});

test('cash closing totals include cash receipts and only the selected period', function () {
  const totals = FinanceView.cashClosingTotals({
    payments: [
      { paymentDate: '2026-08-22', amount: 600, paymentMode: 'CASH', transactionType: 'PAYMENT' },
      { paymentDate: '2026-08-21', amount: 900, paymentMode: 'CASH', transactionType: 'PAYMENT' }
    ],
    receipts: [
      { receiptDate: '2026-08-22', amount: 800, paymentMode: 'CASH', status: 'ACTIVE' },
      { receiptDate: '2026-08-22', amount: 100, paymentMode: 'UPI', status: 'ACTIVE' }
    ],
    expenses: [
      { expenseDate: '2026-08-22', amount: 125, paymentMode: 'CASH', status: 'ACTIVE' },
      { expenseDate: '2026-08-21', amount: 300, paymentMode: 'CASH', status: 'ACTIVE' }
    ]
  }, { from: '2026-08-22', to: '2026-08-22' });

  assert.deepEqual(totals, { cashPayments: 1400, cashRefunds: 0, cashExpenses: 125 });
});

test('index includes the connected professional Finance workspace', function () {
  assert.match(indexSource, /data-view="finance"/);
  ['financeView', 'fd-kpi-strip', 'fd-cashbook-entries', 'fd-period', 'fd-date', 'fd-filter'].forEach(function (id) {
    assert.match(indexSource, new RegExp('id="' + id + '"'));
  });
  assert.match(indexSource, /finance-ui\.js/);
  assert.match(indexSource, /finance-shell/);
});

test('Finance sources include patient fees and completed visits', function () {
  assert.match(financeUiSource, /patientFees/);
  assert.match(financeUiSource, /completedVisits/);
});

test('Loaded prescription and Generate Bill flows write through FinanceStore', function () {
  assert.match(indexSource, /function syncPrescriptionFinance\(/);
  assert.match(indexSource, /FinanceStore\.saveAndPostBill\(/);
  assert.match(indexSource, /FinanceStore\.recordPayment\(/);
  assert.match(indexSource, /stableFinanceId\(/);
  assert.match(indexSource, /matching finance bills were not found/);
});

test('prescription finance sync imports normalized history with stable IDs', function () {
  assert.match(indexSource, /paymentHistory/);
  assert.match(indexSource, /normalizePatientPaymentHistory\(/);
  assert.match(indexSource, /payment\.paymentId/);
  assert.match(indexSource, /payment\.paymentDate/);
  assert.match(indexSource, /payment\.paymentMode/);
  assert.match(indexSource, /warnings/);
});

test('Doctor fee panel creates a receptionist collection request without recording it as paid', function () {
  assert.match(indexSource, /id="billCollectAtReception"/);
  assert.match(indexSource, /Collect at reception/);
  assert.match(indexSource, /FinanceStore\.saveCollectionTask\(/);
  assert.match(indexSource, /collectionTaskId/);
});

test('Patient visit history uses clickable rows and opens a separate detail view', function () {
  assert.match(indexSource, /function renderVisitHistoryTable\(/);
  assert.match(indexSource, /Recent Visits/);
  assert.match(indexSource, /Visit Date/);
  assert.match(indexSource, /Amount Paid/);
  assert.match(indexSource, /openVisitDetail\(/);
  assert.doesNotMatch(indexSource, /visit-history-table[\s\S]{0,250}Edit/);
});

test('Visit detail owns editing and preserves the original visit identity', function () {
  assert.match(indexSource, /function openVisitDetail\(/);
  assert.match(indexSource, /function editVisitFromDetail\(/);
  assert.match(indexSource, /function cancelVisitEdit\(/);
  assert.match(indexSource, /_editingVisitRecord/);
  assert.match(indexSource, /patientDayKey\(record\)/);
});

test('past prescription display and editing share the safe medicine-line parser', function () {
  const parserUses = indexSource.match(/PrescriptionMedicine\.parseSavedMedicineLine\(line\)/g) || [];
  assert.equal(parserUses.length, 2, 'Both read-only display and edit loading must use the same parser');
  assert.match(indexSource, /prescription-medicines\.js/);
});

test('Search result opens the prescription workspace instead of leaving the doctor on Home', function () {
  const loadBody = indexSource.match(/function loadPatientRecord\([\s\S]*?\n  function showPrevVisitPanel\(/);
  assert.ok(loadBody, 'loadPatientRecord should be present');
  assert.match(loadBody[0], /switchView\(['"]prescription['"]\)/);
  assert.match(loadBody[0], /closeSearchModal\(\)/);
});

test('Prescription navigation opens the editable prescription when visit history is open', function () {
  const switchBody = indexSource.match(/function switchView\(view\) \{[\s\S]*?window\.scrollTo\(/);
  assert.ok(switchBody, 'switchView should be present');
  assert.match(switchBody[0], /view === 'prescription'/);
  assert.match(switchBody[0], /showNewVisitPage\(\)/);
  assert.match(switchBody[0], /prevRxPage[\s\S]*?style\.display\s*=\s*'none'/);
});

test('New visit has a cancel action that returns to Recent Visits', function () {
  assert.match(indexSource, /id="cancelNewVisitBtn"/);
  assert.match(indexSource, /onclick="cancelNewVisitPage\(\)"/);
  assert.match(indexSource, /function cancelNewVisitPage\(/);
  assert.match(indexSource, /showVisitHistory\(\)/);
});

test('Settings tab follows Upcoming Appointments in the doctor navigation', function () {
  assert.match(indexSource, /data-view="appointments"[\s\S]*data-view="settings"/);
  assert.match(indexSource, /id="settingsView"/);
});

test('Finance sources include completed reception visits but exclude waiting reception patients', function () {
  const values = new Map([
    ['clinic_reception_patients_v1', JSON.stringify([
      { id: 'R-1', name: 'Completed Patient', phone: '0000000000', date: '2026-08-22', workflowStatus: 'finalized', receptionDone: true },
      { id: 'R-2', name: 'Waiting Patient', phone: '0000000001', date: '2026-08-22', workflowStatus: 'waiting', receptionDone: false }
    ])]
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
  const context = {
    FinanceCore,
    localStorage: storage,
    window: null,
    document: {},
    console,
    Date,
    JSON,
    Math,
    setTimeout,
    clearTimeout,
    FinanceStore: {
      getFinanceCache() { return { bills: [], payments: [], receipts: [], expenses: [], patientFees: [], completedVisits: [] }; },
      getReceptionCache() { return { bills: [], payments: [], expenses: [], patientFees: [], completedVisits: [] }; },
      onStatusChange() {}
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(financeUiSource, context, { filename: 'finance-ui.js' });
  const sources = context.FinanceView.financeSources();
  assert.deepEqual(sources.completedVisits.map(row => row.name), ['Completed Patient']);
});

test('Finance sources expose local paymentHistory events and only the base remainder as legacy fees', function () {
  const values = new Map([
    ['patient_history_1', JSON.stringify({
      name: 'History Patient', phone: '0000000002', date: '2026-08-25',
      billAmount: 1000, billPaid: 700, billMode: 'CASH',
      patientId: 'PAT-HISTORY', visitId: 'VIS-HISTORY', billId: 'BIL-HISTORY',
      paymentHistory: [
        { type: 'payment', amount: 200, date: '2026-08-25T09:00:00+05:30', mode: 'UPI' },
        { type: 'payment', amount: 300, date: '2026-08-25T10:00:00+05:30', mode: 'CARD' }
      ]
    })]
  ]);
  const storage = {
    get length() { return values.size; },
    key(index) { return Array.from(values.keys())[index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
  const context = {
    FinanceCore, localStorage: storage, window: null, document: {}, console, Date, JSON, Math, setTimeout, clearTimeout,
    FinanceStore: {
      getFinanceCache() { return { bills: [], payments: [], receipts: [], expenses: [], patientFees: [], completedVisits: [] }; },
      getReceptionCache() { return { bills: [], payments: [], expenses: [], patientFees: [], completedVisits: [] }; },
      onStatusChange() {}
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(financeUiSource, context, { filename: 'finance-ui.js' });
  const sources = context.FinanceView.financeSources();
  assert.equal(JSON.stringify(sources.payments.map(function (row) { return [row.amount, row.paymentMode]; })), JSON.stringify([[200, 'UPI'], [300, 'CARD']]));
  assert.equal(JSON.stringify(sources.patientFees.map(function (row) { return row.billPaid; })), JSON.stringify([200]));
});

test('Finance matches the Suraj-style compact cashbook layout', function () {
  ['cashbook-title', 'cashbook', 'cashbook-range', 'cashbook-head', 'cashbook-entry-form', 'cashbook-actions', 'cashbook-totals'].forEach(function (className) {
    assert.match(indexSource, new RegExp('class="[^"]*' + className + '[^"]*"'));
  });
  assert.match(indexSource, />Clinic Cashbook</);
  assert.match(indexSource, />Transactions</);
  assert.match(indexSource, />Print Bills</);
  assert.match(indexSource, /cashbook-range/);
});

test('Cashbook keeps a long transaction list in a scrollable panel', function () {
  const listStyle = indexSource.match(/\.cashbook-list\s*\{[\s\S]*?\}/);
  assert.ok(listStyle, 'cashbook list style must exist');
  assert.match(listStyle[0], /max-height\s*:/);
  assert.match(listStyle[0], /overflow-y\s*:\s*auto/);
  assert.match(indexSource, /scrollbar-gutter\s*:\s*stable/);
});

test('Prescription provides an X-ray image upload above the QR code and carries it through visits', function () {
  const uploadPosition = indexSource.indexOf('id="xrayImageInput"');
  const qrPosition = indexSource.indexOf('id="showQR"');
  assert.ok(uploadPosition >= 0, 'X-ray upload control must exist');
  assert.ok(qrPosition >= 0, 'QR control must exist');
  assert.ok(uploadPosition < qrPosition, 'X-ray upload must appear above the QR control');
  assert.match(indexSource, /id="xrayImageInput"[^>]*accept="image\/(?:jpeg|png|webp),image\/(?:jpeg|png|webp),image\/(?:jpeg|png|webp),image\/\*"/);
  assert.match(indexSource, /function handleXrayImageUpload\(/);
  assert.match(indexSource, /xrayImage:\s*getXrayImageData\(\)/);
  assert.match(indexSource, /setXrayImage\(r\.xrayImage/);
  assert.match(indexSource, /xrayImageHTML/);
  assert.match(indexSource, /xray-image-section[^>]*xray-empty/);
  assert.match(indexSource, /classList\.toggle\(['"]xray-empty['"],\s*!safe\)/);
});

test('Expenses includes professional payment and vendor details', function () {
  ['expPaymentMode', 'expVendor', 'expReference'].forEach(function (id) {
    assert.match(indexSource, new RegExp('id="' + id + '"'));
  });
});

test('Expenses uses a clear professional responsive records workspace', function () {
  ['expenses-workspace', 'expenses-entry-card', 'expenses-entry-grid', 'expenses-records-card', 'expenses-toolbar', 'expenses-table', 'expenses-summary-grid'].forEach(function (className) {
    assert.match(indexSource, new RegExp(className));
  });
  assert.match(indexSource, /class="[^\"]*expenses-workspace[^\"]*" id="expensesView"/);
  assert.match(indexSource, /class="[^"]*expenses-table[^"]*"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'finance-ui.js'), 'utf8'), /data-label="Date"/);
});

test('Patient Payment ledger module is available for the shared payment workflow', function () {
  const modulePath = path.join(__dirname, '..', 'payment-ledger.js');
  assert.equal(fs.existsSync(modulePath), true, 'payment-ledger.js must exist');
  const PatientPayment = require(modulePath);
  assert.equal(typeof PatientPayment.buildLedgerRows, 'function');
  assert.equal(typeof PatientPayment.filterLedgerRows, 'function');
  assert.equal(typeof PatientPayment.applyAdditionalPayment, 'function');
  assert.equal(typeof PatientPayment.applyAdditionalFee, 'function');
});

test('Patient Payment ledger expands history events without double-counting totals', function () {
  const PatientPayment = require('../payment-ledger.js');
  const rows = PatientPayment.buildLedgerRows([{
    name: 'Pravin Khandelwal', phone: '0000000000', date: '2026-08-01',
    billAmount: 18500, billPaid: 16000, billMode: 'Cash',
    paymentHistory: JSON.stringify([
      { type: 'payment', amount: 1000, date: '2026-08-25', mode: 'Cash' },
      { type: 'fee', amount: 500, date: '2026-08-25', note: 'Additional treatment' }
    ])
  }]);

  assert.deepEqual(rows.map(row => row.transaction), ['Visit', 'Additional payment', 'Additional fee']);
  assert.deepEqual(rows.map(row => [row.feesAdded, row.paid, row.due]), [
    [18000, 15000, 3000], [0, 1000, 2000], [500, 0, 2500]
  ]);
  assert.deepEqual(PatientPayment.summarizeLedger(rows), { fees: 18500, paid: 16000, due: 2500 });
});

test('Patient Payment history uses formal reception payments instead of stale visit totals', function () {
  const PatientPayment = require('../payment-ledger.js');
  const rows = PatientPayment.buildLedgerRows([{
    name: 'Pravin Khandelwal', phone: '0000000000', date: '2026-08-01',
    billId: 'BIL-PRAVIN', billAmount: 5500, billPaid: 0, billMode: 'Cash',
    paymentHistory: JSON.stringify([{ type: 'fee', amount: 500, date: '2026-08-02', note: 'Additional treatment' }])
  }], [{
    paymentId: 'PAY-RECEPTION-1', billId: 'BIL-PRAVIN', paymentDate: '2026-08-03T10:00:00+05:30',
    amount: 1500, paymentMode: 'UPI', transactionType: 'PAYMENT', note: 'Collected at reception for doctor request', status: 'ACTIVE'
  }]);

  assert.deepEqual(rows.map(row => [row.transaction, row.feesAdded, row.paid, row.due, row.mode]), [
    ['Visit', 5000, 0, 5000, 'Cash'],
    ['Additional fee', 500, 0, 5500, '—'],
    ['Reception payment', 0, 1500, 4000, 'UPI']
  ]);
  assert.deepEqual(PatientPayment.summarizeLedger(rows), { fees: 5500, paid: 1500, due: 4000 });
});

test('Patient Payment filters by search, status, and date range', function () {
  const PatientPayment = require('../payment-ledger.js');
  const rows = PatientPayment.buildLedgerRows([
    { name: 'Pravin Khandelwal', phone: '0000000000', date: '2026-08-01', billAmount: 1000, billPaid: 500 },
    { name: 'Jyoti Hissal', phone: '0000000001', date: '2026-07-10', billAmount: 800, billPaid: 800 }
  ]);
  assert.equal(PatientPayment.filterLedgerRows(rows, { search: '0000000000' }).length, 1);
  assert.equal(PatientPayment.filterLedgerRows(rows, { status: 'due' }).every(row => row.due > 0), true);
  assert.equal(PatientPayment.filterLedgerRows(rows, { status: 'paid' }).every(row => row.due === 0), true);
  assert.equal(PatientPayment.filterLedgerRows(rows, { from: '2026-08-01', to: '2026-08-31' }).length, 1);
});

test('Patient Payment guards overpayment and appends fee/payment history safely', function () {
  const PatientPayment = require('../payment-ledger.js');
  const visit = { billAmount: 1000, billPaid: 400, paymentHistory: '[]' };
  assert.equal(PatientPayment.applyAdditionalPayment(visit, 700).ok, false);
  const payment = PatientPayment.applyAdditionalPayment(visit, 600);
  assert.equal(payment.ok, true);
  assert.equal(payment.record.billPaid, 1000);
  const fee = PatientPayment.applyAdditionalFee(payment.record, 250, 'Review');
  assert.equal(fee.ok, true);
  assert.equal(fee.record.billAmount, 1250);
  assert.deepEqual(JSON.parse(fee.record.paymentHistory).map(row => row.type), ['fee']);
});

test('patient history stays visible and reconciles an open reception request after a doctor payment', function () {
  assert.match(indexSource, /No patient selected yet/);
  assert.match(indexSource, /No billing history has been recorded/);
  assert.match(indexSource, /paymentHistoryFormalPayments\(/);
  assert.match(indexSource, /reconcileCollectionTaskAfterDoctorPayment\(/);
  assert.match(paymentLedgerSource, /Reception payment/);
  assert.match(indexSource, /<th>Date \/ Transaction<\/th><th>Amount<\/th>/);
});

test('a patient without billing history can start their first fee or payment from the history card', function () {
  assert.match(indexSource, /beginPaymentHistoryEntry\('fee'\)/);
  assert.match(indexSource, /beginPaymentHistoryEntry\('payment'\)/);
  assert.match(indexSource, /Add the first fee above/);
});

test('fee sidebar does not render the Today\'s Patients list', function () {
  assert.doesNotMatch(indexSource, /<div class="bill-list-head">Today\'s Patients/);
  assert.doesNotMatch(indexSource, /id="billList"/);
});

test('index includes the Patient Payment navigation and responsive ledger controls', function () {
  assert.match(indexSource, /data-view="payments"/);
  ['paymentsView', 'paymentLedgerSearch', 'paymentLedgerStatus', 'paymentLedgerFrom', 'paymentLedgerTo', 'paymentLedgerTableBody'].forEach(function (id) {
    assert.match(indexSource, new RegExp('id="' + id + '"'));
  });
  assert.match(indexSource, /function renderPaymentLedgerTab\(/);
  assert.match(indexSource, /payment-ledger-table-wrap/);
});

test('Patient Payment refreshes the complete Google list when opened', function () {
  assert.match(indexSource, /function refreshPaymentLedgerFromSheet\(/);
  const switchBody = indexSource.match(/function switchView\(view\) \{[\s\S]*?\n  \}/);
  assert.ok(switchBody, 'switchView should be present');
  assert.match(switchBody[0], /view === 'payments'/);
  assert.match(switchBody[0], /refreshPaymentLedgerFromSheet\(\)/);
  assert.match(indexSource, /id="paymentLedgerRefresh"/);
});

test('Upcoming Appointments has professional action controls', function () {
  assert.match(indexSource, /class="[^\"]*appointments-workspace[^\"]*" id="appointmentsView"/);
  assert.match(indexSource, /class="[^"]*appointments-table[^"]*" id="apptTable"/);
  assert.match(indexSource, /Mark as done/);
  assert.match(indexSource, /Abscond/);
  assert.match(indexSource, /function updateUpcomingAppointment/);
});

test('Prescription toolbar does not show the Send WhatsApp action', function () {
  var toolbarStart = indexSource.indexOf('<div class="control-panel">');
  var toolbarEnd = indexSource.indexOf('<!-- ===== TOP NAVIGATION TABS ===== -->');
  var toolbar = indexSource.slice(toolbarStart, toolbarEnd);
  assert.doesNotMatch(toolbar, />Send WhatsApp<\/button>/);
});

test('Fees summary labels the remaining amount as Due', function () {
  assert.match(indexSource, /<div class="billing-fee-sub-lbl">Due<\/div>/);
});

test('Upcoming Appointments lets the doctor prepare a WhatsApp reminder', function () {
  assert.match(indexSource, /Send reminder on WhatsApp/);
  assert.match(indexSource, /function sendAppointmentReminderWhatsApp\(/);
  assert.match(indexSource, /sendAppointmentReminderWhatsApp\(' \+ i \+ ',event\)/);
  assert.match(indexSource, /https:\/\/wa\.me\//);
});

test('Upcoming Appointments provides a previous follow-up records view', function () {
  ['previous-records-button', 'previous-records-panel', 'previous-appt-table', 'previousApptTableBody'].forEach(function (marker) {
    assert.match(indexSource, new RegExp(marker));
  });
  assert.match(indexSource, /Previous Records/);
  assert.match(indexSource, /function renderPreviousAppointments/);
});

test('Previous Records changes the appointments heading to Past Appointments', function () {
  assert.match(indexSource, /id="appointments-heading"[^>]*>Upcoming Appointments<\/h2>/);
  assert.match(indexSource, /appointmentsHeading\.textContent\s*=\s*showPrevious\s*\?\s*'Past Appointments'\s*:\s*'Upcoming Appointments'/);
});

test('Electron packaging includes the finance modules', function () {
  ['finance-core.js', 'finance-store.js', 'finance-ui.js'].forEach(function (file) {
    assert.ok(packageJson.build.files.includes(file), file + ' must be packaged');
  });
  assert.ok(packageJson.build.files.includes('prescription-medicines.js'), 'prescription-medicines.js must be packaged');
});
