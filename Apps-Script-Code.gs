var FIELDS = ['timestamp','name','age','gender','phone','address','date',
              'bp','temp','weight','pulse','diagnosis','allergies','medicines',
              'tests','notes','followUp','pmh','billAmount','billPaid','billMode','workDone','instructions','visitId','paymentHistory'];
var BILL_FIELDS = ['timestamp','date','patientName','totalAmount','paidAmount','balance','status'];
// Formal finance bills are kept in their own sheet so the older Bills sheet
// remains readable and backwards compatible.  Every bill has a stable ID,
// which lets retries update the same row instead of creating duplicate debt.
var FINANCE_BILL_FIELDS = ['billId','visitId','patientId','billDate','patientName','phone',
                          'currentCharges','discount','netBillAmount','priorOutstandingSnapshot',
                          'itemsJson','status','createdAt','createdBy','recordVersion'];
var EXP_FIELDS  = ['timestamp','date','category','description','amount'];
var PAYMENT_FIELDS = ['paymentId','billId','patientId','paymentDate','amount','paymentMode','transactionType','reversesPaymentId','status','createdAt','createdBy','recordVersion'];
var RECEIPT_FIELDS = ['receiptId','receiptDate','description','amount','paymentMode','vendor','reference','status','createdAt','createdBy','recordVersion'];
var FINANCE_EXPENSE_FIELDS = ['expenseId','createdAt','expenseDate','expenseType','category','description','amount','paymentMode','vendor','reference','note','status','createdBy','recordVersion'];
var RECEPTION_FIELDS = ['id','timestamp','name','age','gender','phone','address','due','date',
                        'workflowStatus','receptionDone','receptionDoneAt','queueRemovedAt','updatedAt','whatsappOptIn'];
var COLLECTION_TASK_FIELDS = ['taskId','billId','visitId','patientId','patientName','phone',
                              'requestedAmount','collectedAmount','remainingAmount','status',
                              'requestedAt','requestedBy','updatedAt','note','recordVersion'];
// During first deployment this fallback keeps the desktop configuration and
// script in sync. Set the same value as the APP_WRITE_KEY Script Property;
// the property takes precedence and lets the key be rotated without editing code.
var DEFAULT_APP_WRITE_KEY = '';

function mainSheet_() { return SpreadsheetApp.getActiveSpreadsheet().getSheets()[0]; }

function ensureHeader_(sh) {
  var need = FIELDS.length;
  if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,need).setValues([FIELDS]).setFontWeight('bold');
  } else {
    var cur = sh.getRange(1,1,1,need).getValues()[0];
    var same = cur.length === need && FIELDS.every(function (f,i){ return cur[i] === f; });
    if (!same) sh.getRange(1,1,1,need).setValues([FIELDS]).setFontWeight('bold');
  }
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('G:G').setNumberFormat('@');
}

function billSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Bills');
  if (!sh) {
    sh = ss.insertSheet('Bills');
    sh.getRange(1,1,1,BILL_FIELDS.length).setValues([BILL_FIELDS]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('@');
  }
  return sh;
}

function financeBillSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('FinanceBills');
  if (!sh) {
    sh = ss.insertSheet('FinanceBills');
    sh.getRange(1,1,1,FINANCE_BILL_FIELDS.length).setValues([FINANCE_BILL_FIELDS]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('D:D').setNumberFormat('@');
  } else {
    var current = sh.getRange(1,1,1,FINANCE_BILL_FIELDS.length).getValues()[0];
    var headerMatches = current.length === FINANCE_BILL_FIELDS.length && FINANCE_BILL_FIELDS.every(function (field, index) { return current[index] === field; });
    if (!headerMatches) sh.getRange(1,1,1,FINANCE_BILL_FIELDS.length).setValues([FINANCE_BILL_FIELDS]).setFontWeight('bold');
  }
  return sh;
}

function expensesSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Expenses');
  if (!sh) {
    sh = ss.insertSheet('Expenses');
    sh.getRange(1,1,1,EXP_FIELDS.length).setValues([EXP_FIELDS]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('@');
  }
  return sh;
}

function financeExpenseSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('FinanceExpenses');
  if (!sh) {
    sh = ss.insertSheet('FinanceExpenses');
    sh.getRange(1,1,1,FINANCE_EXPENSE_FIELDS.length).setValues([FINANCE_EXPENSE_FIELDS]).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('C:C').setNumberFormat('@');
  }
  return sh;
}

function paymentSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Payments');
  if (!sh) {
    sh = ss.insertSheet('Payments');
    sh.getRange(1,1,1,PAYMENT_FIELDS.length).setValues([PAYMENT_FIELDS]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('D:D').setNumberFormat('@');
  }
  return sh;
}

function receiptSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('FinanceReceipts');
  if (!sh) {
    sh = ss.insertSheet('FinanceReceipts');
    sh.getRange(1,1,1,RECEIPT_FIELDS.length).setValues([RECEIPT_FIELDS]).setFontWeight('bold');
    sh.getRange('B:B').setNumberFormat('@');
  }
  return sh;
}

function dateText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    var tz = (typeof Session !== 'undefined' && Session.getScriptTimeZone) ? Session.getScriptTimeZone() : 'Asia/Kolkata';
    if (typeof Utilities !== 'undefined' && Utilities.formatDate) return Utilities.formatDate(value, tz || 'Asia/Kolkata', 'yyyy-MM-dd');
    return value.toISOString().slice(0, 10);
  }
  var raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  var match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

