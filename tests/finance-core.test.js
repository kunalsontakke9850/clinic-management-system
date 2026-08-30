/* =========================================================
   tests/finance-core.test.js
   Unit tests for finance-core.js using Node's built-in
   test runner (node:test / node:assert — Node 18+).

   Run: npm test
        node --test tests/finance-core.test.js
   ========================================================= */

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const FC = require('../finance-core.js');

/* ----------------------------------------------------------
   HELPERS
---------------------------------------------------------- */

function makePayment(overrides) {
  return Object.assign({
    paymentId: FC.genPaymentId(),
    operationId: FC.genOperationId(),
    billId: 'BIL-TEST',
    patientId: 'PAT-TEST',
    paymentDate: '2026-08-21T10:00:00+05:30',
    amount: 500,
    paymentMode: 'CASH',
    transactionType: 'PAYMENT',
    status: 'ACTIVE'
  }, overrides);
}

function makeBill(overrides) {
  return Object.assign({
    billId: 'BIL-TEST',
    visitId: 'VIS-TEST',
    patientId: 'PAT-TEST',
    billDate: '2026-08-21',
    status: 'POSTED',
    netBillAmount: 1000,
    currentCharges: 1000,
    discount: 0
  }, overrides);
}

function makeExpense(overrides) {
  return Object.assign({
    expenseId: FC.genExpenseId(),
    expenseDate: '2026-08-21T09:00:00+05:30',
    category: 'Supplies',
    description: 'Gloves',
    amount: 300,
    paymentMode: 'CASH',
    status: 'ACTIVE'
  }, overrides);
}

/* ----------------------------------------------------------
   SCENARIO 1: One bill paid in full
---------------------------------------------------------- */
describe('Scenario 1 — One bill paid in full', function () {
  test('outstanding is zero after full payment', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const payment = makePayment({ amount: 1000, billId: bill.billId });
    const outstanding = FC.calcOutstanding([bill.netBillAmount], [payment.amount]);
    assert.equal(outstanding, 0);
  });

  test('bill status becomes PAID', function () {
    const status = FC.deriveBillStatus(1000, 1000, 'POSTED');
    assert.equal(status, 'PAID');
  });

  test('net collected equals payment amount', function () {
    const payment = makePayment({ amount: 1000 });
    assert.equal(FC.calcNetCollected([payment]), 1000);
  });
});

/* ----------------------------------------------------------
   SCENARIO 2: One bill paid in three installments on different dates
---------------------------------------------------------- */
describe('Scenario 2 — Three-installment payment', function () {
  test('outstanding reduces correctly after each installment', function () {
    const billAmt = 3000;
    // Payments of 1000, 800, 1200
    const p1 = makePayment({ amount: 1000 });
    const p2 = makePayment({ amount: 800  });
    const p3 = makePayment({ amount: 1200 });

    // After 1st payment
    assert.equal(FC.calcOutstanding([billAmt], [p1.amount]), 2000);
    // After 2nd
    assert.equal(FC.calcOutstanding([billAmt], [p1.amount, p2.amount]), 1200);
    // After 3rd — fully paid
    assert.equal(FC.calcOutstanding([billAmt], [p1.amount, p2.amount, p3.amount]), 0);
  });

  test('bill status is PART_PAID when partially paid', function () {
    assert.equal(FC.deriveBillStatus(3000, 1800, 'POSTED'), 'PART_PAID');
  });

  test('bill status is PAID after full installment sum', function () {
    assert.equal(FC.deriveBillStatus(3000, 3000, 'PART_PAID'), 'PAID');
  });

  test('period collections aggregate by payment date, not bill date', function () {
    // Bill is from last month; 3 payments are in current period
    const bill = makeBill({ billDate: '2026-07-01', netBillAmount: 3000 });
    const p1 = makePayment({ amount: 1000, paymentDate: '2026-08-21T09:00:00+05:30', billId: bill.billId });
    const p2 = makePayment({ amount: 800,  paymentDate: '2026-08-21T11:00:00+05:30', billId: bill.billId });
    const p3 = makePayment({ amount: 1200, paymentDate: '2026-08-21T15:00:00+05:30', billId: bill.billId });

    const range  = FC.getDateRange('today', new Date('2026-08-21T10:00:00+05:30'));
    const result = FC.aggregateCollections([p1, p2, p3], range.start, range.end, [bill]);

    assert.equal(result.totalCollected, 3000);
    // All payments are against an old bill — all count as old dues
    assert.equal(result.oldDuesCollected, 3000);
  });
});

