/* Finance/Cashbook presentation and interaction helpers for the clinic app. */
(function (root) {
  'use strict';

  function text(value) { return String(value == null ? '' : value).trim(); }

  function legacyKey(row) {
    row = row || {};
    return [row.expenseDate || row.date || '', row.description || '', Number(row.amount) || 0].join('|').toLowerCase();
  }

  function mergeLegacyExpenses(financeExpenses, legacyExpenses) {
    var merged = [];
    var known = {};
    (Array.isArray(financeExpenses) ? financeExpenses : []).forEach(function (row) {
      if (!row || known[legacyKey(row)]) return;
      merged.push(Object.assign({}, row));
      known[legacyKey(row)] = true;
    });
    (Array.isArray(legacyExpenses) ? legacyExpenses : []).forEach(function (row) {
      if (!row || known[legacyKey(row)]) return;
      merged.push(Object.assign({}, row, {
        source: 'legacy-expense',
        status: row.status || 'ACTIVE',
        expenseDate: row.expenseDate || row.date || '',
        expenseId: row.expenseId || ('LEGACY-' + text(row.id || legacyKey(row)))
      }));
      known[legacyKey(row)] = true;
    });
    return merged;
  }

  function validateEntry(entry) {
    entry = entry || {};
    var errors = [];
    if (!text(entry.description)) errors.push('Description is required.');
    if (!(Number(entry.amount) > 0)) errors.push('Amount must be greater than 0.');
    return { valid: errors.length === 0, errors: errors };
  }

  function today() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function money(value) {
    if (root && root.FinanceCore && root.FinanceCore.formatINR) return root.FinanceCore.formatINR(value);
    return '₹' + (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function esc(value) {
    if (root && typeof root.escHtml === 'function') return root.escHtml(value == null ? '' : value);
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function localExpenses() {
    try { return JSON.parse(root.localStorage.getItem('clinic_expenses') || '[]'); } catch (e) { return []; }
  }

  function writeLocalExpenses(list) {
    try { root.localStorage.setItem('clinic_expenses', JSON.stringify(list)); } catch (e) {}
  }

  function selectedFinanceOptions() {
    var date = (document.getElementById('fd-date') || {}).value || today();
    var period = (document.getElementById('fd-period') || {}).value || 'day';
    var filter = (document.getElementById('fd-filter') || {}).value || 'all';
    return { date: date, period: period, filter: filter };
  }

  function periodBounds(opts) {
    var range = root.FinanceCore.getDateRange(opts.period, new Date(opts.date + 'T00:00:00+05:30'));
    return { from: root.FinanceCore.toISTDateString(range.start), to: root.FinanceCore.toISTDateString(range.end) };
  }

  function localPatientRecords() {
    var rows = [];
    if (Array.isArray(root._sheetRecordsCache)) rows = rows.concat(root._sheetRecordsCache);
    if (Array.isArray(root._dbData)) rows = rows.concat(root._dbData);
    try {
      for (var i = 0; i < root.localStorage.length; i += 1) {
        var key = root.localStorage.key(i);
        if (!key || key.indexOf('patient_') !== 0) continue;
        var row = JSON.parse(root.localStorage.getItem(key));
        if (row) rows.push(row);
      }
      var receptionRows = JSON.parse(root.localStorage.getItem('clinic_reception_patients_v1') || '[]');
      if (Array.isArray(receptionRows)) receptionRows.forEach(function (row) {
        if (row) rows.push(Object.assign({}, row, { _receptionRecord: true }));
      });
    } catch (e) {}
    var seen = {};
    return rows.filter(function (row) {
      if (!row) return false;
      var key = row.visitId || row.patientId || [row.name, row.phone, row.date, row.timestamp].join('|');
      key = String(key).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function uniqueRows(rows, idFields) {
    var seen = {};
    return (rows || []).filter(function (row) {
      if (!row) return false;
      var key = '';
      var visitIdentity = [row.name || row.patientName, row.phone, row.date].join('|').toLowerCase();
      if ((idFields || []).indexOf('visitId') !== -1 && (row.name || row.patientName) && row.date) {
        key = 'visit:' + visitIdentity;
      }
      (idFields || []).some(function (field) {
        if (key) return true;
        if (row[field]) { key = field + ':' + row[field]; return true; }
        return false;
      });
      // Main-sheet visits may have a server-generated visitId while the
      // local copy does not. Use the patient/day identity as the fallback so
      // those two copies cannot create duplicate finance rows.
      if (!key) key = [row.name || row.patientName, row.phone, row.date].join('|');
      key = String(key).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function financeSources() {
    var finance = root.FinanceStore ? root.FinanceStore.getFinanceCache() : {};
    var reception = root.FinanceStore ? root.FinanceStore.getReceptionCache() : {};
    var localRecords = localPatientRecords();
    var localFees = [];
    var localHistoryPayments = [];
    localRecords.forEach(function (row) {
      var normalized = root.FinanceCore && root.FinanceCore.normalizePatientPaymentHistory
        ? root.FinanceCore.normalizePatientPaymentHistory(row)
        : null;
      var hasHistory = Array.isArray(row.paymentHistory)
        ? row.paymentHistory.length > 0
        : typeof row.paymentHistory === 'string' && row.paymentHistory.trim() !== '';
      if (normalized && hasHistory) {
        if (normalized.basePaid > 0) {
          localFees.push(Object.assign({}, row, {
            patientName: row.patientName || row.name,
            billId: normalized.billId,
            visitId: normalized.visitId,
            patientId: normalized.patientId,
            billPaid: normalized.basePaid
          }));
        }
        normalized.payments.filter(function (payment) { return payment.source === 'paymentHistory'; }).forEach(function (payment) {
          localHistoryPayments.push(Object.assign({}, payment, {
            patientName: payment.patientName || row.patientName || row.name,
            name: row.name || row.patientName,
            _aggregatePaid: normalized.billPaid
          }));
        });
      } else if (Number(row.billPaid) > 0) {
        localFees.push(row);
      }
    });
    var localVisits = localRecords.filter(function (row) {
      if (Number(row.billPaid) > 0) return false;
      if (!row._receptionRecord) return true;
      return row.workflowStatus === 'finalized' || row.receptionDone === true || String(row.receptionDone).toLowerCase() === 'true';
    }).map(function (row) {
      return Object.assign({}, row, { visitId: [row.name, row.phone, row.date].join('|') });
    });
    var expenses = mergeLegacyExpenses((finance.expenses || []).concat(reception.expenses || []), localExpenses());
    var formalPayments = (finance.payments || []).concat(reception.payments || []);
    var formalNetByBill = {};
    formalPayments.forEach(function (payment) {
      if (!payment || !payment.billId || payment.status === 'VOID') return;
      formalNetByBill[payment.billId] = (formalNetByBill[payment.billId] || 0) +
        (String(payment.transactionType || 'PAYMENT').toUpperCase() === 'PAYMENT' ? Number(payment.amount) || 0 : -(Number(payment.amount) || 0));
    });
    localHistoryPayments = localHistoryPayments.filter(function (payment) {
      return !(formalNetByBill[payment.billId] >= 0 &&
        formalNetByBill[payment.billId] >= Number(payment._aggregatePaid || 0) &&
        payment._aggregatePaid);
    });
    var mergedPayments = [];
    var seenPaymentIds = {};
    formalPayments.concat(localHistoryPayments).forEach(function (payment) {
      if (!payment) return;
      var key = payment.paymentId || [
        payment.billId, payment.paymentDate || payment.date, payment.amount, payment.paymentMode
      ].join('|');
      if (seenPaymentIds[key]) return;
      seenPaymentIds[key] = true;
      mergedPayments.push(payment);
    });
    return {
      bills: uniqueRows((finance.bills || []).concat(reception.bills || []), ['billId', 'id']),
      payments: mergedPayments,
      receipts: finance.receipts || [],
      expenses: expenses,
      patientFees: uniqueRows((finance.patientFees || []).concat(reception.patientFees || [], localFees), ['visitId', 'patientId']),
      completedVisits: uniqueRows((finance.completedVisits || []).concat(reception.completedVisits || [], localVisits), ['visitId', 'patientId'])
    };
  }

  function setText(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }

  function syncStatus(info) {
    var el = document.getElementById('fd-sync-status');
    if (!el) return;
    var status = info && info.status ? info.status : 'online';
    el.textContent = status === 'syncing' ? 'Syncing…' : status === 'sync_error' ? 'Sync needs attention' : status === 'offline' ? 'Offline — saved locally' : 'Online';
    el.classList.toggle('offline', status === 'offline' || status === 'sync_error');
  }

  function renderFinance() {
    var host = document.getElementById('fd-cashbook-entries');
    if (!host || !root.FinanceCore) return;
    var dateEl = document.getElementById('fd-date');
    if (dateEl && !dateEl.value) dateEl.value = today();
    var opts = selectedFinanceOptions();
    var report = root.FinanceCore.buildCashbookEntries(financeSources(), { period: opts.period, anchorDate: opts.date, filter: opts.filter });
    var allEntries = report.days.reduce(function (list, day) { return list.concat(day.entries); }, []);
    setText('fd-total-in', money(report.totals.cashIn));
    setText('fd-total-out', money(report.totals.cashOut));
    setText('fd-balance', money(report.totals.balance));
    setText('fd-expense-count', String(financeSources().expenses.filter(function (row) { return row.status !== 'VOID'; }).length));
    setText('fd-ledger-count', allEntries.length + (allEntries.length === 1 ? ' entry' : ' entries'));
    var title = opts.period === 'year' ? opts.date.slice(0, 4) : opts.period === 'month' ? new Date(opts.date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : new Date(opts.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    setText('fd-ledger-title', title + ' transactions');
    if (!report.days.length) {
      host.innerHTML = '<div class="cashbook-empty">No transactions match this period and filter.</div>';
    } else {
      host.innerHTML = report.days.map(function (day) {
        return '<div class="cashbook-date-heading">' + esc(new Date(day.date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })) + '</div>' + day.entries.map(function (entry) {
          var isIn = entry.cashIn > 0;
          var amount = isIn ? entry.cashIn : entry.cashOut;
          var isActivity = entry.source === 'completed-visit';
          var source = entry.source === 'patient-fee' ? 'Patient payment' : entry.source === 'completed-visit' ? 'Completed visit · no cash movement' : entry.source === 'receipt' ? 'Cash receipt' : entry.source === 'legacy-expense' ? 'Legacy expense' : entry.source === 'expense' ? 'Expense' : 'Finance entry';
          var billMeta = entry.billId ? ' · Bill ' + entry.billId : '';
          return '<article class="cashbook-row"><div class="cashbook-desc">' + esc(entry.label) + '<small>' + esc(source) + (entry.paymentMode ? ' · ' + esc(entry.paymentMode) : '') + esc(billMeta) + '</small></div><div class="cashbook-amount ' + (isIn ? 'in' : '') + '">' + (isActivity ? '—' : (isIn ? money(amount) : '')) + '</div><div class="cashbook-amount ' + (!isIn && !isActivity ? 'out' : '') + '">' + (isActivity ? '—' : (!isIn ? money(amount) : '')) + '<span class="cashbook-balance">Balance ' + money(entry.balance) + '</span></div></article>';
        }).join('');
      }).join('');
    }
    renderCashClosing(report);
    syncStatus(root.FinanceStore && root.FinanceStore.getSyncStatus ? root.FinanceStore.getSyncStatus() : null);
  }

  function cashClosingTotals(sources, bounds) {
    sources = sources || {};
    bounds = bounds || {};
    function dateOnly(row, fields) {
      for (var i = 0; i < fields.length; i += 1) {
        if (row && row[fields[i]]) return String(row[fields[i]]).slice(0, 10);
      }
      return '';
    }
    function inPeriod(row, fields) {
      var date = dateOnly(row, fields);
      return Boolean(date && (!bounds.from || date >= bounds.from) && (!bounds.to || date <= bounds.to));
    }
    var cashPayments = 0, cashRefunds = 0, cashExpenses = 0;
    (sources.payments || []).forEach(function (payment) {
      if (!inPeriod(payment, ['paymentDate', 'date', 'createdAt']) || String(payment.status || 'ACTIVE').toUpperCase() === 'VOID') return;
      if (String(payment.paymentMode || '').toUpperCase() !== 'CASH') return;
      var type = String(payment.transactionType || 'PAYMENT').toUpperCase();
      if (type === 'PAYMENT') cashPayments += Number(payment.amount) || 0;
      else if (type === 'REFUND' || type === 'REVERSAL') cashRefunds += Number(payment.amount) || 0;
    });
    (sources.receipts || []).forEach(function (receipt) {
      if (String(receipt.status || 'ACTIVE').toUpperCase() === 'VOID') return;
      if (!inPeriod(receipt, ['receiptDate', 'date', 'createdAt']) || String(receipt.paymentMode || '').toUpperCase() !== 'CASH') return;
      cashPayments += Number(receipt.amount) || 0;
    });
    (sources.expenses || []).forEach(function (expense) {
      if (String(expense.status || 'ACTIVE').toUpperCase() === 'VOID') return;
      if (!inPeriod(expense, ['expenseDate', 'date', 'createdAt']) || String(expense.paymentMode || '').toUpperCase() !== 'CASH') return;
      cashExpenses += Number(expense.amount) || 0;
    });
    return { cashPayments: cashPayments, cashRefunds: cashRefunds, cashExpenses: cashExpenses };
  }

  function renderCashClosing(report) {
    var opts = selectedFinanceOptions();
    var totals = cashClosingTotals(financeSources(), periodBounds(opts));
    var closing = root.FinanceCore.calcCashClosing({ openingCash: 0, cashPayments: totals.cashPayments, cashRefunds: totals.cashRefunds, cashExpenses: totals.cashExpenses, allCollections: report.totals.cashIn, allActiveExpenses: report.totals.cashOut });
    setText('fd-opening-cash', money(closing.openingCash));
    setText('fd-cash-payments', money(closing.cashPayments));
    setText('fd-cash-expenses', money(closing.cashExpenses));
    setText('fd-expected-closing', money(closing.expectedClosingCash));
    setText('fd-net-movement', money(closing.netCashMovement));
  }

  function refreshFinance() {
    renderFinance();
    if (!root.FinanceStore || !root.FinanceStore.refreshFinanceSummary || !root.navigator.onLine) return;
    var bounds = periodBounds(selectedFinanceOptions());
    root.FinanceStore.refreshFinanceSummary(bounds.from, bounds.to).then(function () { renderFinance(); }).catch(function () { renderFinance(); });
  }

  function moveFinancePeriod(delta) {
    var input = document.getElementById('fd-date'); if (!input) return;
    var value = input.value || today();
    var date = new Date(value + 'T00:00:00');
    var period = (document.getElementById('fd-period') || {}).value || 'day';
    if (period === 'year') date.setFullYear(date.getFullYear() + Number(delta || 0));
    else if (period === 'month') date.setMonth(date.getMonth() + Number(delta || 0));
    else date.setDate(date.getDate() + Number(delta || 0));
    input.value = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    refreshFinance();
  }

  function openFinanceEntry(type) {
    var form = document.getElementById('fd-entry-form'); if (!form) return;
    root._financeEntryType = type === 'out' ? 'out' : 'in';
    form.hidden = false;
    var title = document.getElementById('fd-entry-title');
    if (title) title.textContent = root._financeEntryType === 'in' ? 'Record Cash In' : 'Record Cash Out';
    var save = document.getElementById('fd-entry-save');
    if (save) { save.textContent = 'Save entry'; save.className = 'cashbook-submit'; }
    var date = document.getElementById('fd-entry-date'); if (date) date.value = (document.getElementById('fd-date') || {}).value || today();
    var category = document.getElementById('fd-category'); if (category) category.value = root._financeEntryType === 'in' ? 'Patient fees' : 'Miscellaneous';
    var desc = document.getElementById('fd-description'); if (desc) desc.focus();
  }

  function closeFinanceEntry() {
    var form = document.getElementById('fd-entry-form'); if (form) form.hidden = true;
    var status = document.getElementById('fd-entry-status'); if (status) { status.textContent = ''; status.className = 'finance-status'; }
  }

  async function saveFinanceEntry() {
    var data = { description: text((document.getElementById('fd-description') || {}).value), amount: Number((document.getElementById('fd-amount') || {}).value) || 0 };
    var validation = validateEntry(data);
    var status = document.getElementById('fd-entry-status');
    if (!validation.valid) { if (status) { status.textContent = validation.errors.join(' '); status.className = 'finance-status error'; } return; }
    var date = (document.getElementById('fd-entry-date') || {}).value || today();
    var common = { date: date, description: data.description, amount: data.amount, paymentMode: (document.getElementById('fd-payment-mode') || {}).value || 'OTHER', vendor: text((document.getElementById('fd-vendor') || {}).value), reference: text((document.getElementById('fd-reference') || {}).value) };
    if (root._financeEntryType === 'out') {
      var expense = Object.assign({}, common, { expenseDate: date, expenseType: (document.getElementById('fd-category') || {}).value || 'Miscellaneous', category: (document.getElementById('fd-category') || {}).value || 'Miscellaneous' });
      if (root.FinanceStore && root.FinanceStore.saveExpense) root.FinanceStore.saveExpense(expense);
      var old = localExpenses(); old.push(Object.assign({}, expense, { id: 'exp_' + Date.now() })); writeLocalExpenses(old);
    } else if (root.FinanceStore && root.FinanceStore.saveReceipt) {
      root.FinanceStore.saveReceipt(Object.assign({}, common, { receiptDate: date }));
    }
    if (status) { status.textContent = 'Saved locally. Sync will continue automatically.'; status.className = 'finance-status'; }
    renderFinance();
    setTimeout(closeFinanceEntry, 700);
  }

  function voidFinanceEntry(source, id) {
    if (!id || !root.confirm || !root.confirm('Void this entry? It will remain visible in history.')) return;
    if (source === 'legacy') {
      var legacy = localExpenses().map(function (row) {
        return row.id === id ? Object.assign({}, row, { status: 'VOID' }) : row;
      });
      writeLocalExpenses(legacy);
      renderExpensesTable(); renderExpensesSummary(); renderFinance();
      return;
    }
    if (source === 'receipt' && root.FinanceStore && root.FinanceStore.voidReceipt) root.FinanceStore.voidReceipt(id, 'Voided from Finance');
    else if (root.FinanceStore && root.FinanceStore.voidExpense) root.FinanceStore.voidExpense(id, 'Voided from Finance');
    renderFinance(); renderExpensesTable(); renderExpensesSummary();
  }

  function renderExpensesTable() {
    var body = document.getElementById('expensesTableBody'); if (!body) return;
    var finance = root.FinanceStore ? root.FinanceStore.getFinanceCache() : {};
    var list = mergeLegacyExpenses((finance.expenses || []).concat((root.FinanceStore ? root.FinanceStore.getReceptionCache().expenses || [] : [])), localExpenses()).sort(function (a, b) { return String(b.expenseDate || b.date).localeCompare(String(a.expenseDate || a.date)); });
    if (!list.length) { body.innerHTML = '<tr class="expenses-empty-row"><td colspan="7" class="tab-empty-msg" style="text-align:center;">No expenses recorded yet — add one above.</td></tr>'; return; }
    body.innerHTML = list.map(function (row) {
      var date = row.expenseDate || row.date || '';
      var state = row.status === 'VOID' ? ' <span style="color:#b42318;font-size:11px;font-weight:800;">VOID</span>' : '';
      var action = row.status === 'VOID' ? '' : '<button class="row-del-btn" title="Void expense" onclick="voidFinanceEntry(\'' + esc(row.source === 'legacy-expense' ? 'legacy' : 'expense') + '\',\'' + esc(row.expenseId || row.id) + '\')">×</button>';
      return '<tr><td data-label="Date">' + esc(date) + '</td><td data-label="Category">' + esc(row.category || row.expenseType || 'Miscellaneous') + '</td><td data-label="Payment">' + esc(row.paymentMode || 'OTHER') + '</td><td data-label="Description">' + esc(row.description || '—') + state + '</td><td data-label="Vendor">' + esc(row.vendor || row.payee || '—') + '</td><td data-label="Amount" class="num">' + money(row.amount) + '</td><td data-label="Actions" class="expenses-actions-cell">' + action + '</td></tr>';
    }).join('');
  }

  function renderExpensesSummary() {
    var list = mergeLegacyExpenses(root.FinanceStore ? (root.FinanceStore.getFinanceCache().expenses || []).concat(root.FinanceStore.getReceptionCache().expenses || []) : [], localExpenses()).filter(function (row) { return row.status !== 'VOID'; });
    var now = new Date(), month = now.getMonth(), year = now.getFullYear(), monthTotal = 0, allTotal = 0;
    list.forEach(function (row) { var amount = Number(row.amount) || 0; allTotal += amount; var date = new Date(String(row.expenseDate || row.date || '') + 'T00:00:00'); if (!isNaN(date.getTime()) && date.getMonth() === month && date.getFullYear() === year) monthTotal += amount; });
    setText('expSummaryMonth', money(monthTotal)); setText('expSummaryAll', money(allTotal));
  }

  function addExpense() {
    var entry = { description: text((document.getElementById('expDescription') || {}).value), amount: Number((document.getElementById('expAmount') || {}).value) || 0 };
    var validation = validateEntry(entry), status = document.getElementById('expStatus');
    if (!validation.valid) { if (status) { status.textContent = validation.errors.join(' '); status.className = 'finance-status error'; } return; }
    var date = (document.getElementById('expDate') || {}).value || today();
    var payload = { expenseDate: date, date: date, category: (document.getElementById('expCategory') || {}).value, expenseType: (document.getElementById('expCategory') || {}).value, description: entry.description, amount: entry.amount, paymentMode: (document.getElementById('expPaymentMode') || {}).value || 'OTHER', vendor: text((document.getElementById('expVendor') || {}).value), reference: text((document.getElementById('expReference') || {}).value) };
    if (root.FinanceStore && root.FinanceStore.saveExpense) root.FinanceStore.saveExpense(payload);
    var list = localExpenses(); list.push(Object.assign({}, payload, { id: 'exp_' + Date.now() })); writeLocalExpenses(list);
    ['expDescription', 'expAmount', 'expVendor', 'expReference'].forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    if (status) { status.textContent = 'Expense saved locally. Sync will continue automatically.'; status.className = 'finance-status'; }
    renderExpensesTable(); renderExpensesSummary(); renderFinance();
  }

  function printFinanceCashbook() {
    var opts = selectedFinanceOptions();
    var report = root.FinanceCore.buildCashbookEntries(financeSources(), { period: opts.period, anchorDate: opts.date, filter: opts.filter });
    var win = root.open('', '_blank', 'width=900,height=1000');
    if (!win) return;
    var rows = report.days.map(function (day) { return day.entries.map(function (entry) { return '<tr><td>' + esc(day.date) + '</td><td>' + esc(entry.label) + '</td><td>' + (entry.cashIn ? money(entry.cashIn) : '—') + '</td><td>' + (entry.cashOut ? money(entry.cashOut) : '—') + '</td><td>' + money(entry.balance) + '</td></tr>'; }).join(''); }).join('');
    win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Clinic Cashbook</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#172033}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:10px;border-bottom:1px solid #d9e2ec;text-align:left}th{background:#f0f4f8}h1{margin:0}.total{font-weight:700;margin-top:18px}</style></head><body><h1>Clinic Cashbook</h1><p>' + esc(opts.date) + ' · ' + esc(opts.period) + '</p><table><thead><tr><th>Date</th><th>Description</th><th>Cash In</th><th>Cash Out</th><th>Balance</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">No transactions.</td></tr>') + '</tbody></table><p class="total">Cash In ' + money(report.totals.cashIn) + ' · Cash Out ' + money(report.totals.cashOut) + ' · Balance ' + money(report.totals.balance) + '</p><script>window.print()<\/script></body></html>');
    win.document.close();
  }

  var api = {
    mergeLegacyExpenses: mergeLegacyExpenses,
    validateEntry: validateEntry,
    cashClosingTotals: cashClosingTotals,
    financeSources: financeSources
  };
  api.renderFinance = renderFinance;
  api.refreshFinance = refreshFinance;
  api.renderExpensesTable = renderExpensesTable;
  api.renderExpensesSummary = renderExpensesSummary;
  api.addExpense = addExpense;
  api.openFinanceEntry = openFinanceEntry;
  api.closeFinanceEntry = closeFinanceEntry;
  api.saveFinanceEntry = saveFinanceEntry;
  api.voidFinanceEntry = voidFinanceEntry;
  api.moveFinancePeriod = moveFinancePeriod;
  api.printFinanceCashbook = printFinanceCashbook;

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.FinanceView = api;
    root.renderFinance = refreshFinance;
    root.openFinanceEntry = openFinanceEntry;
    root.closeFinanceEntry = closeFinanceEntry;
    root.saveFinanceEntry = saveFinanceEntry;
    root.voidFinanceEntry = voidFinanceEntry;
    root.moveFinancePeriod = moveFinancePeriod;
    root.printFinanceCashbook = printFinanceCashbook;
    root.addExpense = addExpense;
    root.renderExpensesTable = renderExpensesTable;
    root.renderExpensesSummary = renderExpensesSummary;
    if (root.FinanceStore && root.FinanceStore.onStatusChange) root.FinanceStore.onStatusChange(syncStatus);
  }
})(typeof window !== 'undefined' ? window : null);