function rowById_(sheet, fields, idField, id) {
  if (!sheet || !id || sheet.getLastRow() <= 1) return 0;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, fields.length).getValues();
  var index = fields.indexOf(idField);
  for (var i = 0; i < values.length; i++) if (String(values[i][index] || '').trim() === String(id).trim()) return i + 2;
  return 0;
}

function upsertFinanceRow_(sheet, fields, idField, data) {
  var id = String(data[idField] || '').trim();
  var found = rowById_(sheet, fields, idField, id);
  var versionIndex = fields.indexOf('recordVersion');
  if (found) {
    var existing = sheet.getRange(found, 1, 1, fields.length).getValues()[0];
    var currentVersion = versionIndex >= 0 ? String(existing[versionIndex] || '1') : '';
    if (versionIndex >= 0 && String(data.recordVersion || '') !== currentVersion) {
      return { conflict: true, currentVersion: currentVersion };
    }
    if (versionIndex >= 0) data.recordVersion = String(Number(currentVersion) + 1);
    var updatedRow = fields.map(function (field) { return data[field] != null ? data[field] : ''; });
    sheet.getRange(found, 1, 1, fields.length).setValues([updatedRow]);
    return { updated: found };
  }
  if (versionIndex >= 0) data.recordVersion = '1';
  var row = fields.map(function (field) { return data[field] != null ? data[field] : ''; });
  sheet.appendRow(row);
  return { appended: sheet.getLastRow() };
}

function configuredAppWriteKey_() {
  try {
    var stored = String(PropertiesService.getScriptProperties().getProperty('APP_WRITE_KEY') || '').trim();
    return stored || DEFAULT_APP_WRITE_KEY;
  } catch (e) { return DEFAULT_APP_WRITE_KEY; }
}

function hasAppAccess_(data) {
  data = data || {};
  var expected = configuredAppWriteKey_();
  var supplied = String(data.appWriteKey || data.key || (data.payload && data.payload.appWriteKey) || '').trim();
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  var mismatch = 0;
  for (var i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function hasAdminSession_(data) {
  data = data || {};
  return hasAppAccess_(data) && (data.role === 'admin' || data.role === 'doctor') && String(data.sessionToken || '').trim() !== '';
}

function findBill_(billId) {
  var target = String(billId || '').trim();
  if (!target) return null;

  var formalSheet = financeBillSheet_();
  var formalRows = readSheet_(formalSheet, FINANCE_BILL_FIELDS, true);
  for (var i = 0; i < formalRows.length; i++) {
    if (String(formalRows[i].billId || '').trim() === target) {
      return { obj: formalRows[i], rowIndex: formalRows[i].rowIndex, sheet: formalSheet, fields: FINANCE_BILL_FIELDS };
    }
  }

  // Legacy Bills rows can still be read for migration and old data. They are
  // never used as the write target for new formal finance operations.
  var legacyRows = readSheet_(billSheet_(), BILL_FIELDS, true);
  for (var j = 0; j < legacyRows.length; j++) {
    if (String(legacyRows[j].billId || '').trim() === target) {
      return { obj: legacyRows[j], rowIndex: legacyRows[j].rowIndex, sheet: billSheet_(), fields: BILL_FIELDS };
    }
  }
  return null;
}

function findPaymentById_(paymentId) {
  var target = String(paymentId || '').trim();
  if (!target) return null;
  var rows = readSheet_(paymentSheet_(), PAYMENT_FIELDS, true);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].paymentId || '').trim() === target) return rows[i];
  }
  return null;
}

function handleUpsertBill_(data) {
  data = data || {};
  var p = data.payload || data;
  var amount = Number(p.netBillAmount);
  var billDate = dateText_(p.billDate || p.date);
  if (!p.billId || !p.visitId || !p.patientId || !billDate || !String(p.patientName || '').trim() || !isFinite(amount) || amount < 0) {
    return { ok: false, errorCode: 'VALIDATION', message: 'Bill ID, visit, patient, date, name, and a non-negative bill amount are required.' };
  }
  var row = Object.assign({}, p, {
    billDate: billDate,
    status: String(p.status || 'DRAFT').toUpperCase(),
    createdAt: p.createdAt || nowStamp_(),
    createdBy: p.createdBy || data.userId || 'doctor',
    recordVersion: p.recordVersion || '1'
  });
  if (['DRAFT','POSTED','PART_PAID','PAID','VOID'].indexOf(row.status) === -1) {
    return { ok: false, errorCode: 'VALIDATION', message: 'Invalid bill status.' };
  }
  var result = upsertFinanceRow_(financeBillSheet_(), FINANCE_BILL_FIELDS, 'billId', row);
  if (result.conflict) return { ok:false, errorCode:'VERSION_CONFLICT', message:'Bill was changed on another device. Refresh and try again.', recordVersion:result.currentVersion };
  return { ok: true, billId: row.billId, recordVersion: row.recordVersion, updated: result.updated, appended: result.appended };
}