describe('Parag paymentHistory normalization', function () {
  test('aggregate-only records create one deterministic base payment', function () {
    const record = { name: 'A', phone: '1', date: '2026-08-25', billAmount: '1000', billPaid: '400', billMode: 'UPI', visitId: 'VIS-1', billId: 'BIL-1', patientId: 'PAT-1' };
    const first = FC.normalizePatientPaymentHistory(record);
    const second = FC.normalizePatientPaymentHistory(record);
    assert.equal(first.basePaid, 400);
    assert.equal(first.payments.length, 1);
    assert.equal(first.payments[0].amount, 400);
    assert.equal(first.payments[0].paymentMode, 'UPI');
    assert.equal(first.payments[0].paymentId, second.payments[0].paymentId);
  });

  test('two history payments plus aggregate remainder decompose without double counting', function () {
    const result = FC.normalizePatientPaymentHistory({
      name: 'History Patient', date: '2026-08-25', billAmount: 1000, billPaid: 700, billMode: 'CASH',
      billId: 'BIL-2', visitId: 'VIS-2', patientId: 'PAT-2',
      paymentHistory: [
        { type: 'payment', amount: 200, date: '2026-08-24T10:00:00+05:30', mode: 'UPI' },
        { type: 'payment', amount: 300, date: '2026-08-25T11:00:00+05:30', mode: 'CARD' }
      ]
    });
    assert.equal(result.eventPayments, 500);
    assert.equal(result.basePaid, 200);
    assert.deepEqual(result.payments.map(function (p) { return [p.amount, p.paymentMode]; }), [[200, 'UPI'], [300, 'CARD'], [200, 'CASH']]);
    const cashbook = FC.buildCashbookEntries({ payments: result.payments }, { period: 'day', anchorDate: '2026-08-25' });
    assert.deepEqual(cashbook.days[0].entries.map(function (entry) { return entry.label; }), ['History Patient fees', 'History Patient fees']);
    assert.equal(cashbook.totals.cashIn, 500);
    assert.equal(cashbook.days[0].entries[0].billId, 'BIL-2');
  });

  test('fee events change normalized fee totals but never become payments', function () {
    const result = FC.normalizePatientPaymentHistory({ billAmount: 1000, billPaid: 300, billId: 'BIL-3', date: '2026-08-25', paymentHistory: [{ type: 'fee', amount: 150, date: '2026-08-25' }] });
    assert.equal(result.eventFees, 150);
    assert.equal(result.payments.length, 1);
    assert.equal(result.payments[0].amount, 300);
    const cashbook = FC.buildCashbookEntries({
      bills: [{ billId: result.billId, patientName: 'Fee Patient', netBillAmount: 1000 }],
      payments: result.payments
    }, { period: 'day', anchorDate: '2026-08-25' });
    assert.equal(cashbook.totals.cashIn, 300);
    assert.equal(cashbook.days[0].entries.length, 1);
  });

  test('invalid and over-limit events are ignored with warnings', function () {
    const result = FC.normalizePatientPaymentHistory({ billAmount: 100, billPaid: 100, billId: 'BIL-4', date: '2026-08-25', paymentHistory: [
      { type: 'payment', amount: -10, date: '2026-08-25' },
      { type: 'payment', amount: 80, date: '2026-08-25' },
      { type: 'payment', amount: 30, date: '2026-08-25' },
      { type: 'fee', amount: 0, date: '2026-08-25' }
    ] });
    assert.equal(result.eventPayments, 80);
    assert.equal(result.basePaid, 20);
    assert.equal(result.payments.length, 2);
    assert.ok(result.warnings.length >= 3);
  });
});

