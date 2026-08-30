'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FinanceCore = require('../finance-core.js');

function makeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function loadStore(serverResponse) {
  const localStorage = makeStorage();
  const context = {
    FinanceCore,
    CONFIG: { GOOGLE_SHEETS_URL: 'https://script.google.com/macros/s/test-deployment/exec' },
    navigator: { onLine: true },
    localStorage,
    fetch: async function () {
      return { ok: true, status: 200, json: async function () { return serverResponse; } };
    },
    console: { error() {}, warn() {}, log() {} },
    setTimeout,
    clearTimeout,
    Date,
    JSON,
    Math
  };
  context.window = context;
  context.window.addEventListener = function () {};
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'finance-store.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'finance-store.js' });
  return { store: context.FinanceStore, localStorage, navigator: context.navigator };
}

test('refreshReceptionDay stores a serializable flat server response', async function () {
  const serverResponse = {
    ok: true,
    date: '2026-08-21',
    appointments: [],
    bills: [],
    payments: [],
    expenses: [],
    closing: null
  };
  const loaded = loadStore(serverResponse);

  const result = await loaded.store.refreshReceptionDay('2026-08-21');

  assert.equal(result.ok, true);
  assert.equal(result.data.date, '2026-08-21');
  assert.deepEqual(Array.from(result.data.appointments), []);
  assert.notEqual(result.data.data, result.data, 'response must not contain a circular data reference');

  const persisted = JSON.parse(loaded.localStorage.getItem('reception_cache_v1'));
  assert.equal(persisted.date, '2026-08-21');
  assert.deepEqual(persisted.bills, []);
});

test('saveCollectionTask shows a doctor request immediately and queues it for sync', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;

  const result = loaded.store.saveCollectionTask({
    taskId: 'COL-1', billId: 'BIL-1', visitId: 'VIS-1', patientId: 'PAT-1',
    patientName: 'Kunal', requestedAmount: 3000, collectedAmount: 0,
    remainingAmount: 3000, status: 'REQUESTED', requestedAt: '2026-08-23'
  });

  assert.equal(result.status, 'pending');
  assert.equal(loaded.store.getReceptionCache().collectionTasks[0].remainingAmount, 3000);
  assert.equal(loaded.store._getQueue()[0].action, 'upsertCollectionTask');
});

test('updateCollectionTask keeps the remaining balance after a partial collection', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;
  loaded.store.saveCollectionTask({
    taskId: 'COL-2', billId: 'BIL-2', visitId: 'VIS-2', patientId: 'PAT-2',
    patientName: 'Asha', requestedAmount: 3000, collectedAmount: 0,
    remainingAmount: 3000, status: 'REQUESTED', requestedAt: '2026-08-23'
  });
  loaded.store.updateCollectionTask({
    taskId: 'COL-2', billId: 'BIL-2', visitId: 'VIS-2', patientId: 'PAT-2',
    patientName: 'Asha', requestedAmount: 3000, collectedAmount: 2000,
    remainingAmount: 1000, status: 'PARTIAL', requestedAt: '2026-08-23'
  });

  assert.equal(loaded.store.getReceptionCache().collectionTasks[0].status, 'PARTIAL');
  assert.equal(loaded.store.getReceptionCache().collectionTasks[0].remainingAmount, 1000);
  assert.deepEqual(loaded.store._getQueue().map(op => op.action), ['upsertCollectionTask', 'upsertCollectionTask']);
});

test('refreshFinanceSummary keeps patient fees and completed visits from the server', async function () {
  const loaded = loadStore({
    ok: true,
    bills: [], payments: [], receipts: [], expenses: [],
    patientFees: [{ name: 'Kunal', date: '2026-08-22', billPaid: 300 }],
    completedVisits: [{ visitId: 'VISIT-1', patientName: 'Kunal', date: '2026-08-22' }]
  });

  const result = await loaded.store.refreshFinanceSummary('2026-08-22', '2026-08-22');

  assert.equal(result.ok, true);
  assert.equal(loaded.store.getFinanceCache().patientFees[0].billPaid, 300);
  assert.equal(loaded.store.getFinanceCache().completedVisits[0].visitId, 'VISIT-1');
});

test('a permanently failed queued operation leaves sync status in error', async function () {
  const loaded = loadStore({ ok: false, errorCode: 'VALIDATION', message: 'Rejected' });
  loaded.localStorage.setItem('finance_sync_queue_v1', JSON.stringify([{
    operationId: 'OP-FAILED',
    action: 'upsertExpense',
    payload: { expenseId: 'EXP-FAILED' },
    userId: 'receptionist',
    role: 'receptionist',
    queuedAt: '2026-08-21T10:00:00+05:30',
    attemptCount: 4,
    lastError: null,
    status: 'retry'
  }]));
  const statuses = [];
  loaded.store.onStatusChange(function (info) { statuses.push(info.status); });

  await loaded.store._processQueue();

  assert.equal(loaded.store.getErrorOperations().length, 1);
  assert.equal(statuses.at(-1), loaded.store.STATUS.ERROR);
});