function handleUpsertCollectionTask_(data) {
  data = data || {};
  var p = data.payload || data;
  var requested = Number(p.requestedAmount);
  var collected = Number(p.collectedAmount || 0);
  var remaining = Number(p.remainingAmount);
  var requestedAt = dateText_(p.requestedAt || p.date);
  var status = String(p.status || (remaining <= 0 ? 'COLLECTED' : collected > 0 ? 'PARTIAL' : 'REQUESTED')).toUpperCase();
  var isVoid = status === 'VOID';
  if (!p.taskId || !p.billId || !p.visitId || !p.patientId || !String(p.patientName || '').trim() ||
      !requestedAt || !isFinite(requested) || requested <= 0 || !isFinite(collected) || collected < 0 ||
      !isFinite(remaining) || remaining < 0 || collected > requested || (!isVoid && Math.abs(remaining - (requested - collected)) > 0.01) || (isVoid && remaining !== 0)) {
    return { ok: false, errorCode: 'VALIDATION', message: 'Collection task needs a valid bill, patient, positive requested amount, and matching collected balance.' };
  }
  if (['REQUESTED','PARTIAL','COLLECTED','VOID'].indexOf(status) === -1) {
    return { ok: false, errorCode: 'VALIDATION', message: 'Invalid collection task status.' };
  }
  var bill = findBill_(p.billId);
  if (!bill) return { ok: false, errorCode: 'NOT_FOUND', message: 'Bill was not found.' };
  var billAmount = Number(bill.obj.netBillAmount || bill.obj.totalAmount || 0);
  var paid = getPaymentsForBill_(p.billId).filter(function (payment) { return payment.status !== 'VOID'; }).reduce(function (sum, payment) {
    return sum + (payment.transactionType === 'PAYMENT' ? Number(payment.amount || 0) : -Number(payment.amount || 0));
  }, 0);
  if (remaining > billAmount - paid + 0.01) {
    return { ok: false, errorCode: 'AMOUNT_EXCEEDS_DUE', message: 'Collection amount exceeds the outstanding bill balance.' };
  }
  var row = Object.assign({}, p, {
    requestedAmount: requested,
    collectedAmount: collected,
    remainingAmount: remaining,
    requestedAt: requestedAt,
    status: status,
    requestedBy: p.requestedBy || data.userId || 'doctor',
    updatedAt: p.updatedAt || nowStamp_(),
    recordVersion: p.recordVersion || '1'
  });
  var result = upsertFinanceRow_(collectionTaskSheet_(), COLLECTION_TASK_FIELDS, 'taskId', row);
  if (result.conflict) return { ok:false, errorCode:'VERSION_CONFLICT', message:'Collection task was changed on another device. Refresh and try again.', recordVersion:result.currentVersion };
  return { ok: true, taskId: row.taskId, status: row.status, recordVersion: row.recordVersion, updated: result.updated, appended: result.appended };
}

function handlePostBill_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!p.billId) return { ok: false, errorCode: 'VALIDATION', message: 'billId is required.' };
  var sheet = financeBillSheet_();
  var rowIndex = rowById_(sheet, FINANCE_BILL_FIELDS, 'billId', p.billId);
  if (!rowIndex) return { ok: false, errorCode: 'NOT_FOUND', message: 'Bill was not found.' };
  var row = sheet.getRange(rowIndex, 1, 1, FINANCE_BILL_FIELDS.length).getValues()[0];
  var statusIndex = FINANCE_BILL_FIELDS.indexOf('status');
  if (String(row[statusIndex] || '').toUpperCase() === 'VOID') return { ok: false, errorCode: 'INVALID_STATE', message: 'A void bill cannot be posted.' };
  row[statusIndex] = 'POSTED';
  sheet.getRange(rowIndex, 1, 1, FINANCE_BILL_FIELDS.length).setValues([row]);
  return { ok: true, billId: p.billId, status: 'POSTED' };
}

function handleVoidBill_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!hasAdminSession_(data)) return { ok: false, errorCode: 'FORBIDDEN', message: 'Admin session required.' };
  if (!p.billId) return { ok: false, errorCode: 'VALIDATION', message: 'billId is required.' };
  var sheet = financeBillSheet_();
  var rowIndex = rowById_(sheet, FINANCE_BILL_FIELDS, 'billId', p.billId);
  if (!rowIndex) return { ok: false, errorCode: 'NOT_FOUND', message: 'Bill was not found.' };
  var row = sheet.getRange(rowIndex, 1, 1, FINANCE_BILL_FIELDS.length).getValues()[0];
  row[FINANCE_BILL_FIELDS.indexOf('status')] = 'VOID';
  sheet.getRange(rowIndex, 1, 1, FINANCE_BILL_FIELDS.length).setValues([row]);
  return { ok: true, billId: p.billId, status: 'VOID' };
}

function getPaymentsForBill_(billId) {
  var rows = readSheet_(paymentSheet_(), PAYMENT_FIELDS, false);
  return rows.filter(function (row) { return row.billId === billId; });
}