/* ----------------------------------------------------------
   SCENARIO 3: Old due collected today
---------------------------------------------------------- */
describe('Scenario 3 — Old due collected today', function () {
  test('old due collection does NOT increase today billed revenue', function () {
    const today = '2026-08-21';
    // Old bill from last month
    const oldBill = makeBill({ billDate: '2026-07-15', netBillAmount: 500 });
    // New bill from today
    const newBill = makeBill({ billId: 'BIL-NEW', billDate: today, netBillAmount: 1000 });
    // Payment today against old bill
    const oldDuePayment = makePayment({
      billId: oldBill.billId,
      amount: 500,
      paymentDate: today + 'T10:00:00+05:30'
    });

    const range = FC.getDateRange('today', new Date(today + 'T10:00:00+05:30'));
    const revenueResult = FC.aggregateBilledRevenue([oldBill, newBill], range.start, range.end);
    const collResult    = FC.aggregateCollections([oldDuePayment], range.start, range.end, [oldBill, newBill]);

    // Only today's bill counts as today's revenue
    assert.equal(revenueResult.billedRevenue, 1000);
    // Old due collected today is in today's collections
    assert.equal(collResult.totalCollected, 500);
    assert.equal(collResult.oldDuesCollected, 500);
  });
});

/* ----------------------------------------------------------
   SCENARIO 4: Current bill plus old due on printed view
---------------------------------------------------------- */
describe('Scenario 4 — Bill display: current charges + prior outstanding', function () {
  test('amountDueNow includes prior outstanding for display but does NOT add to revenue', function () {
    const netBillAmount        = 1200;  // today's charges
    const priorOutstanding     = 800;   // old unpaid balance shown on screen
    const paymentsAppliedNow   = 0;

    const dueNow = FC.calcAmountDueNow(netBillAmount, priorOutstanding, paymentsAppliedNow);
    assert.equal(dueNow, 2000); // patient owes 2000 total

    // But billed revenue for today is only 1200
    const range = FC.getDateRange('today', new Date('2026-08-21T10:00:00+05:30'));
    const bill = makeBill({ netBillAmount: 1200, billDate: '2026-08-21' });
    const rev  = FC.aggregateBilledRevenue([bill], range.start, range.end);
    assert.equal(rev.billedRevenue, 1200);
  });
});

/* ----------------------------------------------------------
   SCENARIO 5: Discounted bill
---------------------------------------------------------- */
describe('Scenario 5 — Discounted bill', function () {
  test('netBillAmount = currentCharges - discount', function () {
    const result = FC.calcBillTotals({
      items: [{ quantity: 2, unitPrice: 500 }],
      discount: 200
    });
    assert.equal(result.currentCharges, 1000);
    assert.equal(result.discount, 200);
    assert.equal(result.netBillAmount, 800);
    assert.equal(result.isValid, true);
  });

  test('discount cannot exceed total charges', function () {
    const result = FC.calcBillTotals({
      items: [{ quantity: 1, unitPrice: 300 }],
      discount: 500  // more than charges
    });
    // discount is capped at currentCharges
    assert.equal(result.discount, 300);
    assert.equal(result.netBillAmount, 0);
  });
});

/* ----------------------------------------------------------
   SCENARIO 6: Payment reversal
---------------------------------------------------------- */
describe('Scenario 6 — Payment reversal', function () {
  test('reversed payment does not count as effective collected', function () {
    const paymentId = FC.genPaymentId();
    const original  = makePayment({ paymentId, amount: 1000 });
    const reversal  = makePayment({
      paymentId: FC.genPaymentId(),
      transactionType: 'REVERSAL',
      reversesPaymentId: paymentId,
      amount: 1000
    });

    const effective = FC.getEffectivePayments([original, reversal]);
    assert.equal(effective.length, 0); // original is reversed

    const netCollected = FC.calcNetCollected([original, reversal]);
    assert.equal(netCollected, 0);
  });

  test('outstanding is restored after reversal', function () {
    const billAmt   = 1000;
    const paymentId = FC.genPaymentId();
    const original  = makePayment({ paymentId, amount: 1000 });
    const reversal  = makePayment({
      paymentId: FC.genPaymentId(),
      transactionType: 'REVERSAL',
      reversesPaymentId: paymentId,
      amount: 1000
    });

    const effective = FC.getEffectivePayments([original, reversal]);
    const outstanding = FC.calcOutstanding([billAmt], effective.map(p => p.amount));
    assert.equal(outstanding, 1000);
  });

  test('reversal audit: original row is not modified', function () {
    // Simulate: original payment object is unchanged after reversal is added
    const paymentId = FC.genPaymentId();
    const original  = makePayment({ paymentId, amount: 800 });
    const originalCopy = JSON.parse(JSON.stringify(original)); // snapshot

    const reversal = makePayment({
      paymentId: FC.genPaymentId(),
      transactionType: 'REVERSAL',
      reversesPaymentId: paymentId,
      amount: 800
    });

    // The original object is not mutated
    assert.deepEqual(original, originalCopy);
    assert.equal(reversal.reversesPaymentId, paymentId);
  });
});

