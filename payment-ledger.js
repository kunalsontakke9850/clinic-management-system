(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PatientPayment = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function number(value) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function todayLocalISO() {
    var now = new Date();
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function parsePaymentHistory(record) {
    var raw = record && record.paymentHistory;
    if (Array.isArray(raw)) return raw.slice();
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function applyAdditionalPayment(record, amount) {
    var fee = Math.max(number(record && record.billAmount), 0);
    var paid = Math.max(number(record && record.billPaid), 0);
    var payment = number(amount);
    var balance = Math.max(fee - paid, 0);
    if (!Number.isFinite(Number(amount)) || payment <= 0) {
      return { ok: false, error: 'Enter a payment amount greater than zero.' };
    }
    if (payment > balance) {
      return { ok: false, error: 'Payment cannot exceed the remaining balance.' };
    }
    var nextPaid = paid + payment;
    return {
      ok: true,
      record: Object.assign({}, record, { billPaid: nextPaid }),
      paid: nextPaid,
      balance: Math.max(fee - nextPaid, 0)
    };
  }

  function applyAdditionalFee(record, amount, note, date) {
    var fee = Math.max(number(record && record.billAmount), 0);
    var paid = Math.max(number(record && record.billPaid), 0);
    var feeAmount = number(amount);
    if (!Number.isFinite(Number(amount)) || feeAmount <= 0) {
      return { ok: false, error: 'Enter a fee amount greater than zero.' };
    }
    var history = parsePaymentHistory(record);
    history.push({
      type: 'fee',
      date: String(date || todayLocalISO()),
      amount: feeAmount,
      note: String(note || '').trim()
    });
    var nextFee = fee + feeAmount;
    return {
      ok: true,
      record: Object.assign({}, record, {
        billAmount: nextFee,
        paymentHistory: JSON.stringify(history)
      }),
      fee: nextFee,
      balance: Math.max(nextFee - paid, 0)
    };
  }

  function normalizedEvents(record) {
    return parsePaymentHistory(record).map(function (entry, eventIndex) {
      var amount = number(entry && entry.amount);
      if (amount <= 0) return null;
      var isFee = String(entry && entry.type || 'payment').toLowerCase() === 'fee';
      return {
        type: isFee ? 'fee' : 'payment',
        amount: amount,
        date: String(entry && entry.date || record.date || record.timestamp || ''),
        mode: String(entry && entry.mode || (isFee ? '—' : (record.billMode || '—'))),
        note: String(entry && entry.note || '').trim(),
        eventIndex: eventIndex
      };
    }).filter(Boolean);
  }

  function formalPaymentEvents(record, payments) {
    var billId = String(record && record.billId || '');
    var visitId = String(record && record.visitId || '');
    var seen = {};
    return (Array.isArray(payments) ? payments : []).map(function (payment, index) {
      var status = String(payment && payment.status || 'ACTIVE').toUpperCase();
      var type = String(payment && payment.transactionType || 'PAYMENT').toUpperCase();
      var amount = number(payment && payment.amount);
      var matchesBill = billId && String(payment && payment.billId || '') === billId;
      var matchesVisit = !billId && visitId && String(payment && payment.visitId || '') === visitId;
      if (!payment || status === 'VOID' || !matchesBill && !matchesVisit || amount <= 0 || ['PAYMENT', 'REFUND', 'REVERSAL'].indexOf(type) === -1) return null;
      var key = String(payment.paymentId || [payment.billId, payment.visitId, payment.paymentDate || payment.createdAt, amount, type, index].join('|'));
      if (seen[key]) return null;
      seen[key] = true;
      var note = String(payment.note || '').trim();
      var isPayment = type === 'PAYMENT';
      return {
        type: 'payment',
        amount: amount,
        paidAmount: isPayment ? amount : -amount,
        date: String(payment.paymentDate || payment.createdAt || record.date || record.timestamp || ''),
        mode: String(payment.paymentMode || record.billMode || '—'),
        note: note,
        transaction: isPayment ? (/(?:collected at reception|reception collection)/i.test(note) ? 'Reception payment' : 'Payment') : (type === 'REFUND' ? 'Refund' : 'Payment reversal'),
        eventIndex: index
      };
    }).filter(Boolean);
  }

  function buildLedgerRows(records, formalPayments) {
    var rows = [];
    (Array.isArray(records) ? records : []).forEach(function (record, recordIndex) {
      var fee = number(record && record.billAmount);
      var paid = number(record && record.billPaid);
      if (fee <= 0) return;

      var savedEvents = normalizedEvents(record);
      var formalEvents = formalPaymentEvents(record, formalPayments);
      var usesFormalPayments = formalEvents.length > 0;
      var events = usesFormalPayments
        ? savedEvents.filter(function (event) { return event.type === 'fee'; }).concat(formalEvents).sort(function (a, b) {
          return String(a.date || '').localeCompare(String(b.date || '')) || a.eventIndex - b.eventIndex;
        })
        : savedEvents;
      var eventFees = savedEvents.reduce(function (sum, event) { return sum + (event.type === 'fee' ? event.amount : 0); }, 0);
      var eventPayments = usesFormalPayments ? 0 : savedEvents.reduce(function (sum, event) { return sum + (event.type === 'payment' ? event.amount : 0); }, 0);
      var runningFee = Math.max(fee - eventFees, 0);
      var runningPaid = Math.max(paid - eventPayments, 0);
      var visitDate = String(record.date || record.timestamp || '');

      function row(date, transaction, feesAdded, paidAmount, mode, note, eventIndex) {
        return {
          date: String(date || visitDate),
          patientName: String(record.name || 'Unknown patient'),
          phone: String(record.phone || ''),
          transaction: transaction,
          feesAdded: number(feesAdded),
          paid: number(paidAmount),
          due: Math.max(runningFee - runningPaid, 0),
          mode: String(mode || '—'),
          note: note || '',
          record: record,
          recordIndex: recordIndex,
          eventIndex: eventIndex
        };
      }

      rows.push(row(visitDate, 'Visit', runningFee, runningPaid, record.billMode || '—', '', -1));
      events.forEach(function (event) {
        if (event.type === 'fee') runningFee += event.amount;
        else runningPaid += event.paidAmount == null ? event.amount : event.paidAmount;
        rows.push(row(
          event.date,
          event.type === 'fee' ? 'Additional fee' : (event.transaction || 'Additional payment'),
          event.type === 'fee' ? event.amount : 0,
          event.type === 'payment' ? (event.paidAmount == null ? event.amount : event.paidAmount) : 0,
          event.mode,
          event.note,
          event.eventIndex
        ));
      });
    });

    rows.sort(function (a, b) {
      var visitOrder = String(b.record && (b.record.date || b.record.timestamp) || '')
        .localeCompare(String(a.record && (a.record.date || a.record.timestamp) || ''));
      return visitOrder || a.recordIndex - b.recordIndex || a.eventIndex - b.eventIndex;
    });
    return rows;
  }

  function filterLedgerRows(rows, filters) {
    var options = filters || {};
    var search = String(options.search || '').trim().toLowerCase();
    var status = String(options.status || 'all').toLowerCase();
    var from = String(options.from || '');
    var to = String(options.to || '');
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      if (search && String(row.patientName + ' ' + row.phone).toLowerCase().indexOf(search) === -1) return false;
      if (status === 'due' && row.due <= 0) return false;
      if (status === 'paid' && row.due > 0) return false;
      var date = String(row.date || '').slice(0, 10);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    });
  }

  function summarizeLedger(rows) {
    var result = (Array.isArray(rows) ? rows : []).reduce(function (summary, row) {
      summary.fees += number(row.feesAdded);
      summary.paid += number(row.paid);
      return summary;
    }, { fees: 0, paid: 0, due: 0 });
    result.due = Math.max(result.fees - result.paid, 0);
    return result;
  }

  return {
    parsePaymentHistory: parsePaymentHistory,
    applyAdditionalPayment: applyAdditionalPayment,
    applyAdditionalFee: applyAdditionalFee,
    buildLedgerRows: buildLedgerRows,
    filterLedgerRows: filterLedgerRows,
    summarizeLedger: summarizeLedger
  };
});