function handleRecordPayment_(data) {
  data = data || {};
  var p = data.payload || data;
  var type = String(p.transactionType || 'PAYMENT').toUpperCase();
  var mode = String(p.paymentMode || '').toUpperCase();
  if (!p.billId || !p.patientId || ['PAYMENT','REFUND','REVERSAL'].indexOf(type) === -1 || ['CASH','UPI','CARD','BANK','OTHER'].indexOf(mode) === -1) {
    return { ok: false, errorCode: 'VALIDATION', message: 'A valid bill, patient, transaction type, and payment mode are required.' };
  }
  if ((type === 'REFUND' || type === 'REVERSAL') && !hasAdminSession_(data)) return { ok: false, errorCode: 'FORBIDDEN', message: 'Admin session required.' };
  var amount = Number(p.amount);
  if (!isFinite(amount) || amount <= 0) return { ok: false, errorCode: 'VALIDATION', message: 'Amount must be greater than 0.' };
  if (!p.paymentId) return { ok: false, errorCode: 'VALIDATION', message: 'paymentId is required.' };

  // Network retries are expected in offline mode. A payment ID is the
  // idempotency key, so an already stored payment must be acknowledged rather
  // than appended a second time.
  var existingPayment = findPaymentById_(p.paymentId);
  if (existingPayment) return { ok: true, paymentId: existingPayment.paymentId, recordVersion: existingPayment.recordVersion || '1', duplicate: true };

  var bill = findBill_(p.billId);
  if (!bill) return { ok: false, errorCode: 'NOT_FOUND', message: 'Bill was not found.' };
  var payments = getPaymentsForBill_(p.billId);
  var billAmount = Number(bill.obj.netBillAmount || bill.obj.totalAmount || 0);
  var netPaid = payments.filter(function (row) { return row.status !== 'VOID'; }).reduce(function (sum, row) {
    return sum + (row.transactionType === 'PAYMENT' ? Number(row.amount || 0) : -Number(row.amount || 0));
  }, 0);
  if (type === 'PAYMENT' && amount > billAmount - netPaid + 0.01) return { ok: false, errorCode: 'OVERPAYMENT', message: 'Payment exceeds the outstanding bill balance.' };
  if (type === 'REFUND' || type === 'REVERSAL') {
    var original = payments.filter(function (row) { return row.paymentId === p.reversesPaymentId && row.transactionType === 'PAYMENT' && row.status !== 'VOID'; })[0];
    if (!original) return { ok: false, errorCode: 'NOT_FOUND', message: 'Original payment was not found.' };
    var corrected = payments.filter(function (row) { return row.reversesPaymentId === original.paymentId && (row.transactionType === 'REFUND' || row.transactionType === 'REVERSAL') && row.status !== 'VOID'; }).reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0);
    if (amount > Number(original.amount || 0) - corrected + 0.01) return { ok: false, errorCode: 'REFUND_EXCEEDS_ORIGINAL', message: 'Correction exceeds the remaining original payment.' };
  }
  var rowData = Object.assign({}, p, { transactionType: type, status: p.status || 'ACTIVE', createdAt: p.createdAt || nowStamp_(), createdBy: p.createdBy || data.userId || 'receptionist', recordVersion: p.recordVersion || '1' });
  var sheet = (typeof getOrCreatePaymentSheet_ === 'function') ? getOrCreatePaymentSheet_() : paymentSheet_();
  var row = PAYMENT_FIELDS.map(function (field) { return rowData[field] != null ? rowData[field] : ''; });
  sheet.appendRow(row);
  return { ok: true, paymentId: rowData.paymentId, recordVersion: rowData.recordVersion };
}

function handleUpsertExpense_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!p.expenseId || !String(p.description || '').trim() || !(Number(p.amount) > 0)) return { ok: false, errorCode: 'VALIDATION', message: 'Expense ID, description, and positive amount are required.' };
  var row = Object.assign({}, p, { expenseDate: dateText_(p.expenseDate || p.date), status: p.status || 'ACTIVE', createdAt: p.createdAt || nowStamp_(), createdBy: p.createdBy || data.userId || 'receptionist', recordVersion: p.recordVersion || '1' });
  var result = upsertFinanceRow_(financeExpenseSheet_(), FINANCE_EXPENSE_FIELDS, 'expenseId', row);
  if (result.conflict) return { ok:false, errorCode:'VERSION_CONFLICT', message:'Expense was changed on another device. Refresh and try again.', recordVersion:result.currentVersion };
  return { ok: true, expenseId: row.expenseId, recordVersion: row.recordVersion, updated: result.updated, appended: result.appended };
}

function handleVoidExpense_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!p.expenseId) return { ok: false, errorCode: 'VALIDATION', message: 'expenseId is required.' };
  var sheet = financeExpenseSheet_();
  var rowIndex = rowById_(sheet, FINANCE_EXPENSE_FIELDS, 'expenseId', p.expenseId);
  if (!rowIndex) return { ok: false, errorCode: 'NOT_FOUND', message: 'Expense was not found.' };
  var row = sheet.getRange(rowIndex, 1, 1, FINANCE_EXPENSE_FIELDS.length).getValues()[0];
  row[FINANCE_EXPENSE_FIELDS.indexOf('status')] = 'VOID';
  sheet.getRange(rowIndex, 1, 1, FINANCE_EXPENSE_FIELDS.length).setValues([row]);
  return { ok: true, expenseId: p.expenseId, status: 'VOID' };
}

function handleUpsertReceipt_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!p.receiptId || !String(p.description || '').trim() || !(Number(p.amount) > 0)) return { ok: false, errorCode: 'VALIDATION', message: 'Receipt ID, description, and positive amount are required.' };
  var row = Object.assign({}, p, { receiptDate: dateText_(p.receiptDate || p.date), status: p.status || 'ACTIVE', createdAt: p.createdAt || nowStamp_(), createdBy: p.createdBy || data.userId || 'receptionist', recordVersion: p.recordVersion || '1' });
  var result = upsertFinanceRow_(receiptSheet_(), RECEIPT_FIELDS, 'receiptId', row);
  if (result.conflict) return { ok:false, errorCode:'VERSION_CONFLICT', message:'Receipt was changed on another device. Refresh and try again.', recordVersion:result.currentVersion };
  return { ok: true, receiptId: row.receiptId, recordVersion: row.recordVersion, updated: result.updated, appended: result.appended };
}