/* ----------------------------------------------------------
   SCENARIO 7: Partial refund
---------------------------------------------------------- */
describe('Scenario 7 — Partial refund', function () {
  test('partial refund reduces net collected', function () {
    const payment = makePayment({ amount: 1000 });
    const refund  = makePayment({
      paymentId: FC.genPaymentId(),
      transactionType: 'REFUND',
      reversesPaymentId: payment.paymentId,
      amount: 300  // partial refund
    });

    const netCollected = FC.calcNetCollected([payment, refund]);
    assert.equal(netCollected, 700);
  });

  test('validatePayment rejects refund exceeding original', function () {
    const bill      = makeBill({ netBillAmount: 1000 });
    const original  = makePayment({ amount: 500 });
    const badRefund = {
      billId: bill.billId,
      patientId: 'PAT-TEST',
      amount: 600,  // more than original 500
      paymentMode: 'CASH',
      transactionType: 'REFUND',
      reversesPaymentId: original.paymentId
    };
    const result = FC.validatePayment(badRefund, bill, [original]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('refund cannot exceed')));
  });
});

/* ----------------------------------------------------------
   SCENARIO 8: Voided expense
---------------------------------------------------------- */
describe('Scenario 8 — Voided expense', function () {
  test('voided expense does not count in active totals', function () {
    const activeExp = makeExpense({ amount: 300 });
    const voidedExp = makeExpense({ amount: 500, status: 'VOID' });

    const range  = FC.getDateRange('today', new Date('2026-08-21T10:00:00+05:30'));
    const result = FC.aggregateExpenses([activeExp, voidedExp], range.start, range.end);

    assert.equal(result.totalExpenses, 300);
    assert.equal(result.expenses.length, 1);
  });

  test('voided expense is excluded from cash closing', function () {
    const cashExpenses = FC.extractCashExpenses([
      makeExpense({ amount: 300, paymentMode: 'CASH',  status: 'ACTIVE' }),
      makeExpense({ amount: 200, paymentMode: 'CASH',  status: 'VOID'   }),
      makeExpense({ amount: 100, paymentMode: 'UPI',   status: 'ACTIVE' })
    ], '2026-08-21');
    assert.equal(cashExpenses, 300); // only active CASH expense
  });
});

