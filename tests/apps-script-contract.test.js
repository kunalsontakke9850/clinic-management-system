'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FinanceCore = require('../finance-core.js');
const scriptSource = fs.readFileSync(path.join(__dirname, '..', 'Apps-Script-Code.gs'), 'utf8');

test('finance summary exposes main-record fees and completed visits', function () {
  assert.match(scriptSource, /patientFees/);
  assert.match(scriptSource, /completedVisits/);
});

test('Apps Script preserves paymentHistory at the end of the main schema', function () {
  assert.match(scriptSource, /'workDone','instructions','visitId','paymentHistory'/);
  assert.match(scriptSource, /function normalizeLegacyPaymentHistory_\(/);
  assert.match(scriptSource, /LEG-PAY/);
  assert.match(scriptSource, /source:\s*['"]paymentHistory['"]/);
});

test('Apps Script legacy normalizer matches FinanceCore history IDs and totals', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  const row = {
    name: 'History Patient', phone: '0000000002', date: '2026-08-25',
    billAmount: 1000, billPaid: 700, billMode: 'CASH',
    paymentHistory: [
      { type: 'payment', amount: 200, date: '2026-08-25T09:00:00+05:30', mode: 'UPI' },
      { type: 'payment', amount: 300, date: '2026-08-25T10:00:00+05:30', mode: 'CARD' },
      { type: 'fee', amount: 150, date: '2026-08-25' }
    ]
  };
  const server = context.normalizeLegacyPaymentHistory_(row);
  const client = FinanceCore.normalizePatientPaymentHistory(row);
  assert.equal(server.eventPayments, client.eventPayments);
  assert.equal(server.eventFees, client.eventFees);
  assert.equal(server.payments[0].paymentId, client.payments[0].paymentId);
  assert.equal(server.payments[1].paymentId, client.payments[1].paymentId);
  assert.equal(server.billId, client.billId);
});

test('Apps Script serializes paymentHistory before writing the main sheet row', function () {
  assert.match(scriptSource, /k\s*===\s*['"]paymentHistory['"][\s\S]*JSON\.stringify/);
});

test('Apps Script exposes formal bill actions used by FinanceStore', function () {
  assert.match(scriptSource, /data\.action === 'upsertBill'/);
  assert.match(scriptSource, /data\.action === 'postBill'/);
  assert.match(scriptSource, /data\.action === 'voidBill'/);
});

test('prescription persistence identifies new visits by visitId instead of overwriting same-day visits', function () {
  assert.match(scriptSource, /'visitId'/);
  assert.match(scriptSource, /iVisitId/);
  assert.match(scriptSource, /storedVisitId/);
});

test('finance summary reads completed reception visits', function () {
  assert.match(scriptSource, /receptionSheet_\(\)/);
  assert.match(scriptSource, /receptionRecords/);
});

test('reception day reads use the server endpoint expected by FinanceStore', function () {
  assert.match(scriptSource, /p\.action === 'receptionistDay'/);
  assert.match(scriptSource, /function receptionistDay_\(/);
});

test('Apps Script exposes the visual collection-task contract', function () {
  assert.match(scriptSource, /COLLECTION_TASK_FIELDS/);
  assert.match(scriptSource, /data\.action === 'upsertCollectionTask'/);
  assert.match(scriptSource, /collectionTasks/);
});

test('Apps Script rejects cloud requests unless the configured private application key matches', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  context.PropertiesService = {
    getScriptProperties() {
      return { getProperty(name) { return name === 'APP_WRITE_KEY' ? 'private-key' : ''; } };
    }
  };

  assert.equal(context.hasAppAccess_({ appWriteKey: 'wrong-key' }), false);
  assert.equal(context.hasAppAccess_({ appWriteKey: 'private-key' }), true);
});

test('Apps Script validates and upserts a collection task', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  context.collectionTaskSheet_ = function () { return {}; };
  context.upsertFinanceRow_ = function () { return { appended: 9 }; };
  context.dateText_ = function (value) { return String(value); };
  context.nowStamp_ = function () { return '2026-08-23T10:00:00+05:30'; };
  context.findBill_ = function () { return { obj: { billId: 'BIL-1', netBillAmount: 3000 } }; };
  context.getPaymentsForBill_ = function () { return []; };

  const result = context.handleUpsertCollectionTask_({
    userId: 'doctor',
    payload: {
      taskId: 'COL-1', billId: 'BIL-1', visitId: 'VIS-1', patientId: 'PAT-1',
      patientName: 'Kunal', requestedAmount: 3000, collectedAmount: 0,
      remainingAmount: 3000, status: 'REQUESTED', requestedAt: '2026-08-23'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.taskId, 'COL-1');
  assert.equal(result.appended, 9);
});

test('Apps Script rejects a collection task that exceeds the bill outstanding amount', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  context.collectionTaskSheet_ = function () { return {}; };
  context.upsertFinanceRow_ = function () { return { appended: 9 }; };
  context.dateText_ = function (value) { return String(value); };
  context.nowStamp_ = function () { return '2026-08-23T10:00:00+05:30'; };
  context.findBill_ = function () { return { obj: { billId: 'BIL-1', netBillAmount: 3000 } }; };
  context.getPaymentsForBill_ = function () { return [{ amount: 1000, transactionType: 'PAYMENT', status: 'ACTIVE' }]; };

  const result = context.handleUpsertCollectionTask_({
    payload: {
      taskId: 'COL-OVER', billId: 'BIL-1', visitId: 'VIS-1', patientId: 'PAT-1',
      patientName: 'Kunal', requestedAmount: 2500, collectedAmount: 0,
      remainingAmount: 2500, status: 'REQUESTED', requestedAt: '2026-08-23'
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'AMOUNT_EXCEEDS_DUE');
});

test('Apps Script permits a collection request to be voided when the doctor records the payment', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  context.findBill_ = function () { return { obj: { netBillAmount: 3000 } }; };
  context.getPaymentsForBill_ = function () { return [{ amount: 3000, transactionType: 'PAYMENT', status: 'ACTIVE' }]; };
  context.collectionTaskSheet_ = function () { return { getLastRow() { return 0; }, appendRow() {} }; };

  const result = context.handleUpsertCollectionTask_({
    payload: {
      taskId: 'COL-VOID', billId: 'BIL-1', visitId: 'VIS-1', patientId: 'PAT-1', patientName: 'Kunal',
      requestedAmount: 3000, collectedAmount: 0, remainingAmount: 0, status: 'VOID', requestedAt: '2026-08-23', updatedAt: '2026-08-23T10:00:00Z'
    }
  });

  assert.equal(result.ok, true);
});

test('Apps Script validates and upserts a formal finance bill payload', function () {
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  vm.runInContext(scriptSource, context, { filename: 'Apps-Script-Code.gs' });
  context.financeBillSheet_ = function () { return {}; };
  context.upsertFinanceRow_ = function () { return { updated: 4 }; };
  context.nowStamp_ = function () { return '2026-08-22T10:00:00+05:30'; };
  const result = context.handleUpsertBill_({
    userId: 'doctor',
    payload: {
      billId: 'BIL-1', visitId: 'VIS-1', patientId: 'PAT-1', billDate: '2026-08-22',
      patientName: 'Kunal', netBillAmount: 500, status: 'DRAFT'
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.billId, 'BIL-1');
  assert.equal(result.updated, 4);
});

function paymentHarness(existingPayments, adminSession) {
  const appended = [];
  const context = { console, JSON, Date, Math, Object, Array, String, Number, parseFloat, parseInt, isFinite };
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, '..', 'Apps-Script-Code.gs'), 'utf8');
  vm.runInContext(source, context, { filename: 'Apps-Script-Code.gs' });

  context.isBusinessDateClosed_ = function () { return false; };
  context.hasAdminSession_ = function () { return !!adminSession; };
  context.LockService = { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } };
  context.findBill_ = function () { return { obj: { billId: 'BIL-1', patientId: 'PAT-1', netBillAmount: 1000, status: 'POSTED' }, rowIndex: 2 }; };
  context.findPaymentById_ = function (paymentId) {
    return (existingPayments || []).find(function (row) { return row.paymentId === paymentId; }) || null;
  };
  context.getPaymentsForBill_ = function () { return existingPayments || []; };
  context.getOrCreatePaymentSheet_ = function () { return { appendRow(row) { appended.push(row); } }; };
  context.ensureHeaders_ = function () {
    const map = {};
    context.PAYMENT_FIELDS.forEach(function (field, index) { map[field] = index + 1; });
    return map;
  };
  context.nowStamp_ = function () { return '2026-08-21T10:00:00+05:30'; };
  context.updateBillStatus_ = function () {};
  context.appendAudit_ = function () {};
  context.recordOperation_ = function () {};
  return { context, appended };
}

function correctionPayload(overrides) {
  return {
    operationId: 'OP-1',
    userId: 'doctor',
    role: 'admin',
    sessionToken: 'SESSION',
    appVersion: '3.6.1',
    payload: Object.assign({
      paymentId: 'PAY-NEW', billId: 'BIL-1', patientId: 'PAT-1',
      paymentDate: '2026-08-21T10:00:00+05:30', amount: 100,
      paymentMode: 'CASH', transactionType: 'REFUND', reversesPaymentId: 'PAY-ORIGINAL'
    }, overrides || {})
  };
}

test('Apps Script rejects a payment without a bill reference', function () {
  const harness = paymentHarness([], false);
  const result = harness.context.handleRecordPayment_(correctionPayload({ billId: '', transactionType: 'PAYMENT' }));
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'VALIDATION');
  assert.equal(harness.appended.length, 0);
});

test('Apps Script treats a retried payment ID as idempotent', function () {
  const harness = paymentHarness([{ paymentId: 'PAY-ORIGINAL', billId: 'BIL-1', patientId: 'PAT-1', amount: 500, transactionType: 'PAYMENT', status: 'ACTIVE' }], false);
  const result = harness.context.handleRecordPayment_(correctionPayload({ paymentId: 'PAY-ORIGINAL', transactionType: 'PAYMENT', amount: 500 }));
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(harness.appended.length, 0);
});

test('Apps Script rejects a refund without a valid admin session', function () {
  const harness = paymentHarness([{ paymentId: 'PAY-ORIGINAL', amount: 500, transactionType: 'PAYMENT', status: 'ACTIVE' }], false);
  const result = harness.context.handleRecordPayment_(correctionPayload());
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'FORBIDDEN');
  assert.equal(harness.appended.length, 0);
});

test('Apps Script rejects cumulative refunds above the original payment', function () {
  const harness = paymentHarness([
    { paymentId: 'PAY-ORIGINAL', amount: 500, transactionType: 'PAYMENT', status: 'ACTIVE' },
    { paymentId: 'PAY-R1', amount: 450, transactionType: 'REFUND', reversesPaymentId: 'PAY-ORIGINAL', status: 'ACTIVE' }
  ], true);
  const result = harness.context.handleRecordPayment_(correctionPayload({ amount: 100 }));
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'REFUND_EXCEEDS_ORIGINAL');
  assert.equal(harness.appended.length, 0);
});

test('Apps Script accepts a referenced partial refund within the remaining amount', function () {
  const harness = paymentHarness([{ paymentId: 'PAY-ORIGINAL', amount: 500, transactionType: 'PAYMENT', status: 'ACTIVE' }], true);
  const result = harness.context.handleRecordPayment_(correctionPayload({ amount: 125 }));
  assert.equal(result.ok, true);
  assert.equal(result.paymentId, 'PAY-NEW');
  assert.equal(harness.appended.length, 1);
});

test('Apps Script normalizes a Sheets Date value before period filtering', function () {
  const harness = paymentHarness([], false);
  harness.context.Utilities = { formatDate() { return '2026-08-21'; } };
  harness.context.Session = { getScriptTimeZone() { return 'Asia/Kolkata'; } };
  assert.equal(harness.context.dateText_(new Date('2026-08-20T18:30:00Z')), '2026-08-21');
});