function handleVoidReceipt_(data) {
  data = data || {};
  var p = data.payload || data;
  if (!p.receiptId) return { ok: false, errorCode: 'VALIDATION', message: 'receiptId is required.' };
  var sheet = receiptSheet_();
  var rowIndex = rowById_(sheet, RECEIPT_FIELDS, 'receiptId', p.receiptId);
  if (!rowIndex) return { ok: false, errorCode: 'NOT_FOUND', message: 'Receipt was not found.' };
  var row = sheet.getRange(rowIndex, 1, 1, RECEIPT_FIELDS.length).getValues()[0];
  row[RECEIPT_FIELDS.indexOf('status')] = 'VOID';
  sheet.getRange(rowIndex, 1, 1, RECEIPT_FIELDS.length).setValues([row]);
  return { ok: true, receiptId: p.receiptId, status: 'VOID' };
}

function legacyStableLedgerId_(prefix, seed) {
  var text = String(seed == null ? '' : seed);
  var hash = 2166136261;
  for (var i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String(prefix || 'LEG').toUpperCase() + '-' + (hash >>> 0).toString(36).toUpperCase();
}

function parseLegacyHistory_(value) {
  if (Array.isArray(value)) return value;
  if (!String(value == null ? '' : value).trim()) return [];
  try {
    var parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function normalizeLegacyPaymentHistory_(row) {
  row = row || {};
  var warnings = [];
  var billAmountRaw = parseFloat(row.billAmount);
  var billAmount = isFinite(billAmountRaw) && billAmountRaw > 0 ? Math.round(billAmountRaw * 100) / 100 : 0;
  var billPaidRaw = parseFloat(row.billPaid);
  if (!isFinite(billPaidRaw)) billPaidRaw = 0;
  if (billPaidRaw < 0 || billPaidRaw > billAmount) warnings.push('aggregate billPaid was outside the bill range and was clamped');
  var billPaid = Math.round(Math.min(billAmount, Math.max(0, billPaidRaw)) * 100) / 100;
  var date = dateText_(row.date);
  var patientKey = String(row.patientId || [row.name, row.phone].join('|')).trim();
  var visitKey = String(row.visitId || [row.name, row.phone, date].join('|')).trim();
  var patientId = String(row.patientId || legacyStableLedgerId_('LEG-PAT', patientKey));
  var visitId = String(row.visitId || legacyStableLedgerId_('LEG-VIS', visitKey));
  var billId = String(row.billId || legacyStableLedgerId_('LEG-BIL', visitId));
  var history = parseLegacyHistory_(row.paymentHistory);
  var payments = [];
  var eventPayments = 0;
  var eventFees = 0;
  var allowedModes = { CASH: true, UPI: true, CARD: true, BANK: true, OTHER: true };
  function round2(value) { return Math.round(value * 100) / 100; }
  history.forEach(function (event, eventIndex) {
    if (!event || typeof event !== 'object') {
      warnings.push('paymentHistory event ' + eventIndex + ' ignored: event is malformed');
      return;
    }
    var type = String(event.type || event.transactionType || '').trim().toLowerCase();
    if (type !== 'payment' && type !== 'fee') {
      warnings.push('paymentHistory event ' + eventIndex + ' ignored: type is not payment or fee');
      return;
    }
    var rawAmount = parseFloat(event.amount);
    if (!isFinite(rawAmount) || rawAmount <= 0) {
      warnings.push('paymentHistory event ' + eventIndex + ' ignored: amount must be positive');
      return;
    }
    var amount = round2(rawAmount);
    var eventDate = event.date || event.paymentDate || event.timestamp || '';
    if (!eventDate) eventDate = row.timestamp || row.date || '';
    if (!eventDate || isNaN(new Date(eventDate).getTime())) {
      warnings.push('paymentHistory event ' + eventIndex + ' ignored: date is invalid');
      return;
    }
    if (type === 'fee') {
      eventFees = round2(eventFees + amount);
      return;
    }
    if (round2(eventPayments + amount) > billPaid + 0.01) {
      warnings.push('paymentHistory event ' + eventIndex + ' ignored: amount exceeds aggregate paid amount');
      return;
    }
    var mode = String(event.mode || event.paymentMode || row.billMode || 'CASH').toUpperCase();
    if (!allowedModes[mode]) {
      mode = 'OTHER';
      warnings.push('paymentHistory event ' + eventIndex + ' used OTHER payment mode');
    }
    var paymentId = String(event.paymentId || legacyStableLedgerId_(
      'LEG-PAY', billId + '|history|' + eventIndex + '|payment|' + eventDate + '|' + amount
    ));
    payments.push({
      paymentId: paymentId, billId: billId, visitId: visitId, patientId: patientId,
      patientName: row.name || row.patientName || '', name: row.name || row.patientName || '',
      phone: row.phone || '', paymentDate: String(eventDate), amount: amount,
      paymentMode: mode, transactionType: 'PAYMENT', status: 'ACTIVE',
      source: 'paymentHistory', eventIndex: eventIndex,
      note: event.note || 'Imported from paymentHistory'
    });
    eventPayments = round2(eventPayments + amount);
  });
  var basePaid = round2(Math.max(0, billPaid - eventPayments));
  return {
    billAmount: billAmount, billPaid: billPaid, eventPayments: eventPayments,
    eventFees: eventFees, basePaid: basePaid, payments: payments,
    warnings: warnings, billId: billId, visitId: visitId, patientId: patientId
  };
}

function financeSummary_(params) {
  params = params || {};
  var from = dateText_(params.from), to = dateText_(params.to);
  function inRange(row, fields) { var date = dateText_(fields.reduce(function (value, field) { return value || row[field]; }, '')); return (!from || date >= from) && (!to || date <= to); }
  var bills = readSheet_(billSheet_(), BILL_FIELDS, false).filter(function (row) { return inRange(row, ['date']); });
  var allFormalPayments = readSheet_(paymentSheet_(), PAYMENT_FIELDS, false);
  var formalPaymentIds = {};
  allFormalPayments.forEach(function (row) {
    if (row && row.paymentId) formalPaymentIds[String(row.paymentId)] = true;
  });
  var payments = allFormalPayments.filter(function (row) { return inRange(row, ['paymentDate','createdAt']); });
  var receipts = readSheet_(receiptSheet_(), RECEIPT_FIELDS, false).filter(function (row) { return inRange(row, ['receiptDate','createdAt']); });
  var financeExpenses = readSheet_(financeExpenseSheet_(), FINANCE_EXPENSE_FIELDS, false).filter(function (row) { return inRange(row, ['expenseDate','createdAt']); });
  var legacyExpenses = readSheet_(expensesSheet_(), EXP_FIELDS, false).filter(function (row) { return inRange(row, ['date']); }).map(function (row, index) { return { expenseId: 'LEGACY-EXP-' + (index + 2), expenseDate: dateText_(row.date), category: row.category, description: row.description, amount: row.amount, paymentMode: 'OTHER', status: 'ACTIVE', source: 'legacy-expense' }; });
  var expenses = financeExpenses.concat(legacyExpenses);
  var mainRecords = readSheet_(mainSheet_(), FIELDS, false).filter(function (row) { return inRange(row, ['date']); });
  var patientFees = [];
  var compatibilityPayments = [];
  mainRecords.forEach(function (row) {
    var normalized = normalizeLegacyPaymentHistory_(row);
    var date = dateText_(row.date);
    if (normalized.billPaid > 0) {
      patientFees.push({
        billId: normalized.billId, patientId: normalized.patientId, visitId: normalized.visitId,
        patientName: row.name, name: row.name, phone: row.phone, date: date,
        timestamp: row.timestamp, billAmount: normalized.billAmount,
        billPaid: normalized.basePaid, billMode: row.billMode, source: 'legacy-patient-fee'
      });
    }
    normalized.payments.forEach(function (payment) {
      if (payment.source !== 'paymentHistory' || formalPaymentIds[payment.paymentId]) return;
      if (inRange(payment, ['paymentDate'])) compatibilityPayments.push(payment);
    });
  });
  payments = payments.concat(compatibilityPayments);
  var completedVisits = mainRecords.filter(function (row) { return !(Number(row.billPaid || 0) > 0); }).map(function (row) {
    var date = dateText_(row.date);
    return { visitId: [row.name, row.phone, date].join('|'), patientName: row.name, name: row.name, phone: row.phone, date: date, timestamp: row.timestamp, completedAt: row.timestamp };
  });
  var mainVisitKeys = {};
  mainRecords.forEach(function (row) {
    var date = dateText_(row.date);
    mainVisitKeys[[row.name, row.phone, date].join('|').toLowerCase()] = true;
  });
  var receptionRecords = readSheet_(receptionSheet_(), RECEPTION_FIELDS, false).filter(function (row) {
    return inRange(row, ['date','receptionDoneAt','updatedAt','timestamp']) && (row.receptionDone === true || String(row.receptionDone).toLowerCase() === 'true' || row.workflowStatus === 'finalized');
  });
  receptionRecords.forEach(function (row) {
    var date = dateText_(row.date);
    var visitKey = [row.name, row.phone, date].join('|');
    if (mainVisitKeys[visitKey.toLowerCase()]) return;
    completedVisits.push({ visitId: visitKey, patientName: row.name, name: row.name, phone: row.phone, date: date, timestamp: row.timestamp, completedAt: row.receptionDoneAt || row.updatedAt || row.timestamp, source: 'reception' });
  });
  var formalBills = readSheet_(financeBillSheet_(), FINANCE_BILL_FIELDS, false).filter(function (row) { return inRange(row, ['billDate','createdAt']); });
  return { ok: true, from: from, to: to, bills: bills.concat(formalBills), payments: payments, receipts: receipts, expenses: expenses, patientFees: patientFees, completedVisits: completedVisits,
    totalCollected: payments.filter(function (row) { return row.status !== 'VOID' && row.transactionType === 'PAYMENT'; }).reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0),
    totalExpenses: expenses.filter(function (row) { return row.status !== 'VOID'; }).reduce(function (sum, row) { return sum + Number(row.amount || 0); }, 0) };
}

function receptionistDay_(dateValue) {
  var target = dateText_(dateValue);
  var reception = readSheet_(receptionSheet_(), RECEPTION_FIELDS, false).filter(function (row) { return dateText_(row.date) === target; });
  var collectionTasks = readSheet_(collectionTaskSheet_(), COLLECTION_TASK_FIELDS, false).filter(function (row) {
    return String(row.status || '').toUpperCase() !== 'VOID' &&
      (String(row.status || '').toUpperCase() !== 'COLLECTED' || dateText_(row.updatedAt || row.requestedAt) === target);
  });
  var formalBills = readSheet_(financeBillSheet_(), FINANCE_BILL_FIELDS, false).filter(function (row) { return dateText_(row.billDate) === target; });
  var activeTaskBills = {};
  collectionTasks.forEach(function (task) { if (task.billId) activeTaskBills[String(task.billId)] = true; });
  var taskBills = readSheet_(financeBillSheet_(), FINANCE_BILL_FIELDS, false).filter(function (row) {
    return activeTaskBills[String(row.billId)] && !formalBills.some(function (bill) { return bill.billId === row.billId; });
  });
  var legacyBills = readSheet_(billSheet_(), BILL_FIELDS, false).filter(function (row) { return dateText_(row.date) === target; });
  var payments = readSheet_(paymentSheet_(), PAYMENT_FIELDS, false).filter(function (row) {
    return dateText_(row.paymentDate || row.createdAt) === target || activeTaskBills[String(row.billId)];
  });
  var financeExpenses = readSheet_(financeExpenseSheet_(), FINANCE_EXPENSE_FIELDS, false).filter(function (row) { return dateText_(row.expenseDate || row.createdAt) === target; });
  var legacyExpenses = readSheet_(expensesSheet_(), EXP_FIELDS, false).filter(function (row) { return dateText_(row.date) === target; });
  return { ok: true, date: target, appointments: reception, bills: legacyBills.concat(formalBills, taskBills), payments: payments,
    expenses: financeExpenses.concat(legacyExpenses), collectionTasks: collectionTasks, closing: null };
}

function receptionSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Reception');
  if (!sh) {
    sh = ss.insertSheet('Reception');
    sh.getRange(1,1,1,RECEPTION_FIELDS.length).setValues([RECEPTION_FIELDS]).setFontWeight('bold');
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1,1,1,RECEPTION_FIELDS.length).setValues([RECEPTION_FIELDS]).setFontWeight('bold');
  }
  sh.getRange('A:A').setNumberFormat('@');
  sh.getRange('B:B').setNumberFormat('@');
  sh.getRange('I:I').setNumberFormat('@');
  return sh;
}

function collectionTaskSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('CollectionTasks');
  if (!sh) {
    sh = ss.insertSheet('CollectionTasks');
    sh.getRange(1,1,1,COLLECTION_TASK_FIELDS.length).setValues([COLLECTION_TASK_FIELDS]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('K:K').setNumberFormat('@');
  }
  return sh;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function nowStamp_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'); }

// Reads every data row of a sheet into an array of field-keyed objects.
// withRowIndex adds the true sheet row number (needed so records can be deleted).
function readSheet_(sh, fields, withRowIndex) {
  var out = [];
  if (!sh) return out;
  var last = sh.getLastRow();
  if (last <= 1) return out;
  var values = sh.getRange(2, 1, last - 1, fields.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var row = values[i], obj = {}, hasData = false;
    for (var c = 0; c < fields.length; c++) {
      obj[fields[c]] = row[c];
      if (String(row[c] == null ? '' : row[c]).trim()) hasData = true;
    }
    if (!hasData) continue;                 // skip fully blank rows
    if (withRowIndex) obj.rowIndex = i + 2; // real sheet row (header is row 1)
    out.push(obj);
  }
  return out;
}

// Keep only records whose 'date' (YYYY-MM-DD) falls in the given month/year.
// month is 1-12. If either is missing, no filtering is applied.
function filterByMonth_(records, month, year) {
  if (!month || !year) return records;
  return records.filter(function (r) {
    var m = String(r.date == null ? '' : r.date).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month;
  });
}

// doGet(e):
//   • no 'sheet' param            → main prescriptions sheet, ALL rows, with rowIndex
//                                    (used by the app's Patient Records search + delete)
//   • sheet=Prescriptions&month&year → main sheet, filtered to that month
//   • sheet=Bills&month&year         → Bills sheet, filtered to that month
//   • sheet=Expenses&month&year      → Expenses sheet, filtered to that month
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!hasAppAccess_(p)) return json_({ ok:false, errorCode:'UNAUTHORIZED', message:'Valid app access key required.' });
    if (p.action === 'financeSummary') return json_(financeSummary_(p));
    if (p.action === 'receptionistDay') return json_(receptionistDay_(p.date));
    var sheetName = p.sheet || '';
    var month = p.month ? parseInt(p.month, 10) : 0;
    var year  = p.year  ? parseInt(p.year, 10)  : 0;

    var records;
    if (!sheetName || /^prescriptions?$/i.test(sheetName)) {
      var sh = mainSheet_(); ensureHeader_(sh);
      records = readSheet_(sh, FIELDS, true);
    } else if (sheetName === 'Bills') {
      records = readSheet_(billSheet_(), BILL_FIELDS, false);
    } else if (sheetName === 'Expenses') {
      records = readSheet_(expensesSheet_(), EXP_FIELDS, false);
    } else if (sheetName === 'FinanceExpenses') {
      records = readSheet_(financeExpenseSheet_(), FINANCE_EXPENSE_FIELDS, false);
    } else if (sheetName === 'Payments') {
      records = readSheet_(paymentSheet_(), PAYMENT_FIELDS, false);
    } else if (sheetName === 'FinanceReceipts') {
      records = readSheet_(receiptSheet_(), RECEIPT_FIELDS, false);
    } else if (sheetName === 'Reception') {
      records = readSheet_(receptionSheet_(), RECEPTION_FIELDS, false);
    } else {
      records = [];
    }

    records = filterByMonth_(records, month, year);
    return json_({ ok:true, records:records });
  } catch (err) { return json_({ ok:false, error:String(err) }); }
}