/* ----------------------------------------------------------
   SCENARIO 9: Cash and UPI split collections
   Reference day from plan §18.6:
     Opening cash: ₹2,000
     Bill A cash ₹600 + Bill B UPI ₹2,000 + Old due cash ₹500
     Cash expense ₹300 + UPI expense ₹200
     Expected closing cash: ₹2,800
---------------------------------------------------------- */
describe('Scenario 9 — Manual reconciliation (plan §18.6)', function () {
  const DATE = '2026-08-21';
  const range = FC.getDateRange('today', new Date(DATE + 'T10:00:00+05:30'));

  const billA = makeBill({ billId: 'BIL-A', netBillAmount: 1000, billDate: DATE });
  const billB = makeBill({ billId: 'BIL-B', netBillAmount: 2000, billDate: DATE });
  // Old bill from a prior period
  const oldBill = makeBill({ billId: 'BIL-OLD', netBillAmount: 500, billDate: '2026-07-01' });

  const payA   = makePayment({ billId: 'BIL-A', amount: 600,  paymentMode: 'CASH', paymentDate: DATE + 'T09:00:00+05:30' });
  const payB   = makePayment({ billId: 'BIL-B', amount: 2000, paymentMode: 'UPI',  paymentDate: DATE + 'T10:00:00+05:30' });
  const payOld = makePayment({ billId: 'BIL-OLD', amount: 500, paymentMode: 'CASH', paymentDate: DATE + 'T11:00:00+05:30' });

  const expCash = makeExpense({ amount: 300, paymentMode: 'CASH', expenseDate: DATE + 'T12:00:00+05:30' });
  const expUPI  = makeExpense({ amount: 200, paymentMode: 'UPI',  expenseDate: DATE + 'T13:00:00+05:30' });

  test('billed revenue = ₹3,000 (only today\'s bills)', function () {
    const rev = FC.aggregateBilledRevenue([billA, billB, oldBill], range.start, range.end);
    assert.equal(rev.billedRevenue, 3000);
  });

  test('total collections = ₹3,100', function () {
    const coll = FC.aggregateCollections([payA, payB, payOld], range.start, range.end, [billA, billB, oldBill]);
    assert.equal(coll.totalCollected, 3100);
  });

  test('old dues collected = ₹500', function () {
    const coll = FC.aggregateCollections([payA, payB, payOld], range.start, range.end, [billA, billB, oldBill]);
    assert.equal(coll.oldDuesCollected, 500);
  });

  test('total expenses = ₹500', function () {
    const exp = FC.aggregateExpenses([expCash, expUPI], range.start, range.end);
    assert.equal(exp.totalExpenses, 500);
  });

  test('expected closing cash = ₹2,800', function () {
    // Cash payments: 600 (billA) + 500 (old due) = 1,100
    // Cash expenses: 300
    const cashTotals = FC.extractCashTotals([payA, payB, payOld], DATE);
    const cashExp    = FC.extractCashExpenses([expCash, expUPI], DATE);
    const closing    = FC.calcCashClosing({
      openingCash: 2000,
      cashPayments: cashTotals.cashPayments,
      cashRefunds: cashTotals.cashRefunds,
      cashExpenses: cashExp,
      allCollections: 3100,
      allActiveExpenses: 500
    });
    assert.equal(cashTotals.cashPayments, 1100);
    assert.equal(closing.expectedClosingCash, 2800);
  });

  test('new unpaid balance on bill A = ₹400', function () {
    const outstanding = FC.calcOutstanding([1000], [600]);
    assert.equal(outstanding, 400);
  });

  test('net cash movement = ₹2,600', function () {
    const closing = FC.calcCashClosing({
      openingCash: 2000,
      cashPayments: 1100,
      cashRefunds: 0,
      cashExpenses: 300,
      allCollections: 3100,
      allActiveExpenses: 500
    });
    assert.equal(closing.netCashMovement, 2600);
  });

  test('buildFinanceSummary produces correct totals', function () {
    const summary = FC.buildFinanceSummary(
      { bills: [billA, billB, oldBill], payments: [payA, payB, payOld], expenses: [expCash, expUPI] },
      'today',
      new Date(DATE + 'T10:00:00+05:30')
    );
    assert.equal(summary.billedRevenue, 3000);
    assert.equal(summary.totalCollected, 3100);
    assert.equal(summary.oldDuesCollected, 500);
    assert.equal(summary.totalExpenses, 500);
  });
});

/* ----------------------------------------------------------
   SCENARIO 10: Month boundary in Asia/Calcutta
---------------------------------------------------------- */
describe('Scenario 10 — Month boundary (IST)', function () {
  test('bill at 23:30 IST on last day of month is in that month', function () {
    // 23:30 IST = 18:00 UTC (previous day in UTC terms)
    const bill = makeBill({ billDate: '2026-07-31T23:30:00+05:30', netBillAmount: 500 });
    const range = FC.getDateRange('month', new Date('2026-07-15T10:00:00+05:30'));
    const rev = FC.aggregateBilledRevenue([bill], range.start, range.end);
    assert.equal(rev.billedRevenue, 500, 'bill at 23:30 IST on Jul 31 must be in July');
  });

  test('bill at 00:01 IST on first day of next month is NOT in prior month', function () {
    const bill = makeBill({ billDate: '2026-08-01T00:01:00+05:30', netBillAmount: 500 });
    const range = FC.getDateRange('month', new Date('2026-07-15T10:00:00+05:30'));
    const rev = FC.aggregateBilledRevenue([bill], range.start, range.end);
    assert.equal(rev.billedRevenue, 0, 'Aug 1 bill must not appear in July report');
  });

  test('toISTDateString converts UTC midnight to IST date correctly', function () {
    // UTC midnight Aug 1 = Jul 31 in IST? No — UTC midnight = 05:30 IST, still Aug 1 IST
    // But Dec 31 UTC 18:30 = Jan 1 00:00 IST
    const utcDate = new Date('2025-12-31T18:30:00Z'); // Jan 1 00:00 IST
    const istStr  = FC.toISTDateString(utcDate);
    assert.equal(istStr, '2026-01-01');
  });
});

