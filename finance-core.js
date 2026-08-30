/* =========================================================
   finance-core.js
   Pure financial calculation functions — no DOM, no network.
   Safe to import in Node (for tests) and in the browser.

   Clinic Doctor Prescription Software
   ========================================================= */

(function (exports) {
  'use strict';

  /* ----------------------------------------------------------
     1. CONSTANTS
  ---------------------------------------------------------- */
  var TIMEZONE = 'Asia/Calcutta';

  var PAYMENT_MODES  = ['CASH', 'UPI', 'CARD', 'BANK', 'OTHER'];
  var BILL_STATUSES  = ['DRAFT', 'POSTED', 'PART_PAID', 'PAID', 'VOID'];
  var PAYMENT_TYPES  = ['PAYMENT', 'REFUND', 'REVERSAL'];
  var EXPENSE_STATUSES = ['ACTIVE', 'VOID'];
  var APPT_STATUSES  = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'IN_CONSULTATION',
                         'COMPLETED', 'CANCELLED', 'NO_SHOW'];

  /* ----------------------------------------------------------
     2. ID GENERATORS
     Format: PREFIX-<13-digit timestamp>-<4-char random hex>
     Client-generated so offline writes remain stable.
  ---------------------------------------------------------- */

  function _genId(prefix) {
    var ts   = Date.now();
    var rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0').toUpperCase();
    return prefix + '-' + ts + '-' + rand;
  }

  var genPatientId     = function () { return _genId('PAT'); };
  var genVisitId       = function () { return _genId('VIS'); };
  var genAppointmentId = function () { return _genId('APT'); };
  var genBillId        = function () { return _genId('BIL'); };
  var genPaymentId     = function () { return _genId('PAY'); };
  var genReceiptId     = function () { return _genId('RCT'); };
  var genExpenseId     = function () { return _genId('EXP'); };
  var genAuditId       = function () { return _genId('AUD'); };
  var genOperationId   = function () { return _genId('OP');  };

  /* ----------------------------------------------------------
     3. ID VALIDATION
  ---------------------------------------------------------- */

  var ID_PATTERN = /^[A-Z]+-\d{13}-[0-9A-F]{4}$/;
  var LEGACY_PATTERN = /^LEG-(PAT|VIS|BIL|PAY|EXP)-[A-Z0-9]+$/;

  function isValidId(id) {
    if (typeof id !== 'string' || !id) return false;
    return ID_PATTERN.test(id) || LEGACY_PATTERN.test(id);
  }

  /* ----------------------------------------------------------
     4. CURRENCY — Indian formatting (₹1,23,456.78)
  ---------------------------------------------------------- */

  function formatINR(amount) {
    var n = parseFloat(amount);
    if (!isFinite(n)) return '₹0.00';
    // Use Intl if available (browser/modern Node), fall back to manual
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      try {
        return new Intl.NumberFormat('en-IN', {
          style: 'currency',
          currency: 'INR',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        }).format(n);
      } catch (e) { /* fall through */ }
    }
    // Manual fallback
    var fixed  = Math.abs(n).toFixed(2);
    var parts  = fixed.split('.');
    var intPart = parts[0];
    var decPart = parts[1];
    var result = '';
    var len = intPart.length;
    if (len <= 3) {
      result = intPart;
    } else {
      result = intPart.slice(-3);
      var rem = intPart.slice(0, len - 3);
      while (rem.length > 2) {
        result = rem.slice(-2) + ',' + result;
        rem = rem.slice(0, rem.length - 2);
      }
      result = rem + ',' + result;
    }
    return (n < 0 ? '-' : '') + '₹' + result + '.' + decPart;
  }

  /* ----------------------------------------------------------
     5. DATE HELPERS — Asia/Calcutta boundaries
  ---------------------------------------------------------- */

  /**
   * Returns "YYYY-MM-DD" in IST for a given Date (or now).
   */
  function toISTDateString(date) {
    var d = date instanceof Date ? date : new Date(date || Date.now());
    if (isNaN(d.getTime())) return '';
    // IST = UTC + 5:30
    var ist = new Date(d.getTime() + (5 * 60 + 30) * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  }

  /**
   * Returns the IST start-of-day (midnight IST) as a UTC Date.
   */
  function istStartOfDay(dateStr) {
    // dateStr is "YYYY-MM-DD" in IST
    return new Date(dateStr + 'T00:00:00+05:30');
  }

  /**
   * Returns the IST end-of-day (23:59:59.999 IST) as a UTC Date.
   */
  function istEndOfDay(dateStr) {
    return new Date(dateStr + 'T23:59:59.999+05:30');
  }

  /**
   * Returns { start: Date, end: Date } for the given period in IST.
   * period: 'today' | 'week' | 'month' | { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
   */
  function getDateRange(period, referenceDate) {
    var today = toISTDateString(referenceDate || new Date());
    if (period === 'today' || period === 'day') {
      return { start: istStartOfDay(today), end: istEndOfDay(today) };
    }
    if (period === 'week') {
      var todayDate  = new Date(today + 'T00:00:00+05:30');
      // Convert the IST midnight instant back to a local calendar date before
      // asking for the weekday. getUTCDay() sees the previous UTC evening and
      // therefore shifts the clinic week by one day.
      var todayParts = today.split('-');
      var dow = new Date(
        parseInt(todayParts[0], 10),
        parseInt(todayParts[1], 10) - 1,
        parseInt(todayParts[2], 10)
      ).getDay(); // 0=Sun
      var mondayOffset = (dow === 0) ? -6 : 1 - dow;
      var monday = new Date(todayDate.getTime() + mondayOffset * 86400000);
      var sunday = new Date(monday.getTime() + 6 * 86400000);
      var mondayStr = toISTDateString(monday);
      var sundayStr = toISTDateString(sunday);
      return { start: istStartOfDay(mondayStr), end: istEndOfDay(sundayStr) };
    }
    if (period === 'month') {
      var ym = today.slice(0, 7); // "YYYY-MM"
      var firstDay = ym + '-01';
      // Last day: go to first day of next month, subtract 1 day
      var nextMonth = new Date(istStartOfDay(firstDay).getTime() + 32 * 86400000);
      var lastDay = toISTDateString(new Date(
        new Date(nextMonth.getTime()).getTime() - nextMonth.getUTCDate() * 86400000
      ));
      // Simpler approach: compute last day directly
      var parts = ym.split('-');
      var yr = parseInt(parts[0], 10);
      var mo = parseInt(parts[1], 10);
      var lastDayNum = new Date(yr, mo, 0).getDate(); // mo is already 1-based, so Date(yr, mo, 0) is last day of mo-1... use mo directly
      lastDay = ym + '-' + String(lastDayNum).padStart(2, '0');
      return { start: istStartOfDay(firstDay), end: istEndOfDay(lastDay) };
    }
    if (period === 'year') {
      var year = today.slice(0, 4);
      return {
        start: istStartOfDay(year + '-01-01'),
        end: istEndOfDay(year + '-12-31')
      };
    }
    if (period && period.from && period.to) {
      return { start: istStartOfDay(period.from), end: istEndOfDay(period.to) };
    }
    // Default: today
    return { start: istStartOfDay(today), end: istEndOfDay(today) };
  }

  /**
   * Returns true if dateStr (ISO string or "YYYY-MM-DD") falls within [start, end].
   */
  function isInRange(dateStr, start, end) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    return d >= start && d <= end;
  }

  /* ----------------------------------------------------------
     6. NUMERIC SAFETY
  ---------------------------------------------------------- */

  function toNum(v) {
    var n = parseFloat(v);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function toSignedNum(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /* ----------------------------------------------------------
     7. BILL CALCULATIONS
  ---------------------------------------------------------- */

  /**
   * Validates and sums bill items.
   * items: [{ quantity, unitPrice }]
   * Returns { currentCharges, isValid, itemTotal }
   */
  function calcItemTotal(items) {
    if (!Array.isArray(items) || items.length === 0) {
      return { currentCharges: 0, isValid: true, itemTotal: 0 };
    }
    var total = 0;
    var isValid = true;
    items.forEach(function (item) {
      var q = toNum(item.quantity);
      var p = toNum(item.unitPrice);
      var lineAmt = round2(q * p);
      // If item.amount is provided, validate it matches
      if (item.amount !== undefined && item.amount !== null && item.amount !== '') {
        if (Math.abs(toNum(item.amount) - lineAmt) > 0.01) isValid = false;
      }
      total += lineAmt;
    });
    return { currentCharges: round2(total), isValid: isValid, itemTotal: round2(total) };
  }

  /**
   * Calculates bill totals.
   * @param {Object} params
   *   items:    array of bill line items
   *   discount: discount amount (default 0)
   * @returns { currentCharges, discount, netBillAmount, isValid }
   */
  function calcBillTotals(params) {
    params = params || {};
    var itemResult = calcItemTotal(params.items || []);
    var currentCharges = itemResult.currentCharges;
    var discount = round2(toNum(params.discount));
    if (discount > currentCharges) discount = currentCharges; // can't discount more than charged
    var netBillAmount = round2(currentCharges - discount);
    return {
      currentCharges: currentCharges,
      discount: discount,
      netBillAmount: netBillAmount,
      isValid: itemResult.isValid && netBillAmount >= 0
    };
  }

  /**
   * Calculates the outstanding balance for one patient or one bill.
   * @param {number[]} postedNetBillAmounts  — netBillAmount for each POSTED/PART_PAID bill
   * @param {number[]} effectivePayments     — amount for each effective (non-void, non-reversed) payment
   * @returns {number} outstanding (never below 0)
   */
  function calcOutstanding(postedNetBillAmounts, effectivePayments) {
    var totalBilled = (postedNetBillAmounts || []).reduce(function (s, v) {
      return s + round2(toNum(v));
    }, 0);
    var totalPaid = (effectivePayments || []).reduce(function (s, v) {
      return s + round2(toNum(v));
    }, 0);
    return round2(Math.max(0, totalBilled - totalPaid));
  }

  /**
   * Shows the amount due on the current bill screen (for display only).
   * priorOutstandingSnapshot is for display context — it does NOT become new revenue.
   *
   * @param {number} netBillAmount            — net charges for this visit
   * @param {number} priorOutstandingSnapshot — prior balance shown on bill
   * @param {number} paymentsAppliedNow       — payments applied during this visit
   * @returns {number} amountDueNow
   */
  function calcAmountDueNow(netBillAmount, priorOutstandingSnapshot, paymentsAppliedNow) {
    var due = round2(
      toNum(netBillAmount) +
      toNum(priorOutstandingSnapshot) -
      toNum(paymentsAppliedNow)
    );
    return Math.max(0, due);
  }

  /* ----------------------------------------------------------
     8. PAYMENT EFFECTIVE AMOUNT
     A PAYMENT adds to collected.
     A REFUND or REVERSAL subtracts from effective total of original payment.
  ---------------------------------------------------------- */

  /**
   * Filters payments to only effective ones (excludes VOID, and handles REFUND/REVERSAL).
   * @param {Object[]} payments — raw payment rows
   * @returns {Object[]} effective payments (PAYMENT type, not voided, not reversed)
   */
  function getEffectivePayments(payments) {
    if (!Array.isArray(payments)) return [];
    // Accumulate corrections against each original payment. A partial refund
    // reduces the effective amount; only a full refund/reversal removes it.
    var correctedAmounts = {};
    payments.forEach(function (p) {
      if ((p.transactionType === 'REVERSAL' || p.transactionType === 'REFUND') &&
          p.status !== 'VOID' && p.reversesPaymentId) {
        correctedAmounts[p.reversesPaymentId] = round2(
          (correctedAmounts[p.reversesPaymentId] || 0) + toNum(p.amount)
        );
      }
    });
    return payments.reduce(function (effective, p) {
      if (p.status === 'VOID') return effective;
      if (p.transactionType !== 'PAYMENT') return effective;
      var remaining = round2(Math.max(0, toNum(p.amount) - (correctedAmounts[p.paymentId] || 0)));
      if (remaining > 0) effective.push(Object.assign({}, p, { amount: remaining }));
      return effective;
    }, []);
  }

  /**
   * Calculates net amount received from a set of payment rows.
   * Accounts for refunds and reversals correctly.
   */
  function calcNetCollected(payments) {
    if (!Array.isArray(payments)) return 0;
    var total = 0;
    payments.forEach(function (p) {
      if (p.status === 'VOID') return;
      var amt = toNum(p.amount);
      if (p.transactionType === 'PAYMENT') total += amt;
      else if (p.transactionType === 'REFUND' || p.transactionType === 'REVERSAL') total -= amt;
    });
    return round2(total);
  }

  /* ----------------------------------------------------------
     9. PERIOD AGGREGATION
  ---------------------------------------------------------- */

  /**
   * Aggregates billed revenue for a period.
   * Revenue = sum(netBillAmount) for POSTED/PART_PAID/PAID bills whose billDate is in range.
   * Does NOT include prior outstanding snapshot.
   *
   * @param {Object[]} bills    — all bill records
   * @param {Date}     start    — range start (inclusive)
   * @param {Date}     end      — range end (inclusive)
   * @returns {Object} { billedRevenue, billCount, bills[] }
   */
  function aggregateBilledRevenue(bills, start, end) {
    if (!Array.isArray(bills)) return { billedRevenue: 0, billCount: 0, bills: [] };
    var active = ['POSTED', 'PART_PAID', 'PAID'];
    var inRange = bills.filter(function (b) {
      return active.indexOf(b.status) !== -1 &&
             isInRange(b.billDate || b.date, start, end);
    });
    var total = inRange.reduce(function (s, b) { return s + toNum(b.netBillAmount); }, 0);
    return { billedRevenue: round2(total), billCount: inRange.length, bills: inRange };
  }

  /**
   * Aggregates collections for a period.
   * Collections use PAYMENT DATE (not bill date) — old dues collected today count today.
   *
   * @param {Object[]} payments — all payment rows
   * @param {Date}     start
   * @param {Date}     end
   * @returns {Object} { totalCollected, byMode, oldDuesCollected, payments[] }
   */
  function aggregateCollections(payments, start, end, bills) {
    if (!Array.isArray(payments)) return { totalCollected: 0, byMode: {}, oldDuesCollected: 0, payments: [] };

    // Build billDate lookup
    var billDateMap = {};
    if (Array.isArray(bills)) {
      bills.forEach(function (b) { billDateMap[b.billId] = b.billDate || b.date || ''; });
    }

    var inRange = payments.filter(function (p) {
      if (p.status === 'VOID') return false;
      return isInRange(p.paymentDate || p.createdAt, start, end);
    });

    var totalCollected = 0;
    var oldDuesCollected = 0;
    var byMode = {};

    inRange.forEach(function (p) {
      var amt = toNum(p.amount);
      var sign = (p.transactionType === 'PAYMENT') ? 1 : -1;
      var net  = amt * sign;

      totalCollected += net;

      var mode = (p.paymentMode || 'OTHER').toUpperCase();
      byMode[mode] = (byMode[mode] || 0) + net;

      // Is this payment on an OLD bill (bill not in the same period)?
      var billDate = billDateMap[p.billId] || '';
      if (billDate && p.transactionType === 'PAYMENT' && !isInRange(billDate, start, end)) {
        oldDuesCollected += amt;
      }
    });

    return {
      totalCollected: round2(totalCollected),
      byMode: byMode,
      oldDuesCollected: round2(oldDuesCollected),
      payments: inRange
    };
  }

  /**
   * Aggregates active expenses for a period.
   *
   * @param {Object[]} expenses — all expense rows
   * @param {Date}     start
   * @param {Date}     end
   * @returns {Object} { totalExpenses, byCategory, byMode, expenses[] }
   */
  function aggregateExpenses(expenses, start, end) {
    if (!Array.isArray(expenses)) return { totalExpenses: 0, byCategory: {}, byMode: {}, expenses: [] };
    var inRange = expenses.filter(function (e) {
      return e.status !== 'VOID' &&
             isInRange(e.expenseDate || e.date, start, end);
    });
    var total = 0;
    var byCategory = {};
    var byMode = {};
    inRange.forEach(function (e) {
      var amt = toNum(e.amount);
      total += amt;
      var cat  = e.category  || 'Other';
      var mode = (e.paymentMode || 'OTHER').toUpperCase();
      byCategory[cat]  = (byCategory[cat]  || 0) + amt;
      byMode[mode]     = (byMode[mode]     || 0) + amt;
    });
    return {
      totalExpenses: round2(total),
      byCategory: byCategory,
      byMode: byMode,
      expenses: inRange
    };
  }

  /**
   * Builds the unified cashbook used by the Finance screen.
   *
   * The returned entries are calculated in chronological order so every
   * balance is meaningful, then grouped newest-date-first for presentation.
   * `filter` accepts `all`, `in`, `out`, or `bills`.
   */
  function buildCashbookEntries(data, opts) {
    data = data || {};
    opts = opts || {};
    var period = opts.period || 'day';
    var anchor = opts.anchorDate ? new Date(String(opts.anchorDate) + 'T00:00:00+05:30') : new Date();
    var range = getDateRange(period, anchor);
    var filter = opts.filter || 'all';
    var billsById = {};
    (data.bills || []).forEach(function (bill) {
      if (bill && bill.billId) billsById[bill.billId] = bill;
    });
    var raw = [];
    var formalFeeVisits = {};

    function feeVisitKey(patientName, patientId, date) {
      var identity = String(patientId || patientName || '').trim().toLowerCase();
      return identity + '|' + String(date || '').slice(0, 10);
    }

    function rememberFormalFee(patient, bill, date) {
      var name = (bill && bill.patientName) || patient.patientName || patient.name || '';
      var id = patient.patientId || (bill && bill.patientId) || '';
      formalFeeVisits[feeVisitKey(name, id, date)] = true;
    }

    function addLegacyFee(entry, patientName, patientId, date) {
      if (formalFeeVisits[feeVisitKey(patientName, patientId, date)]) return;
      addEntry(entry);
    }

    function addEntry(entry) {
      var amount = toNum(entry.amount);
      var isActivity = entry.source === 'completed-visit';
      if ((!amount && !isActivity) || !entry.date || !isInRange(entry.date, range.start, range.end)) return;
      if (filter === 'bills' && entry.source !== 'patient-fee') return;
      if (filter === 'in' && entry.cashIn <= 0) return;
      if (filter === 'out' && entry.cashOut <= 0) return;
      raw.push(Object.assign({}, entry, { amount: round2(amount) }));
    }

    (data.payments || []).forEach(function (payment) {
      if (!payment || payment.status === 'VOID') return;
      var type = String(payment.transactionType || 'PAYMENT').toUpperCase();
      var bill = billsById[payment.billId];
      var date = payment.paymentDate || payment.createdAt || payment.date;
      var isIn = type === 'PAYMENT';
      if (isIn) rememberFormalFee(payment, bill, date);
      addEntry({
        date: date,
        time: date,
        label: isIn ? ((bill && bill.patientName) ? bill.patientName + ' fees' : ((payment.patientName || payment.name) ? (payment.patientName || payment.name) + ' fees' : 'Patient payment')) : (type === 'REFUND' ? 'Payment refund' : 'Payment reversal'),
        source: isIn && payment.billId ? 'patient-fee' : 'payment',
        sourceId: payment.paymentId || '',
        billId: payment.billId || '',
        patientName: payment.patientName || payment.name || (bill && bill.patientName) || '',
        amount: payment.amount,
        cashIn: isIn ? toNum(payment.amount) : 0,
        cashOut: isIn ? 0 : toNum(payment.amount),
        paymentMode: payment.paymentMode || 'OTHER'
      });
    });

    // Older Clinic visits store collected fees directly on the main patient
    // record instead of creating a Payments row. Keep those real collections
    // in the same cashbook, while formal Payments remain the source of truth
    // when both representations exist for the same visit.
    (data.patientFees || []).forEach(function (record) {
      var paid = toNum(record.billPaid == null ? record.paidAmount : record.billPaid);
      if (paid <= 0) return;
      var date = record.date || record.billDate || record.timestamp;
      addLegacyFee({
        date: date,
        time: record.timestamp || date,
        label: (record.name || record.patientName || 'Patient') + ' fees',
        source: 'patient-fee',
        sourceId: record.visitId || record.patientId || (record.name + '|' + date),
        billId: record.billId || '',
        patientName: record.name || record.patientName || '',
        amount: paid,
        cashIn: paid,
        cashOut: 0,
        paymentMode: record.billMode || record.paymentMode || 'OTHER'
      }, record.name || record.patientName, record.patientId, date);
    });

    // The original Generate Bill flow writes paidAmount to the legacy Bills
    // sheet. Include it when there is no formal Payments row, so no genuine
    // collection disappears from Finance during the migration.
    (data.bills || []).forEach(function (bill) {
      var paid = toNum(bill.paidAmount == null ? bill.billPaid : bill.paidAmount);
      if (paid <= 0) return;
      var date = bill.paidDate || bill.date || bill.billDate || bill.timestamp;
      addLegacyFee({
        date: date,
        time: bill.timestamp || date,
        label: (bill.patientName || 'Patient') + ' fees',
        source: 'patient-fee',
        sourceId: bill.billId || bill.id || (bill.patientName + '|' + date),
        billId: bill.billId || bill.id || '',
        patientName: bill.patientName || '',
        amount: paid,
        cashIn: paid,
        cashOut: 0,
        paymentMode: bill.billMode || bill.paymentMode || 'OTHER'
      }, bill.patientName, bill.patientId, date);
    });

    // A completed visit with no payment is still useful context in Finance,
    // but it must not change cash totals or appear as Cash In/Cash Out.
    (data.completedVisits || []).forEach(function (visit) {
      var date = visit.completedAt || visit.date || visit.timestamp || visit.updatedAt;
      var name = visit.patientName || visit.name || 'Completed patient visit';
      addEntry({
        date: date,
        time: visit.completedAt || visit.timestamp || date,
        label: name + ' — Completed visit',
        source: 'completed-visit',
        sourceId: visit.visitId || visit.id || (name + '|' + date),
        amount: 0,
        cashIn: 0,
        cashOut: 0
      });
    });

    (data.receipts || []).forEach(function (receipt) {
      if (!receipt || receipt.status === 'VOID') return;
      var receiptDate = receipt.receiptDate || receipt.date || receipt.createdAt;
      addEntry({
        date: receiptDate,
        time: receiptDate,
        label: receipt.description || receipt.patientName || 'Cash receipt',
        source: 'receipt',
        sourceId: receipt.receiptId || receipt.id || '',
        amount: receipt.amount,
        cashIn: toNum(receipt.amount),
        cashOut: 0,
        paymentMode: receipt.paymentMode || 'OTHER'
      });
    });

    (data.expenses || []).forEach(function (expense) {
      if (!expense || expense.status === 'VOID') return;
      var expenseDate = expense.expenseDate || expense.date || expense.createdAt;
      addEntry({
        date: expenseDate,
        time: expenseDate,
        label: expense.description || expense.category || 'Expense',
        source: expense.source || 'expense',
        sourceId: expense.expenseId || expense.id || '',
        amount: expense.amount,
        cashIn: 0,
        cashOut: toNum(expense.amount),
        paymentMode: expense.paymentMode || 'OTHER'
      });
    });

    raw.sort(function (a, b) {
      return new Date(a.date).getTime() - new Date(b.date).getTime() ||
        String(a.sourceId).localeCompare(String(b.sourceId));
    });
    var running = 0;
    raw.forEach(function (entry) {
      running = round2(running + entry.cashIn - entry.cashOut);
      entry.balance = running;
    });

    var groups = {};
    raw.forEach(function (entry) {
      var dateKey = toISTDateString(new Date(entry.date));
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
    });
    var days = Object.keys(groups).sort(function (a, b) { return b.localeCompare(a); }).map(function (date) {
      return { date: date, entries: groups[date].slice().sort(function (a, b) {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      }) };
    });
    return {
      days: days,
      totals: {
        cashIn: round2(raw.reduce(function (sum, entry) { return sum + entry.cashIn; }, 0)),
        cashOut: round2(raw.reduce(function (sum, entry) { return sum + entry.cashOut; }, 0)),
        balance: round2(running)
      }
    };
  }

  /* ----------------------------------------------------------
     10. CASH CLOSING CALCULATION
  ---------------------------------------------------------- */

  /**
   * Calculates expected closing cash and difference.
   *
   * @param {Object} params
   *   openingCash:   cash in drawer at start of day
   *   cashPayments:  CASH payments received (PAYMENT type only)
   *   cashRefunds:   CASH refunds/reversals
   *   cashExpenses:  CASH expenses paid out
   * @returns { expectedClosingCash, cashDifference, netCashMovement }
   */
  function calcCashClosing(params) {
    params = params || {};
    var openingCash   = toNum(params.openingCash);
    var cashPayments  = toNum(params.cashPayments);
    var cashRefunds   = toNum(params.cashRefunds);
    var cashExpenses  = toNum(params.cashExpenses);
    var allCollections    = toNum(params.allCollections);
    var allActiveExpenses = toNum(params.allActiveExpenses);
    var countedClosingCash = params.countedClosingCash !== undefined
      ? toSignedNum(params.countedClosingCash) : null;

    var expectedClosingCash = round2(openingCash + cashPayments - cashRefunds - cashExpenses);
    var cashDifference = countedClosingCash !== null
      ? round2(countedClosingCash - expectedClosingCash) : null;
    // Net cash movement is NOT profit — label it clearly in the UI
    var netCashMovement = round2(allCollections - allActiveExpenses);

    return {
      openingCash: openingCash,
      cashPayments: cashPayments,
      cashRefunds: cashRefunds,
      cashExpenses: cashExpenses,
      expectedClosingCash: expectedClosingCash,
      countedClosingCash: countedClosingCash,
      cashDifference: cashDifference,
      netCashMovement: netCashMovement
    };
  }

  /**
   * Extracts cash-only totals from a payments array for one business date.
   * @param {Object[]} payments
   * @param {string}   dateStr — "YYYY-MM-DD" IST
   */
  function extractCashTotals(payments, dateStr) {
    var start = istStartOfDay(dateStr);
    var end   = istEndOfDay(dateStr);
    var cashIn = 0, cashOut = 0;
    (payments || []).forEach(function (p) {
      if (p.status === 'VOID') return;
      if ((p.paymentMode || '').toUpperCase() !== 'CASH') return;
      if (!isInRange(p.paymentDate || p.createdAt, start, end)) return;
      var amt = toNum(p.amount);
      if (p.transactionType === 'PAYMENT') cashIn  += amt;
      else                                  cashOut += amt;
    });
    return { cashPayments: round2(cashIn), cashRefunds: round2(cashOut) };
  }

  /**
   * Extracts cash expense total for one business date.
   */
  function extractCashExpenses(expenses, dateStr) {
    var start = istStartOfDay(dateStr);
    var end   = istEndOfDay(dateStr);
    var total = 0;
    (expenses || []).forEach(function (e) {
      if (e.status === 'VOID') return;
      if ((e.paymentMode || '').toUpperCase() !== 'CASH') return;
      if (!isInRange(e.expenseDate || e.date, start, end)) return;
      total += toNum(e.amount);
    });
    return round2(total);
  }

  /* ----------------------------------------------------------
     11. BILL STATUS DERIVATION
     Derive the correct status from bill totals and payments.
  ---------------------------------------------------------- */

  /**
   * Derives bill status from payment state.
   * @param {number} netBillAmount
   * @param {number} totalPaidOnBill  — sum of effective payments allocated to this bill
   * @param {string} currentStatus    — existing status
   * @returns {string} new status
   */
  function deriveBillStatus(netBillAmount, totalPaidOnBill, currentStatus) {
    if (currentStatus === 'VOID' || currentStatus === 'DRAFT') return currentStatus;
    var due = round2(toNum(netBillAmount) - toNum(totalPaidOnBill));
    if (due <= 0) return 'PAID';
    if (totalPaidOnBill > 0) return 'PART_PAID';
    return 'POSTED';
  }

  /* ----------------------------------------------------------
     12. PAYMENT VALIDATION
  ---------------------------------------------------------- */

  /**
   * Validates a payment before submission.
   * Returns { valid: bool, errors: string[] }
   */
  function validatePayment(payment, bill, existingPayments) {
    var errors = [];
    if (!payment.billId)   errors.push('billId is required');
    if (!payment.patientId) errors.push('patientId is required');
    var amt = parseFloat(payment.amount);
    if (!isFinite(amt) || amt <= 0) errors.push('amount must be a positive number');
    if (PAYMENT_MODES.indexOf((payment.paymentMode || '').toUpperCase()) === -1) {
      errors.push('paymentMode must be one of: ' + PAYMENT_MODES.join(', '));
    }
    if (PAYMENT_TYPES.indexOf((payment.transactionType || '').toUpperCase()) === -1) {
      errors.push('transactionType must be one of: ' + PAYMENT_TYPES.join(', '));
    }
    // Validate against bill
    if (bill && payment.transactionType === 'PAYMENT') {
      var alreadyPaid = calcNetCollected(existingPayments || []);
      var balance = round2(toNum(bill.netBillAmount) - alreadyPaid);
      if (amt > balance + 0.01) {
        errors.push('payment amount (' + formatINR(amt) + ') exceeds outstanding balance (' + formatINR(balance) + ')');
      }
    }
    // Corrections must reference a real PAYMENT and may only consume the
    // amount that has not already been refunded/reversed.
    var paymentType = (payment.transactionType || '').toUpperCase();
    if (paymentType === 'REFUND' || paymentType === 'REVERSAL') {
      if (!payment.reversesPaymentId) {
        errors.push('reversesPaymentId is required for refunds and reversals');
      } else {
        var origPayment = (existingPayments || []).find(function (p) {
          return p.paymentId === payment.reversesPaymentId &&
                 p.transactionType === 'PAYMENT' && p.status !== 'VOID';
        });
        if (!origPayment) {
          errors.push('original payment was not found or is not active');
        } else {
          var alreadyCorrected = (existingPayments || []).reduce(function (sum, p) {
            if (p.status === 'VOID' || p.reversesPaymentId !== origPayment.paymentId) return sum;
            if (p.transactionType !== 'REFUND' && p.transactionType !== 'REVERSAL') return sum;
            return sum + toNum(p.amount);
          }, 0);
          var remainingRefundable = round2(Math.max(0, toNum(origPayment.amount) - alreadyCorrected));
          if (amt > remainingRefundable + 0.01) {
            errors.push((paymentType === 'REFUND' ? 'refund' : 'reversal') +
              ' cannot exceed remaining refundable amount of ' + formatINR(remainingRefundable));
          }
        }
      }
    }
    return { valid: errors.length === 0, errors: errors };
  }

  /* ----------------------------------------------------------
     13. LEGACY ID GENERATORS (for migration)
  ---------------------------------------------------------- */

  function genLegacyBillId(rowNumber)     { return 'LEG-BIL-' + rowNumber; }
  function genLegacyVisitId(rowNumber)    { return 'LEG-VIS-' + rowNumber; }
  function genLegacyExpenseId(rowNumber)  { return 'LEG-EXP-' + rowNumber; }

  /* ----------------------------------------------------------
     14. NORMALIZATION HELPERS
  ---------------------------------------------------------- */

  /**
   * Generates a deterministic cross-device ID for compatibility ledger rows.
   * The algorithm is intentionally dependency-free so Apps Script can mirror it.
   */
  function deterministicLedgerId(prefix, seed) {
    var text = String(seed == null ? '' : seed);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return String(prefix || 'LEG').toUpperCase() + '-' + (hash >>> 0).toString(36).toUpperCase();
  }

  /**
   * Converts the aggregate bill fields and Parag-style paymentHistory into
   * deterministic formal-payment-shaped rows. Fee events are audit metadata,
   * never cash movement.
   */
  function normalizePatientPaymentHistory(record) {
    record = record || {};
    var warnings = [];
    var billAmountRaw = parseFloat(record.billAmount);
    var billAmount = isFinite(billAmountRaw) && billAmountRaw > 0 ? round2(billAmountRaw) : 0;
    var billPaidRaw = parseFloat(record.billPaid);
    if (!isFinite(billPaidRaw)) billPaidRaw = 0;
    if (billPaidRaw < 0 || billPaidRaw > billAmount) {
      warnings.push('aggregate billPaid was outside the bill range and was clamped');
    }
    var billPaid = round2(Math.min(billAmount, Math.max(0, billPaidRaw)));
    var visitDate = String(record.date || '').trim();
    var visitKey = String(record.visitId || [record.name, record.phone, visitDate].join('|')).trim();
    var patientKey = String(record.patientId || [record.name, record.phone].join('|')).trim();
    var patientId = String(record.patientId || deterministicLedgerId('LEG-PAT', patientKey));
    var visitId = String(record.visitId || deterministicLedgerId('LEG-VIS', visitKey));
    var billId = String(record.billId || deterministicLedgerId('LEG-BIL', visitId));
    var history = record.paymentHistory;
    if (typeof history === 'string' && history.trim()) {
      try { history = JSON.parse(history); } catch (e) {
        history = [];
        warnings.push('paymentHistory was not valid JSON and was ignored');
      }
    }
    if (!Array.isArray(history)) history = [];

    var payments = [];
    var eventPayments = 0;
    var eventFees = 0;
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
      if (!eventDate) eventDate = record.timestamp || record.date || '';
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
      var mode = String(event.mode || event.paymentMode || record.billMode || 'CASH').toUpperCase();
      if (!isValidPaymentMode(mode)) {
        warnings.push('paymentHistory event ' + eventIndex + ' used OTHER payment mode');
        mode = 'OTHER';
      }
      var paymentId = String(event.paymentId || deterministicLedgerId(
        'LEG-PAY',
        billId + '|history|' + eventIndex + '|payment|' + eventDate + '|' + amount
      ));
      payments.push({
        paymentId: paymentId,
        billId: billId,
        visitId: visitId,
        patientId: patientId,
        patientName: record.name || record.patientName || '',
        phone: record.phone || '',
        paymentDate: String(eventDate),
        amount: amount,
        paymentMode: mode,
        transactionType: 'PAYMENT',
        status: 'ACTIVE',
        source: 'paymentHistory',
        eventIndex: eventIndex,
        note: event.note || 'Imported from paymentHistory'
      });
      eventPayments = round2(eventPayments + amount);
    });

    var basePaid = round2(Math.max(0, billPaid - eventPayments));
    if (basePaid > 0) {
      payments.push({
        paymentId: deterministicLedgerId('LEG-PAY', billId + '|base-payment'),
        billId: billId,
        visitId: visitId,
        patientId: patientId,
        patientName: record.name || record.patientName || '',
        phone: record.phone || '',
        paymentDate: String(record.timestamp || record.date || ''),
        amount: basePaid,
        paymentMode: String(record.billMode || 'CASH').toUpperCase(),
        transactionType: 'PAYMENT',
        status: 'ACTIVE',
        source: 'patient-fee',
        eventIndex: -1,
        note: 'Aggregate payment remainder'
      });
    }
    return {
      billAmount: billAmount,
      billPaid: billPaid,
      eventPayments: eventPayments,
      eventFees: eventFees,
      basePaid: basePaid,
      payments: payments,
      warnings: warnings,
      billId: billId,
      visitId: visitId,
      patientId: patientId
    };
  }

  /**
   * Normalizes a patient name for fuzzy matching during migration.
   * Lowercase, trim, collapse whitespace.
   */
  function normalizeName(name) {
    return String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /**
   * Normalizes a phone number — strip non-digits, take last 10.
   */
  function normalizePhone(phone) {
    var digits = String(phone || '').replace(/\D/g, '');
    return digits.slice(-10);
  }

  /**
   * Builds a deterministic match key for legacy deduplication.
   */
  function legacyMatchKey(name, phone, dateStr) {
    return normalizeName(name) + '|' + normalizePhone(phone) + '|' + String(dateStr || '').slice(0, 10);
  }

  /* ----------------------------------------------------------
     15. FINANCE SUMMARY BUILDER
     Takes raw data and returns all KPI values for a period.
  ---------------------------------------------------------- */

  /**
   * Builds the complete finance summary for a given period.
   *
   * @param {Object} data
   *   bills:    all bill records
   *   payments: all payment records
   *   expenses: all expense records
   * @param {string|Object} period — 'today' | 'week' | 'month' | { from, to }
   * @param {Date} [referenceDate] — for testing with a fixed "now"
   * @returns {Object} financeSummary
   */
  function buildFinanceSummary(data, period, referenceDate) {
    var range   = getDateRange(period, referenceDate);
    var start   = range.start;
    var end     = range.end;

    var bills    = data.bills    || [];
    var payments = data.payments || [];
    var expenses = data.expenses || [];

    var revenueResult     = aggregateBilledRevenue(bills, start, end);
    var collectionResult  = aggregateCollections(payments, start, end, bills);
    var expenseResult     = aggregateExpenses(expenses, start, end);

    // Patient-level outstanding (all time)
    var patientOutstanding = calcOutstanding(
      bills.filter(function (b) {
        return b.status === 'POSTED' || b.status === 'PART_PAID';
      }).map(function (b) { return b.netBillAmount; }),
      getEffectivePayments(payments).map(function (p) { return p.amount; })
    );

    // Visit count: distinct visitIds in bills in range
    var visitIds = {};
    revenueResult.bills.forEach(function (b) { if (b.visitId) visitIds[b.visitId] = true; });
    var visitCount = Object.keys(visitIds).length || revenueResult.billCount;

    return {
      period: period,
      dateRange: { from: toISTDateString(start), to: toISTDateString(end) },
      visitCount: visitCount,
      billedRevenue: revenueResult.billedRevenue,
      billCount: revenueResult.billCount,
      totalCollected: collectionResult.totalCollected,
      oldDuesCollected: collectionResult.oldDuesCollected,
      collectionsByMode: collectionResult.byMode,
      outstandingReceivables: patientOutstanding,
      totalExpenses: expenseResult.totalExpenses,
      expensesByCategory: expenseResult.byCategory,
      expensesByMode: expenseResult.byMode,
      // Source rows for click-through
      sourceBills: revenueResult.bills,
      sourcePayments: collectionResult.payments,
      sourceExpenses: expenseResult.expenses
    };
  }

  /* ----------------------------------------------------------
     16. ENUM VALIDATION HELPERS
  ---------------------------------------------------------- */

  function isValidPaymentMode(mode)   { return PAYMENT_MODES.indexOf((mode || '').toUpperCase()) !== -1; }
  function isValidBillStatus(status)  { return BILL_STATUSES.indexOf(status || '') !== -1; }
  function isValidPaymentType(type)   { return PAYMENT_TYPES.indexOf(type || '') !== -1; }
  function isValidApptStatus(status)  { return APPT_STATUSES.indexOf(status || '') !== -1; }
  function isValidExpenseStatus(s)    { return EXPENSE_STATUSES.indexOf(s || '') !== -1; }

  /* ----------------------------------------------------------
     EXPORTS
  ---------------------------------------------------------- */

  var FinanceCore = {
    // Constants
    PAYMENT_MODES: PAYMENT_MODES,
    BILL_STATUSES: BILL_STATUSES,
    PAYMENT_TYPES: PAYMENT_TYPES,
    APPT_STATUSES: APPT_STATUSES,
    EXPENSE_STATUSES: EXPENSE_STATUSES,

    // ID generators
    genPatientId:     genPatientId,
    genVisitId:       genVisitId,
    genAppointmentId: genAppointmentId,
    genBillId:        genBillId,
    genPaymentId:     genPaymentId,
    genReceiptId:     genReceiptId,
    genExpenseId:     genExpenseId,
    genAuditId:       genAuditId,
    genOperationId:   genOperationId,
    isValidId:        isValidId,

    // Legacy IDs (migration)
    genLegacyBillId:    genLegacyBillId,
    genLegacyVisitId:   genLegacyVisitId,
    genLegacyExpenseId: genLegacyExpenseId,

    // Currency & dates
    formatINR:       formatINR,
    toISTDateString: toISTDateString,
    istStartOfDay:   istStartOfDay,
    istEndOfDay:     istEndOfDay,
    getDateRange:    getDateRange,
    isInRange:       isInRange,

    // Numeric helpers
    toNum:    toNum,
    round2:   round2,

    // Bill calculations
    calcItemTotal:     calcItemTotal,
    calcBillTotals:    calcBillTotals,
    calcOutstanding:   calcOutstanding,
    calcAmountDueNow:  calcAmountDueNow,
    deriveBillStatus:  deriveBillStatus,

    // Payment calculations
    getEffectivePayments: getEffectivePayments,
    calcNetCollected:     calcNetCollected,
    validatePayment:      validatePayment,

    // Period aggregation
    aggregateBilledRevenue: aggregateBilledRevenue,
    aggregateCollections:   aggregateCollections,
    aggregateExpenses:      aggregateExpenses,
    buildCashbookEntries:   buildCashbookEntries,
    buildFinanceSummary:    buildFinanceSummary,

    // Cash closing
    calcCashClosing:      calcCashClosing,
    extractCashTotals:    extractCashTotals,
    extractCashExpenses:  extractCashExpenses,

    // Normalization (migration helpers)
    deterministicLedgerId: deterministicLedgerId,
    normalizePatientPaymentHistory: normalizePatientPaymentHistory,
    normalizeName:   normalizeName,
    normalizePhone:  normalizePhone,
    legacyMatchKey:  legacyMatchKey,

    // Enum validators
    isValidPaymentMode:   isValidPaymentMode,
    isValidBillStatus:    isValidBillStatus,
    isValidPaymentType:   isValidPaymentType,
    isValidApptStatus:    isValidApptStatus,
    isValidExpenseStatus: isValidExpenseStatus
  };

  // Export for Node (tests) and browser
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FinanceCore;
  } else if (typeof window !== 'undefined') {
    window.FinanceCore = FinanceCore;
  }

})(typeof exports !== 'undefined' ? exports : {});