function upsertReception_(data) {
  var lock = null;
  try {
    lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
    if (lock) lock.waitLock(10000);
    var sheet = receptionSheet_();
    var row = RECEPTION_FIELDS.map(function (key) { return data[key] != null ? data[key] : ''; });
    var idIndex = RECEPTION_FIELDS.indexOf('id');
    var targetId = String(data.id || '').trim();
    var foundRow = 0;
    if (targetId && sheet.getLastRow() > 1) {
      var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, RECEPTION_FIELDS.length).getValues();
      for (var i = 0; i < existing.length; i++) {
        if (String(existing[i][idIndex] || '').trim() === targetId) { foundRow = i + 2; break; }
      }
    }
    if (foundRow) {
      sheet.getRange(foundRow, 1, 1, RECEPTION_FIELDS.length).setValues([row]);
      return json_({ ok:true, sheet:'Reception', updated:foundRow });
    }
    sheet.appendRow(row);
    return json_({ ok:true, sheet:'Reception', appended:sheet.getLastRow() });
  } catch (err) {
    return json_({ ok:false, sheet:'Reception', error:String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function deleteReception_(data) {
  var lock = null;
  try {
    lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
    if (lock) lock.waitLock(10000);
    var sheet = receptionSheet_();
    var targetId = String(data.id || '').trim();
    if (!targetId || sheet.getLastRow() <= 1) return json_({ ok:true, sheet:'Reception', deleted:false });
    var idIndex = RECEPTION_FIELDS.indexOf('id');
    var existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, RECEPTION_FIELDS.length).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][idIndex] || '').trim() === targetId) {
        sheet.deleteRow(i + 2);
        return json_({ ok:true, sheet:'Reception', deleted:true });
      }
    }
    return json_({ ok:true, sheet:'Reception', deleted:false });
  } catch (err) {
    return json_({ ok:false, sheet:'Reception', error:String(err) });
  } finally {
    if (lock) lock.releaseLock();
  }
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (!hasAppAccess_(data)) return json_({ ok:false, errorCode:'UNAUTHORIZED', message:'Valid app access key required.' });

    if (data && data.action === 'upsertBill') return json_(handleUpsertBill_(data));
    if (data && data.action === 'upsertCollectionTask') return json_(handleUpsertCollectionTask_(data));
    if (data && data.action === 'postBill') return json_(handlePostBill_(data));
    if (data && data.action === 'voidBill') return json_(handleVoidBill_(data));
    if (data && data.action === 'recordPayment') return json_(handleRecordPayment_(data));
    if (data && data.action === 'upsertExpense') return json_(handleUpsertExpense_(data));
    if (data && data.action === 'voidExpense') return json_(handleVoidExpense_(data));
    if (data && data.action === 'upsertReceipt') return json_(handleUpsertReceipt_(data));
    if (data && data.action === 'voidReceipt') return json_(handleVoidReceipt_(data));

    if (data && data.action === 'delete') {
      var sh = mainSheet_(); var ri = parseInt(data.rowIndex,10);
      if (ri >= 2 && ri <= sh.getLastRow()) sh.deleteRow(ri);
      return json_({ ok:true, deleted:ri });
    }

    if (data && data.sheet === 'Bills') {
      var bsh = billSheet_();
      bsh.appendRow([ nowStamp_(), data.date||'', data.patientName||'',
                      data.totalAmount||'', data.paidAmount||'', data.balance||'', data.status||'' ]);
      return json_({ ok:true, sheet:'Bills' });
    }

    if (data && data.sheet === 'Expenses') {
      var esh = expensesSheet_();
      esh.appendRow([ nowStamp_(), data.date||'', data.category||'', data.description||'', data.amount||'' ]);
      return json_({ ok:true, sheet:'Expenses' });
    }

    if (data && data.sheet === 'Reception' && data.action === 'deleteReception') return deleteReception_(data);
    if (data && data.sheet === 'Reception') return upsertReception_(data);

    var sheet = mainSheet_(); ensureHeader_(sheet);
    var row = FIELDS.map(function (k){
      if (k === 'paymentHistory') return data[k] == null ? '' : JSON.stringify(data[k]);
      return data[k] != null ? data[k] : '';
    });

    var iName = FIELDS.indexOf('name'), iPhone = FIELDS.indexOf('phone'), iDate = FIELDS.indexOf('date'), iVisitId = FIELDS.indexOf('visitId');
    var key = function (n,p,d){ return String(n||'').trim().toLowerCase()+'|'+String(p||'').trim()+'|'+String(d||'').trim(); };
    var want = key(data.name, data.phone, data.date);
    var requestedVisitId = String(data.visitId || '').trim();

    var last = sheet.getLastRow(), foundRow = 0;
    if (last > 1 && String(data.name||'').trim()) {
      var existing = sheet.getRange(2,1,last-1,FIELDS.length).getValues();
      for (var i=0;i<existing.length;i++){
        var samePatientDay = key(existing[i][iName], existing[i][iPhone], existing[i][iDate]) === want;
        var storedVisitId = iVisitId >= 0 ? String(existing[i][iVisitId] || '').trim() : '';
        if (requestedVisitId && storedVisitId === requestedVisitId) { foundRow = i+2; break; }
        // Migrate an existing legacy row once. New records always retain a
        // unique visitId, allowing multiple clinical visits on the same day.
        if (requestedVisitId && !storedVisitId && samePatientDay) { foundRow = i+2; break; }
        if (!requestedVisitId && samePatientDay) { foundRow = i+2; break; }
      }
    }

    if (foundRow) { sheet.getRange(foundRow,1,1,FIELDS.length).setValues([row]); return json_({ ok:true, updated:foundRow }); }
    sheet.appendRow(row); return json_({ ok:true, appended:sheet.getLastRow() });
  } catch (err) { return json_({ ok:false, error:String(err) }); }
}