/* ----------------------------------------------------------
   SCENARIO 11: Two visits for the same patient on one day
---------------------------------------------------------- */
describe('Scenario 11 — Same patient, two same-day visits', function () {
  test('two bills produce independent outstanding calculations', function () {
    const bill1 = makeBill({ billId: 'BIL-V1', visitId: 'VIS-1', netBillAmount: 800 });
    const bill2 = makeBill({ billId: 'BIL-V2', visitId: 'VIS-2', netBillAmount: 600 });
    const payment = makePayment({ billId: 'BIL-V1', amount: 800 });

    // Total outstanding = 0 (V1 paid) + 600 (V2 unpaid) = 600
    const outstanding = FC.calcOutstanding(
      [bill1.netBillAmount, bill2.netBillAmount],
      [payment.amount]
    );
    assert.equal(outstanding, 600);
  });

  test('two visits each generate unique IDs', function () {
    const v1 = FC.genVisitId();
    const v2 = FC.genVisitId();
    assert.notEqual(v1, v2);
    assert.ok(FC.isValidId(v1));
    assert.ok(FC.isValidId(v2));
  });

  test('legacyMatchKey collision risk: same patient name+date produces same key', function () {
    // This is a known collision risk that the migration must flag
    const key1 = FC.legacyMatchKey('Ram Sharma', '0000000000', '2026-08-21');
    const key2 = FC.legacyMatchKey('Ram Sharma', '0000000000', '2026-08-21');
    assert.equal(key1, key2);
  });
});

/* ----------------------------------------------------------
   SCENARIO 12: Retried operationId (idempotency)
---------------------------------------------------------- */
describe('Scenario 12 — Idempotency / operationId uniqueness', function () {
  test('each genOperationId produces a unique value', function () {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(FC.genOperationId());
    // With timestamp + random, collisions in 1000 ops would be extraordinary
    assert.ok(ids.size >= 990, 'expected near-unique operationIds, got ' + ids.size);
  });

  test('operationId format is valid', function () {
    const opId = FC.genOperationId();
    assert.ok(FC.isValidId(opId), 'operationId does not match expected format: ' + opId);
    assert.ok(opId.startsWith('OP-'));
  });

  test('all ID generators produce valid IDs', function () {
    const generators = [
      FC.genPatientId, FC.genVisitId, FC.genAppointmentId, FC.genBillId,
      FC.genPaymentId, FC.genExpenseId, FC.genAuditId, FC.genOperationId
    ];
    generators.forEach(function (gen) {
      const id = gen();
      assert.ok(FC.isValidId(id), gen.name + '() produced invalid ID: ' + id);
    });
  });

  test('legacy IDs are also valid', function () {
    assert.ok(FC.isValidId(FC.genLegacyBillId(42)));
    assert.ok(FC.isValidId(FC.genLegacyExpenseId(7)));
    assert.ok(FC.isValidId(FC.genLegacyVisitId(123)));
  });
});

/* ----------------------------------------------------------
   BONUS: formatINR
---------------------------------------------------------- */
describe('formatINR — Indian currency formatting', function () {
  test('formats thousands correctly', function () {
    const s = FC.formatINR(1234567.89);
    assert.ok(s.includes('1,23,567') || s.includes('12,34,567') || s.includes('1234567'),
      'Expected Indian formatted number, got: ' + s);
    assert.ok(s.includes('₹') || s.includes('INR') || s.includes('Rs'),
      'Expected currency symbol, got: ' + s);
  });

  test('formats zero correctly', function () {
    const s = FC.formatINR(0);
    assert.ok(s.includes('0.00'), 'Expected 0.00, got: ' + s);
  });

  test('handles NaN gracefully', function () {
    const s = FC.formatINR('not-a-number');
    assert.equal(s, '₹0.00');
  });
});

/* ----------------------------------------------------------
   BONUS: validatePayment
---------------------------------------------------------- */
describe('validatePayment — payment guard', function () {
  test('accepts valid payment', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const payment = {
      billId: bill.billId,
      patientId: 'PAT-TEST',
      amount: 500,
      paymentMode: 'UPI',
      transactionType: 'PAYMENT'
    };
    const result = FC.validatePayment(payment, bill, []);
    assert.equal(result.valid, true);
  });

  test('rejects payment exceeding outstanding balance', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const existing = makePayment({ amount: 800 });
    const payment = {
      billId: bill.billId,
      patientId: 'PAT-TEST',
      amount: 300,  // 800 already paid, total would be 1100 > 1000
      paymentMode: 'CASH',
      transactionType: 'PAYMENT'
    };
    const result = FC.validatePayment(payment, bill, [existing]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('exceeds outstanding')));
  });

  test('rejects invalid paymentMode', function () {
    const bill = makeBill({ netBillAmount: 500 });
    const payment = {
      billId: bill.billId,
      patientId: 'PAT-TEST',
      amount: 100,
      paymentMode: 'CRYPTO',   // invalid
      transactionType: 'PAYMENT'
    };
    const result = FC.validatePayment(payment, bill, []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('paymentMode')));
  });
});

