/* =========================================================
   finance-store.js
   Local cache, offline sync queue, and server communication.
   Depends on: finance-core.js (FinanceCore must be loaded first)

   Clinic Doctor Prescription Software
   ========================================================= */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     VERSIONED LOCAL STORAGE KEYS
  ---------------------------------------------------------- */
  var KEYS = {
    receptionCache: 'reception_cache_v1',
    financeCache:   'finance_cache_v1',
    syncQueue:      'finance_sync_queue_v1',
    lastSync:       'finance_last_sync_v1',
    currentUser:    'current_user_v1'
  };

  /* ----------------------------------------------------------
     SYNC STATUS BROADCASTING
     Other modules subscribe to sync status changes.
  ---------------------------------------------------------- */
  var STATUS = {
    ONLINE:   'online',
    OFFLINE:  'offline',
    SYNCING:  'syncing',
    ERROR:    'sync_error'
  };

  var _statusListeners = [];
  var _currentStatus   = STATUS.ONLINE;
  var _pendingCount    = 0;

  function onStatusChange(fn) {
    _statusListeners.push(fn);
  }

  function _broadcastStatus(status, extra) {
    _currentStatus = status;
    _statusListeners.forEach(function (fn) {
      try { fn({ status: status, pendingCount: _pendingCount, extra: extra || null }); }
      catch (e) { /* listener errors must not break sync */ }
    });
  }

  /* ----------------------------------------------------------
     SAFE LOCALSTORAGE HELPERS
  ---------------------------------------------------------- */

  function _lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function _lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[FinanceStore] localStorage write failed:', e);
      return false;
    }
  }

  /* ----------------------------------------------------------
     CURRENT USER
  ---------------------------------------------------------- */

  function getCurrentUser() {
    return _lsGet(KEYS.currentUser, {
      userId: 'receptionist',
      role:   'receptionist',
      name:   'Staff'
    });
  }

  function setCurrentUser(user) {
    _lsSet(KEYS.currentUser, user);
  }

  function clearCurrentUser() {
    var receptionist = { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
    _lsSet(KEYS.currentUser, receptionist);
    return receptionist;
  }

  /* ----------------------------------------------------------
     RECEPTION CACHE
     Stores the last loaded reception day data.
  ---------------------------------------------------------- */

  function getReceptionCache() {
    return _lsGet(KEYS.receptionCache, {
      date: null,
      appointments: [],
      bills: [],
      payments: [],
      expenses: [],
      collectionTasks: [],
      closing: null,
      loadedAt: null
    });
  }

  function setReceptionCache(data) {
    _lsSet(KEYS.receptionCache, Object.assign({}, data, { loadedAt: new Date().toISOString() }));
  }

  /* ----------------------------------------------------------
     FINANCE CACHE
     Stores last loaded summary and source rows.
  ---------------------------------------------------------- */

  function getFinanceCache() {
    return _lsGet(KEYS.financeCache, {
      summary: null,
      bills: [],
      payments: [],
      receipts: [],
      expenses: [],
      patientFees: [],
      completedVisits: [],
      outstanding: [],
      loadedAt: null
    });
  }

  function setFinanceCache(data) {
    _lsSet(KEYS.financeCache, Object.assign({}, data, { loadedAt: new Date().toISOString() }));
  }

  /* ----------------------------------------------------------
     SYNC QUEUE
     Each entry: { operationId, action, payload, userId, role,
                   queuedAt, attemptCount, lastError, status }
  ---------------------------------------------------------- */

  function getQueue() {
    return _lsGet(KEYS.syncQueue, []);
  }

  function _saveQueue(queue) {
    _lsSet(KEYS.syncQueue, queue);
    _pendingCount = queue.filter(function (op) {
      return op.status === 'pending' || op.status === 'retry';
    }).length;
    return queue;
  }

  function enqueue(action, payload) {
    var user   = getCurrentUser();
    var entry  = {
      operationId:  FinanceCore.genOperationId(),
      action:       action,
      payload:      payload,
      userId:       user.userId,
      role:         user.role,
      sessionToken: user.sessionToken || '',
      queuedAt:     new Date().toISOString(),
      attemptCount: 0,
      lastError:    null,
      status:       'pending'   // pending | syncing | synced | error | retry
    };
    var queue = getQueue();
    queue.push(entry);
    _saveQueue(queue);
    _broadcastStatus(navigator.onLine ? STATUS.ONLINE : STATUS.OFFLINE);
    return entry.operationId;
  }

  function _markSynced(operationId, response) {
    var queue = getQueue();
    _saveQueue(queue.filter(function (op) {
      return op.operationId !== operationId;
    }));
  }

  function _markError(operationId, error) {
    var queue = getQueue();
    queue.forEach(function (op) {
      if (op.operationId === operationId) {
        op.attemptCount++;
        op.lastError = error;
        op.status = op.attemptCount >= 5 ? 'error' : 'retry';
      }
    });
    _saveQueue(queue);
  }

  function retryOperation(operationId) {
    var queue = getQueue();
    queue.forEach(function (op) {
      if (op.operationId === operationId && op.status === 'error') {
        op.status = 'retry';
        op.attemptCount = 0;
        op.lastError = null;
      }
    });
    _saveQueue(queue);
    _processQueue();
  }

  function clearSyncedOperations() {
    var queue = getQueue().filter(function (op) { return op.status !== 'synced'; });
    _saveQueue(queue);
  }

  /* ----------------------------------------------------------
     SERVER COMMUNICATION
  ---------------------------------------------------------- */

  function _getUrl() {
    if (typeof window !== 'undefined' && window.CONFIG && CONFIG.GOOGLE_SHEETS_URL) {
      return CONFIG.GOOGLE_SHEETS_URL;
    }
    return null;
  }

  function _isConfigured() {
    var url = _getUrl();
    return url && url.indexOf('PASTE_') !== 0 && url.length > 20;
  }

  /**
   * POST a write operation to Apps Script.
   * Returns { ok, operationId, ... } or throws.
   */
  async function _postOperation(entry) {
    var url = _getUrl();
    if (!url) throw new Error('Google Sheets URL not configured');

    var body = {
      action:      entry.action,
      operationId: entry.operationId,
      userId:      entry.userId,
      role:        entry.role,
      sessionToken: entry.sessionToken || '',
      appVersion:  (typeof window !== 'undefined' && window.CONFIG && CONFIG.APP_VERSION) || '4.0.0',
      appWriteKey: (typeof window !== 'undefined' && window.CONFIG && CONFIG.APP_WRITE_KEY) || '',
      payload:     entry.payload
    };

    var resp = await fetch(url, {
      method:  'POST',
      mode:    'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(body)
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    var json = await resp.json();
    if (!json.ok) {
      // VERSION_CONFLICT is a handled error, not a retryable error
      var err = new Error(json.message || json.errorCode || 'Server error');
      err.errorCode = json.errorCode;
      err.serverResponse = json;
      throw err;
    }
    return json;
  }

  /**
   * GET request to Apps Script.
   */
  async function _getRequest(params) {
    var url = _getUrl();
    if (!url) throw new Error('Google Sheets URL not configured');

    params = Object.assign({}, params, {
      appWriteKey: (typeof window !== 'undefined' && window.CONFIG && CONFIG.APP_WRITE_KEY) || ''
    });
    var qs = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    var resp = await fetch(url + (qs ? '?' + qs : ''), { method: 'GET' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);

    var json = await resp.json();
    return json;
  }

  /* ----------------------------------------------------------
     QUEUE PROCESSOR
     Processes pending operations one at a time.
  ---------------------------------------------------------- */

  var _syncing = false;

  async function _processQueue() {
    if (_syncing || !_isConfigured() || !navigator.onLine) return;
    var queue = getQueue();
    var pending = queue.filter(function (op) {
      return op.status === 'pending' || op.status === 'retry';
    });
    if (pending.length === 0) return;

    _syncing = true;
    _broadcastStatus(STATUS.SYNCING);

    for (var i = 0; i < pending.length; i++) {
      var entry = pending[i];
      // Mark as syncing in queue
      var q = getQueue();
      q.forEach(function (op) { if (op.operationId === entry.operationId) op.status = 'syncing'; });
      _saveQueue(q);

      try {
        var result = await _postOperation(entry);
        _markSynced(entry.operationId, result);
        // Refresh relevant data after success
        _scheduleRefresh(entry.action);
      } catch (err) {
        var nonRetryable = ['VERSION_CONFLICT','VALIDATION','INVALID_STATE','NOT_FOUND',
          'OVERPAYMENT','REFUND_EXCEEDS_ORIGINAL','FORBIDDEN','DAY_CLOSED',
          'INVALID_APP_KEY','ALREADY_CLOSED','UNKNOWN_ACTION'];
        if (nonRetryable.indexOf(err.errorCode) !== -1) {
          // Business-rule failures need user correction; retrying would only
          // duplicate noise and keep an invalid optimistic state visible.
          var q2 = getQueue();
          q2.forEach(function (op) {
            if (op.operationId === entry.operationId) {
              op.status = 'error';
              op.lastError = (err.errorCode || 'ERROR') + ': ' + (err.message || '');
            }
          });
          _saveQueue(q2);
          _scheduleRefresh(entry.action);
        } else {
          _markError(entry.operationId, err.message);
        }
        _broadcastStatus(STATUS.ERROR, err.message);
      }
    }

    _syncing = false;
    var remaining = getQueue().filter(function (op) {
      return op.status === 'pending' || op.status === 'retry';
    });
    var failed = getQueue().filter(function (op) { return op.status === 'error'; });
    if (remaining.length > 0 || failed.length > 0) {
      _broadcastStatus(STATUS.ERROR);
    } else {
      _broadcastStatus(navigator.onLine ? STATUS.ONLINE : STATUS.OFFLINE);
    }
  }

  var _refreshTimers = {};
  function _scheduleRefresh(action) {
    // Debounce refreshes after related operations
    var key = action.replace(/[A-Z]/g, function (c) { return c.toLowerCase(); });
    clearTimeout(_refreshTimers[key]);
    _refreshTimers[key] = setTimeout(function () {
      if (action.indexOf('Appointment') !== -1 || action.indexOf('appointment') !== -1) {
        FinanceStore.refreshReceptionDay();
      }
      if (action.indexOf('Bill') !== -1 || action.indexOf('Payment') !== -1 || action.indexOf('Receipt') !== -1 || action.indexOf('Expense') !== -1 || action.indexOf('CollectionTask') !== -1) {
        FinanceStore.refreshReceptionDay();
      }
    }, 500);
  }

  /* ----------------------------------------------------------
     ONLINE/OFFLINE EVENTS
  ---------------------------------------------------------- */

  if (typeof window !== 'undefined') {
    window.addEventListener('online', function () {
      _broadcastStatus(STATUS.ONLINE);
      _processQueue();
    });
    window.addEventListener('offline', function () {
      _broadcastStatus(STATUS.OFFLINE);
    });
  }

  /* ----------------------------------------------------------
     PUBLIC API — WRITE OPERATIONS
     Each: saves locally (optimistic), enqueues for server sync.
  ---------------------------------------------------------- */

  /**
   * Saves a write operation to the local queue and triggers sync.
   * Returns { operationId, status: 'pending' }
   */
  function write(action, payload) {
    var operationId = enqueue(action, payload);
    _processQueue();
    return { operationId: operationId, status: 'pending' };
  }

  /**
   * Saves an appointment (creates or updates).
   * Generates appointmentId if not provided.
   */
  function saveAppointment(apptData) {
    if (!apptData.appointmentId) {
      apptData.appointmentId = FinanceCore.genAppointmentId();
    }
    // Optimistic local update
    var cache = getReceptionCache();
    var idx = cache.appointments.findIndex(function (a) { return a.appointmentId === apptData.appointmentId; });
    if (idx >= 0) {
      cache.appointments[idx] = Object.assign({}, cache.appointments[idx], apptData, { _pending: true });
    } else {
      cache.appointments.push(Object.assign({}, apptData, { _pending: true }));
    }
    setReceptionCache(cache);

    return write('upsertAppointment', apptData);
  }

  /**
   * Updates appointment status (check-in, complete, cancel, etc.)
   */
  function updateAppointmentStatus(appointmentId, status, notes, recordVersion) {
    var cache = getReceptionCache();
    cache.appointments.forEach(function (a) {
      if (a.appointmentId === appointmentId) {
        a.status = status;
        if (notes !== undefined) a.notes = notes;
        a._pending = true;
      }
    });
    setReceptionCache(cache);

    return write('updateAppointmentStatus', {
      appointmentId: appointmentId,
      status: status,
      notes: notes,
      recordVersion: recordVersion
    });
  }

  /**
   * Creates or updates a bill.
   * Generates billId and visitId if not provided.
   */
  function saveBill(billData) {
    if (!billData.billId)   billData.billId   = FinanceCore.genBillId();
    if (!billData.visitId)  billData.visitId  = FinanceCore.genVisitId();
    if (!billData.patientId) billData.patientId = FinanceCore.genPatientId();

    // Validate totals before queuing
    var totals = FinanceCore.calcBillTotals({ items: billData.items || [], discount: billData.discount });
    billData.currentCharges  = totals.currentCharges;
    billData.discount        = totals.discount;
    billData.netBillAmount   = totals.netBillAmount;
    billData.itemsJson       = JSON.stringify(billData.items || []);

    // Optimistic local update
    var cache = getReceptionCache();
    var idx = cache.bills.findIndex(function (b) { return b.billId === billData.billId; });
    if (!billData.recordVersion) billData.recordVersion = idx >= 0 ? String(cache.bills[idx].recordVersion || '1') : '1';
    if (idx >= 0) {
      cache.bills[idx] = Object.assign({}, cache.bills[idx], billData, { _pending: true });
    } else {
      cache.bills.push(Object.assign({}, billData, { status: 'DRAFT', _pending: true }));
    }
    setReceptionCache(cache);

    return write('upsertBill', billData);
  }

  /**
   * Posts a DRAFT bill to POSTED status.
   */
  function postBill(billId, recordVersion) {
    var cache = getReceptionCache();
    cache.bills.forEach(function (b) {
      if (b.billId === billId) { b.status = 'POSTED'; b._pending = true; }
    });
    setReceptionCache(cache);
    return write('postBill', { billId: billId, recordVersion: recordVersion });
  }

  /**
   * Creates/updates a bill and immediately queues the DRAFT -> POSTED
   * transition. Queue order is preserved, including while offline.
   */
  function saveAndPostBill(billData) {
    var saved = saveBill(billData);
    var posted = postBill(billData.billId);
    return {
      billId: billData.billId,
      saveOperationId: saved.operationId,
      postOperationId: posted.operationId,
      status: 'POSTED'
    };
  }

  /**
   * Voids a bill (admin only).
   */
  function voidBill(billId, reason, recordVersion) {
    return write('voidBill', { billId: billId, reason: reason, recordVersion: recordVersion });
  }

  /**
   * Records a payment (PAYMENT, REFUND, or REVERSAL).
   * Generates paymentId if not provided.
   */
  function recordPayment(paymentData) {
    paymentData = Object.assign({}, paymentData || {});
    if (!paymentData.paymentId) paymentData.paymentId = FinanceCore.genPaymentId();

    // Validate locally
    var cache   = getReceptionCache();
    var financeCache = getFinanceCache();
    var existing = (financeCache.payments || []).concat(cache.payments || []).find(function (payment) {
      return payment && payment.paymentId === paymentData.paymentId;
    });
    if (existing) {
      return {
        ok: true,
        status: existing._pending ? 'pending' : 'synced',
        paymentId: existing.paymentId,
        operationId: existing.operationId || null
      };
    }
    var bill    = cache.bills.find(function (b) { return b.billId === paymentData.billId; }) ||
                  (financeCache.bills || []).find(function (b) { return b.billId === paymentData.billId; });
    if (bill && !cache.bills.some(function (b) { return b.billId === bill.billId; })) {
      cache.bills.push(Object.assign({}, bill));
    }
    var seenPaymentIds = {};
    var allKnownPayments = (financeCache.payments || []).concat(cache.payments || []).filter(function (p) {
      var key = p.paymentId || p.operationId;
      if (key && seenPaymentIds[key]) return false;
      if (key) seenPaymentIds[key] = true;
      return true;
    });
    var billPays = allKnownPayments.filter(function (p) { return p.billId === paymentData.billId; });
    var validation = FinanceCore.validatePayment(paymentData, bill, billPays);
    if (!validation.valid) {
      return { ok: false, errors: validation.errors, operationId: null };
    }

    // Optimistic local update
    cache.payments.push(Object.assign({}, paymentData, {
      status: 'ACTIVE', _pending: true,
      paymentDate: paymentData.paymentDate || new Date().toISOString()
    }));
    // Update bill status optimistically
    if (bill) {
      var allPays = billPays.concat([paymentData]);
      var netPaid = FinanceCore.calcNetCollected(allPays);
      bill.status = FinanceCore.deriveBillStatus(bill.netBillAmount, netPaid, bill.status);
    }
    setReceptionCache(cache);

    return write('recordPayment', paymentData);
  }

  /**
   * Creates or updates the doctor's visual request for reception collection.
   * The request is intentionally separate from Payments: the requested amount
   * is not cash received until the receptionist records the actual payment.
   */
  function saveCollectionTask(taskData) {
    taskData = Object.assign({}, taskData || {});
    if (!taskData.taskId) taskData.taskId = 'COL-' + FinanceCore.genOperationId().replace(/^OP-/, '');
    taskData.requestedAmount = FinanceCore.round2(Number(taskData.requestedAmount) || 0);
    taskData.collectedAmount = FinanceCore.round2(Number(taskData.collectedAmount) || 0);
    taskData.remainingAmount = FinanceCore.round2(
      taskData.remainingAmount == null
        ? Math.max(0, taskData.requestedAmount - taskData.collectedAmount)
        : Number(taskData.remainingAmount) || 0
    );
    taskData.status = String(taskData.status || (taskData.remainingAmount <= 0 ? 'COLLECTED' : taskData.collectedAmount > 0 ? 'PARTIAL' : 'REQUESTED')).toUpperCase();
    taskData.updatedAt = taskData.updatedAt || new Date().toISOString();
    var cache = getReceptionCache();
    if (!Array.isArray(cache.collectionTasks)) cache.collectionTasks = [];
    var idx = cache.collectionTasks.findIndex(function (task) { return task.taskId === taskData.taskId; });
    if (!taskData.recordVersion) taskData.recordVersion = idx >= 0 ? String(cache.collectionTasks[idx].recordVersion || '1') : '1';
    var optimistic = Object.assign({}, idx >= 0 ? cache.collectionTasks[idx] : {}, taskData, { _pending: true });
    if (idx >= 0) cache.collectionTasks[idx] = optimistic;
    else cache.collectionTasks.push(optimistic);
    setReceptionCache(cache);
    return write('upsertCollectionTask', taskData);
  }

  function updateCollectionTask(taskData) {
    return saveCollectionTask(taskData);
  }

  /**
   * Saves an expense.
   */
  function saveExpense(expenseData) {
    if (!expenseData.expenseId) expenseData.expenseId = FinanceCore.genExpenseId();

    // Optimistic local update
    var cache = getReceptionCache();
    if (!Array.isArray(cache.expenses)) cache.expenses = [];
    var idx = cache.expenses.findIndex(function (e) { return e.expenseId === expenseData.expenseId; });
    if (!expenseData.recordVersion) expenseData.recordVersion = idx >= 0 ? String(cache.expenses[idx].recordVersion || '1') : '1';
    if (idx >= 0) {
      cache.expenses[idx] = Object.assign({}, cache.expenses[idx], expenseData, { _pending: true });
    } else {
      cache.expenses.push(Object.assign({}, expenseData, { status: 'ACTIVE', _pending: true }));
    }
    setReceptionCache(cache);

    var financeCache = getFinanceCache();
    if (!Array.isArray(financeCache.expenses)) financeCache.expenses = [];
    var financeIdx = financeCache.expenses.findIndex(function (e) { return e.expenseId === expenseData.expenseId; });
    if (financeIdx >= 0) financeCache.expenses[financeIdx] = Object.assign({}, financeCache.expenses[financeIdx], expenseData, { _pending: true });
    else financeCache.expenses.push(Object.assign({}, expenseData, { status: 'ACTIVE', _pending: true }));
    setFinanceCache(financeCache);

    return write('upsertExpense', expenseData);
  }

  /**
   * Voids an expense (admin only).
   */
  function voidExpense(expenseId, reason, recordVersion) {
    var cache = getReceptionCache();
    if (!Array.isArray(cache.expenses)) cache.expenses = [];
    cache.expenses.forEach(function (e) {
      if (e.expenseId === expenseId) { e.status = 'VOID'; e._pending = true; }
    });
    setReceptionCache(cache);
    var financeCache = getFinanceCache();
    (financeCache.expenses || []).forEach(function (e) {
      if (e.expenseId === expenseId) { e.status = 'VOID'; e._pending = true; }
    });
    setFinanceCache(financeCache);
    return write('voidExpense', { expenseId: expenseId, reason: reason, recordVersion: recordVersion });
  }

  /**
   * Saves a manual cash-in receipt.
   */
  function saveReceipt(receiptData) {
    if (!receiptData.receiptId) receiptData.receiptId = FinanceCore.genReceiptId ? FinanceCore.genReceiptId() : FinanceCore.genExpenseId().replace(/^EXP-/, 'RCT-');
    var cache = getFinanceCache();
    if (!Array.isArray(cache.receipts)) cache.receipts = [];
    var idx = cache.receipts.findIndex(function (r) { return r.receiptId === receiptData.receiptId; });
    if (!receiptData.recordVersion) receiptData.recordVersion = idx >= 0 ? String(cache.receipts[idx].recordVersion || '1') : '1';
    if (idx >= 0) cache.receipts[idx] = Object.assign({}, cache.receipts[idx], receiptData, { _pending: true });
    else cache.receipts.push(Object.assign({}, receiptData, { status: 'ACTIVE', _pending: true }));
    setFinanceCache(cache);
    return write('upsertReceipt', receiptData);
  }

  /**
   * Voids a manual cash-in receipt while retaining its history.
   */
  function voidReceipt(receiptId, reason, recordVersion) {
    var cache = getFinanceCache();
    if (!Array.isArray(cache.receipts)) cache.receipts = [];
    cache.receipts.forEach(function (r) {
      if (r.receiptId === receiptId) { r.status = 'VOID'; r._pending = true; }
    });
    setFinanceCache(cache);
    return write('voidReceipt', { receiptId: receiptId, reason: reason, recordVersion: recordVersion });
  }

  /**
   * Closes the day (admin only).
   */
  function closeDay(closingData) {
    return write('closeDay', closingData);
  }

  /**
   * Reopens a closed day (admin only).
   */
  function reopenDay(businessDate, reopenReason) {
    return write('reopenDay', { businessDate: businessDate, reopenReason: reopenReason });
  }

  /* ----------------------------------------------------------
     PUBLIC API — READ / REFRESH OPERATIONS
  ---------------------------------------------------------- */

  /**
   * Loads the reception day data from server and updates cache.
   * Falls back to cache on network failure.
   * @param {string} date — 'YYYY-MM-DD', default today IST
   */
  async function refreshReceptionDay(date) {
    if (!date) date = FinanceCore.toISTDateString();
    var cache = getReceptionCache();

    if (!_isConfigured() || !navigator.onLine) {
      return { ok: true, fromCache: true, data: cache };
    }

    try {
      _broadcastStatus(STATUS.SYNCING);
      var data = await _getRequest({ action: 'receptionistDay', date: date });
      if (data.ok) {
        // Merge pending (unsync'd) local operations into server data
        var merged = _mergePending(data, cache);
        setReceptionCache(merged);
        _lsSet(KEYS.lastSync, new Date().toISOString());
        _broadcastStatus(STATUS.ONLINE);
        return { ok: true, fromCache: false, data: merged };
      }
      return { ok: false, fromCache: true, data: cache, error: data.error };
    } catch (err) {
      console.warn('[FinanceStore] refreshReceptionDay failed:', err.message);
      _broadcastStatus(STATUS.ERROR, err.message);
      return { ok: false, fromCache: true, data: cache, error: err.message };
    }
  }

  /**
   * Loads the finance summary for a date range.
   */
  async function refreshFinanceSummary(from, to) {
    var cache = getFinanceCache();
    if (!_isConfigured() || !navigator.onLine) {
      return { ok: true, fromCache: true, data: cache };
    }
    try {
      _broadcastStatus(STATUS.SYNCING);
      var data = await _getRequest({ action: 'financeSummary', from: from, to: to });
      if (data.ok) {
        // A stale deployment may still answer financeSummary with the old
        // receptionist payload. Never replace a valid finance cache with it.
        var isFinancePayload = Array.isArray(data.bills) || Array.isArray(data.payments) || Array.isArray(data.receipts) || Array.isArray(data.expenses) || Array.isArray(data.patientFees) || Array.isArray(data.completedVisits) || !!data.summary;
        if (!isFinancePayload) {
          var unavailableMessage = 'Finance summary response is not available yet.';
          _broadcastStatus(STATUS.ERROR, unavailableMessage);
          return { ok: false, fromCache: true, data: cache, error: unavailableMessage };
        }
        setFinanceCache(_mergePending(data, cache));
        _broadcastStatus(STATUS.ONLINE);
        return { ok: true, fromCache: false, data: getFinanceCache() };
      }
      return { ok: false, fromCache: true, data: cache };
    } catch (err) {
      _broadcastStatus(STATUS.ERROR, err.message);
      return { ok: false, fromCache: true, data: cache, error: err.message };
    }
  }

  /**
   * Loads outstanding balances.
   */
  async function refreshOutstanding(patientId) {
    var params = { action: 'outstanding' };
    if (patientId) params.patientId = patientId;
    try {
      var data = await _getRequest(params);
      if (data.ok) {
        var cache = getFinanceCache();
        cache.outstanding = data.outstanding;
        (data.outstanding || []).forEach(function (o) {
          if (!(cache.bills || []).some(function (b) { return b.billId === o.billId; })) {
            cache.bills.push({
              billId: o.billId,
              patientId: o.patientId,
              patientName: o.patientName,
              phone: o.phone,
              billDate: o.billDate,
              netBillAmount: o.netBillAmount,
              status: o.status
            });
          }
        });
        setFinanceCache(cache);
      }
      return data;
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Patient search.
   */
  async function searchPatients(query) {
    if (!query || !query.trim()) return { ok: true, results: [] };
    try {
      return await _getRequest({ action: 'patientSearch', q: query.trim(), limit: 20 });
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Merges pending local operations into fresh server data so optimistic
   * updates remain visible while waiting for sync.
   */
  function _mergePending(serverData, localCache) {
    var queue = getQueue();
    var pendingOps = queue.filter(function (op) {
      return op.status === 'pending' || op.status === 'retry' || op.status === 'syncing';
    });

    if (pendingOps.length === 0) return serverData;

    // Use server data as base, then overlay pending local changes
    var merged = JSON.parse(JSON.stringify(serverData));
    if (!merged.appointments) merged.appointments = [];
    if (!merged.bills)        merged.bills = [];
    if (!merged.payments)     merged.payments = [];
    if (!merged.receipts)     merged.receipts = [];
    if (!merged.expenses)     merged.expenses = [];
    if (!merged.collectionTasks) merged.collectionTasks = [];
    if (!merged.patientFees)  merged.patientFees = [];
    if (!merged.completedVisits) merged.completedVisits = [];

    pendingOps.forEach(function (op) {
      var p = op.payload;
      if (!p) return;

      if (op.action === 'upsertAppointment' && p.appointmentId) {
        var idx = merged.appointments.findIndex(function (a) { return a.appointmentId === p.appointmentId; });
        if (idx >= 0) merged.appointments[idx] = Object.assign({}, merged.appointments[idx], p, { _pending: true });
        else merged.appointments.push(Object.assign({}, p, { _pending: true }));
      }
      if (op.action === 'updateAppointmentStatus' && p.appointmentId) {
        merged.appointments.forEach(function (a) {
          if (a.appointmentId === p.appointmentId) { a.status = p.status; a._pending = true; }
        });
      }
      if (op.action === 'upsertBill' && p.billId) {
        var bidx = merged.bills.findIndex(function (b) { return b.billId === p.billId; });
        if (bidx >= 0) merged.bills[bidx] = Object.assign({}, merged.bills[bidx], p, { _pending: true });
        else merged.bills.push(Object.assign({}, p, { status: 'DRAFT', _pending: true }));
      }
      if (op.action === 'recordPayment' && p.paymentId) {
        var pidx = merged.payments.findIndex(function (pay) { return pay.paymentId === p.paymentId; });
        if (pidx < 0) merged.payments.push(Object.assign({}, p, { status: 'ACTIVE', _pending: true }));
      }
      if (op.action === 'upsertReceipt' && p.receiptId) {
        var ridx = merged.receipts.findIndex(function (r) { return r.receiptId === p.receiptId; });
        if (ridx >= 0) merged.receipts[ridx] = Object.assign({}, merged.receipts[ridx], p, { _pending: true });
        else merged.receipts.push(Object.assign({}, p, { status: 'ACTIVE', _pending: true }));
      }
      if (op.action === 'voidReceipt' && p.receiptId) {
        merged.receipts.forEach(function (r) {
          if (r.receiptId === p.receiptId) { r.status = 'VOID'; r._pending = true; }
        });
      }
      if (op.action === 'upsertExpense' && p.expenseId) {
        var eidx = merged.expenses.findIndex(function (e) { return e.expenseId === p.expenseId; });
        if (eidx >= 0) merged.expenses[eidx] = Object.assign({}, merged.expenses[eidx], p, { _pending: true });
        else merged.expenses.push(Object.assign({}, p, { status: 'ACTIVE', _pending: true }));
      }
      if (op.action === 'voidExpense' && p.expenseId) {
        merged.expenses.forEach(function (e) {
          if (e.expenseId === p.expenseId) { e.status = 'VOID'; e._pending = true; }
        });
      }
      if (op.action === 'upsertCollectionTask' && p.taskId) {
        var tidx = merged.collectionTasks.findIndex(function (task) { return task.taskId === p.taskId; });
        if (tidx >= 0) merged.collectionTasks[tidx] = Object.assign({}, merged.collectionTasks[tidx], p, { _pending: true });
        else merged.collectionTasks.push(Object.assign({}, p, { _pending: true }));
      }
    });

    return merged;
  }

  /* ----------------------------------------------------------
     SYNC STATUS HELPERS (used by UI)
  ---------------------------------------------------------- */

  function getSyncStatus() {
    var queue  = getQueue();
    var pending = queue.filter(function (op) { return op.status === 'pending' || op.status === 'retry'; }).length;
    var errors  = queue.filter(function (op) { return op.status === 'error'; }).length;
    var lastSync = _lsGet(KEYS.lastSync, null);
    return {
      status:       _currentStatus,
      pendingCount: pending,
      errorCount:   errors,
      lastSync:     lastSync,
      isOnline:     typeof navigator !== 'undefined' ? navigator.onLine : true
    };
  }

  function getPendingOperations() {
    return getQueue().filter(function (op) {
      return op.status !== 'synced';
    });
  }

  function getErrorOperations() {
    return getQueue().filter(function (op) { return op.status === 'error'; });
  }

  /* ----------------------------------------------------------
     INITIALIZATION — process any pending operations on startup
  ---------------------------------------------------------- */

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', function () {
      var pending = getQueue().filter(function (op) {
        return op.status === 'pending' || op.status === 'retry' || op.status === 'syncing';
      });
      // Reset "syncing" (crashed mid-sync) back to "retry"
      if (pending.some(function (op) { return op.status === 'syncing'; })) {
        var q = getQueue();
        q.forEach(function (op) { if (op.status === 'syncing') op.status = 'retry'; });
        _saveQueue(q);
      }
      if (navigator.onLine && pending.length > 0) {
        setTimeout(_processQueue, 1000);
      }
      // Set initial status
      _broadcastStatus(navigator.onLine ? STATUS.ONLINE : STATUS.OFFLINE);
    });
  }

  /* ----------------------------------------------------------
     EXPORT
  ---------------------------------------------------------- */

  var FinanceStore = {
    // Status
    STATUS:               STATUS,
    onStatusChange:       onStatusChange,
    getSyncStatus:        getSyncStatus,
    getPendingOperations: getPendingOperations,
    getErrorOperations:   getErrorOperations,
    retryOperation:       retryOperation,
    clearSyncedOperations: clearSyncedOperations,

    // User
    getCurrentUser:   getCurrentUser,
    setCurrentUser:   setCurrentUser,
    clearCurrentUser: clearCurrentUser,

    // Cache access
    getReceptionCache: getReceptionCache,
    getFinanceCache:   getFinanceCache,

    // Write operations (optimistic + queued)
    saveAppointment:          saveAppointment,
    updateAppointmentStatus:  updateAppointmentStatus,
    saveBill:                 saveBill,
    saveAndPostBill:          saveAndPostBill,
    postBill:                 postBill,
    voidBill:                 voidBill,
    recordPayment:            recordPayment,
    saveCollectionTask:       saveCollectionTask,
    updateCollectionTask:     updateCollectionTask,
    saveExpense:              saveExpense,
    voidExpense:              voidExpense,
    saveReceipt:              saveReceipt,
    voidReceipt:              voidReceipt,
    closeDay:                 closeDay,
    reopenDay:                reopenDay,

    // Read / refresh operations
    refreshReceptionDay:    refreshReceptionDay,
    refreshFinanceSummary:  refreshFinanceSummary,
    refreshOutstanding:     refreshOutstanding,
    searchPatients:         searchPatients,

    // Internal (exposed for testing)
    _processQueue: _processQueue,
    _getQueue:     getQueue
  };

  window.FinanceStore = FinanceStore;

})();