test('server validation errors are not retried and remain visible for correction', async function () {
  const loaded = loadStore({ ok: false, errorCode: 'VALIDATION', message: 'Amount is invalid' });
  loaded.localStorage.setItem('finance_sync_queue_v1', JSON.stringify([{
    operationId: 'OP-VALIDATION', action: 'upsertExpense', payload: { expenseId: 'EXP-1' },
    userId: 'receptionist', role: 'receptionist', queuedAt: '2026-08-21T10:00:00+05:30',
    attemptCount: 0, lastError: null, status: 'pending'
  }]));

  await loaded.store._processQueue();

  const failed = loaded.store.getErrorOperations();
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, 'error');
  assert.match(failed[0].lastError, /VALIDATION/);
});

test('saveAndPostBill queues bill creation before posting and marks it posted locally', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;

  const result = loaded.store.saveAndPostBill({
    billId: 'BIL-POST-FLOW',
    visitId: 'VIS-POST-FLOW',
    patientId: 'PAT-POST-FLOW',
    billDate: '2026-08-21',
    items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
    discount: 0
  });

  assert.equal(result.billId, 'BIL-POST-FLOW');
  assert.deepEqual(loaded.store._getQueue().map(op => op.action), ['upsertBill', 'postBill']);
  assert.equal(loaded.store.getReceptionCache().bills[0].status, 'POSTED');
});

test('recordPayment is idempotent for a repeated stable paymentId while offline', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;
  loaded.store.saveAndPostBill({
    billId: 'BIL-IDEMPOTENT',
    visitId: 'VIS-IDEMPOTENT',
    patientId: 'PAT-IDEMPOTENT',
    billDate: '2026-08-25',
    items: [{ description: 'Consultation', quantity: 1, unitPrice: 500 }],
    discount: 0
  });
  const payment = {
    paymentId: 'LEG-PAY-IDEMPOTENT',
    billId: 'BIL-IDEMPOTENT',
    visitId: 'VIS-IDEMPOTENT',
    patientId: 'PAT-IDEMPOTENT',
    paymentDate: '2026-08-25T10:00:00+05:30',
    amount: 100,
    paymentMode: 'UPI',
    transactionType: 'PAYMENT'
  };
  const first = loaded.store.recordPayment(payment);
  const second = loaded.store.recordPayment(payment);
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');
  assert.equal(loaded.store.getReceptionCache().payments.filter(function (row) { return row.paymentId === payment.paymentId; }).length, 1);
  assert.equal(loaded.store._getQueue().filter(function (op) { return op.action === 'recordPayment' && op.payload.paymentId === payment.paymentId; }).length, 1);
});

test('saveReceipt stores an optimistic receipt and queues a sync operation', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;

  const result = loaded.store.saveReceipt({
    receiptId: 'RCT-TEST-1', receiptDate: '2026-08-22',
    description: 'Manual cash in', amount: 250, paymentMode: 'CASH'
  });

  assert.equal(result.status, 'pending');
  assert.deepEqual(loaded.store.getFinanceCache().receipts.map(r => r.receiptId), ['RCT-TEST-1']);
  assert.equal(loaded.store._getQueue()[0].action, 'upsertReceipt');
});

test('voidReceipt keeps the receipt in local history with VOID status', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;
  loaded.store.saveReceipt({ receiptId: 'RCT-TEST-2', receiptDate: '2026-08-22', description: 'Wrong entry', amount: 100 });

  const result = loaded.store.voidReceipt('RCT-TEST-2', 'Entered twice');

  assert.equal(result.status, 'pending');
  assert.equal(loaded.store.getFinanceCache().receipts[0].status, 'VOID');
  assert.deepEqual(loaded.store._getQueue().map(op => op.action), ['upsertReceipt', 'voidReceipt']);
});

test('saveExpense upgrades an older reception cache without an expenses array', function () {
  const loaded = loadStore({ ok: true });
  loaded.navigator.onLine = false;
  loaded.localStorage.setItem('reception_cache_v1', JSON.stringify({ date: '2026-08-22', bills: [], payments: [] }));

  loaded.store.saveExpense({ expenseId: 'EXP-OLD-CACHE', expenseDate: '2026-08-22', description: 'Rent', amount: 500 });

  assert.equal(loaded.store.getReceptionCache().expenses[0].expenseId, 'EXP-OLD-CACHE');
});

test('refreshFinanceSummary ignores a legacy non-finance response without losing local finance data', async function () {
  const loaded = loadStore({ ok: true, records: [] });
  loaded.localStorage.setItem('finance_cache_v1', JSON.stringify({
    receipts: [{ receiptId: 'RCT-LOCAL', receiptDate: '2026-08-22', amount: 250, paymentMode: 'CASH' }],
    expenses: [], bills: [], payments: []
  }));

  const result = await loaded.store.refreshFinanceSummary('2026-08-22', '2026-08-22');

  assert.equal(result.ok, false);
  assert.equal(loaded.store.getFinanceCache().receipts[0].receiptId, 'RCT-LOCAL');
});