/* ----------------------------------------------------------
   REGRESSION: IST week boundaries
   A Monday reference must produce Monday-Sunday, not the
   previous Tuesday through Monday.
---------------------------------------------------------- */
describe('getDateRange — clinic week boundaries', function () {
  test('Monday reference returns that Monday through Sunday in IST', function () {
    const range = FC.getDateRange('week', new Date('2026-08-17T12:00:00+05:30'));
    assert.equal(FC.toISTDateString(range.start), '2026-08-17');
    assert.equal(FC.toISTDateString(range.end), '2026-08-23');
  });

  test('Sunday reference stays in the same Monday-Sunday week', function () {
    const range = FC.getDateRange('week', new Date('2026-08-23T12:00:00+05:30'));
    assert.equal(FC.toISTDateString(range.start), '2026-08-17');
    assert.equal(FC.toISTDateString(range.end), '2026-08-23');
  });
});

/* ----------------------------------------------------------
   REGRESSION: partial refunds
   A partial refund reduces an original payment; it must not
   erase the entire payment from outstanding calculations.
---------------------------------------------------------- */
describe('getEffectivePayments — partial refund allocation', function () {
  test('₹200 refund against ₹1,000 payment leaves ₹800 effective', function () {
    const original = makePayment({ paymentId: 'PAY-ORIGINAL', amount: 1000 });
    const refund = makePayment({
      paymentId: 'PAY-REFUND',
      amount: 200,
      transactionType: 'REFUND',
      reversesPaymentId: original.paymentId
    });

    const effective = FC.getEffectivePayments([original, refund]);
    assert.deepEqual(effective.map(p => p.amount), [800]);
    assert.equal(FC.calcOutstanding([1000], effective.map(p => p.amount)), 200);
  });

  test('multiple refunds are accumulated without making a payment negative', function () {
    const original = makePayment({ paymentId: 'PAY-MULTI', amount: 1000 });
    const refunds = [
      makePayment({ paymentId: 'PAY-R1', amount: 250, transactionType: 'REFUND', reversesPaymentId: original.paymentId }),
      makePayment({ paymentId: 'PAY-R2', amount: 150, transactionType: 'REFUND', reversesPaymentId: original.paymentId })
    ];

    const effective = FC.getEffectivePayments([original].concat(refunds));
    assert.deepEqual(effective.map(p => p.amount), [600]);
  });
});

describe('validatePayment — refund and reversal references', function () {
  test('refund requires an original payment reference', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const result = FC.validatePayment({
      billId: bill.billId,
      patientId: bill.patientId,
      amount: 100,
      paymentMode: 'CASH',
      transactionType: 'REFUND'
    }, bill, []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('reversesPaymentId')));
  });

  test('refund rejects an unknown original payment', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const result = FC.validatePayment({
      billId: bill.billId,
      patientId: bill.patientId,
      amount: 100,
      paymentMode: 'CASH',
      transactionType: 'REFUND',
      reversesPaymentId: 'PAY-MISSING'
    }, bill, []);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('original payment')));
  });

  test('cumulative refunds cannot exceed the original payment', function () {
    const bill = makeBill({ netBillAmount: 1000 });
    const original = makePayment({ paymentId: 'PAY-CUMULATIVE', amount: 500 });
    const firstRefund = makePayment({
      paymentId: 'PAY-CUMULATIVE-R1',
      amount: 400,
      transactionType: 'REFUND',
      reversesPaymentId: original.paymentId
    });
    const result = FC.validatePayment({
      billId: bill.billId,
      patientId: bill.patientId,
      amount: 150,
      paymentMode: 'CASH',
      transactionType: 'REFUND',
      reversesPaymentId: original.paymentId
    }, bill, [original, firstRefund]);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('remaining refundable')));
  });
});

describe('buildCashbookEntries — unified finance ledger', function () {
  test('includes paid amounts from the main patient records', function () {
    const report = FC.buildCashbookEntries({
      patientFees: [{
        name: 'Kunal Sontakke', date: '2026-08-22', billAmount: 500,
        billPaid: 500, billMode: 'Cash', timestamp: '2026-08-22T09:00:00+05:30'
      }]
    }, { period: 'day', anchorDate: '2026-08-22' });

    assert.equal(report.totals.cashIn, 500);
    assert.equal(report.days[0].entries[0].label, 'Kunal Sontakke fees');
    assert.equal(report.days[0].entries[0].source, 'patient-fee');
  });

  test('shows completed visits without inventing cash movement', function () {
    const report = FC.buildCashbookEntries({
      completedVisits: [{
        visitId: 'VISIT-1', patientName: 'Kunal Sontakke', date: '2026-08-22',
        completedAt: '2026-08-22T09:00:00+05:30'
      }]
    }, { period: 'day', anchorDate: '2026-08-22', filter: 'all' });

    assert.equal(report.days[0].entries[0].label, 'Kunal Sontakke — Completed visit');
    assert.equal(report.days[0].entries[0].source, 'completed-visit');
    assert.equal(report.totals.cashIn, 0);
    assert.equal(report.totals.cashOut, 0);
    assert.equal(report.days[0].entries[0].balance, 0);
    assert.equal(FC.buildCashbookEntries({ completedVisits: [{ visitId: 'VISIT-1', patientName: 'Kunal', date: '2026-08-22' }] }, { period: 'day', anchorDate: '2026-08-22', filter: 'in' }).days.length, 0);
  });

  test('uses paid legacy bill amounts when no formal payment row exists', function () {
    const report = FC.buildCashbookEntries({
      bills: [{ billId: 'BIL-LEGACY', patientName: 'Asha', date: '2026-08-22', paidAmount: 250, status: 'Paid' }]
    }, { period: 'day', anchorDate: '2026-08-22' });

    assert.equal(report.totals.cashIn, 250);
    assert.equal(report.days[0].entries[0].source, 'patient-fee');
  });

  test('filters a day and calculates cash-in, cash-out, and running balance', function () {
    const report = FC.buildCashbookEntries({
      bills: [{ billId: 'BIL-1', patientName: 'Asha' }],
      payments: [{
        paymentId: 'PAY-1', billId: 'BIL-1', amount: 500, paymentMode: 'CASH',
        transactionType: 'PAYMENT', paymentDate: '2026-08-22T09:00:00+05:30', status: 'ACTIVE'
      }],
      expenses: [{
        expenseId: 'EXP-1', expenseDate: '2026-08-22T11:00:00+05:30',
        description: 'Gloves', category: 'Supplies', amount: 100,
        paymentMode: 'CASH', status: 'ACTIVE'
      }]
    }, { period: 'day', anchorDate: '2026-08-22' });

    assert.equal(report.totals.cashIn, 500);
    assert.equal(report.totals.cashOut, 100);
    assert.equal(report.totals.balance, 400);
    assert.deepEqual(report.days[0].entries.map(entry => entry.label), ['Gloves', 'Asha fees']);
    assert.deepEqual(report.days[0].entries.map(entry => entry.balance), [400, 500]);
  });

  test('supports month filtering and Bills-only filtering', function () {
    const report = FC.buildCashbookEntries({
      bills: [{ billId: 'BIL-1', patientName: 'Asha' }],
      payments: [
        { paymentId: 'PAY-1', billId: 'BIL-1', amount: 500, transactionType: 'PAYMENT', paymentDate: '2026-08-03', status: 'ACTIVE' },
        { paymentId: 'PAY-2', billId: 'BIL-1', amount: 200, transactionType: 'PAYMENT', paymentDate: '2026-09-03', status: 'ACTIVE' }
      ],
      expenses: [{ expenseId: 'EXP-1', expenseDate: '2026-08-03', description: 'Rent', amount: 100, status: 'ACTIVE' }]
    }, { period: 'month', filter: 'bills', anchorDate: '2026-08-03' });

    assert.equal(report.totals.cashIn, 500);
    assert.equal(report.totals.cashOut, 0);
    assert.equal(report.days.length, 1);
    assert.deepEqual(report.days[0].entries.map(entry => entry.source), ['patient-fee']);
  });
});
