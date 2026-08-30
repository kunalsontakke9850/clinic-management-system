/* =========================================================
   receptionist.js
   Front-desk workspace: queue, check-in, patient search,
   quick payment, appointments, and daily closing.
   Depends on: finance-core.js, finance-store.js

   Clinic Management System
   ========================================================= */

(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); };

  var FC  = window.FinanceCore;
  var FS  = window.FinanceStore;

  /* ----------------------------------------------------------
     1. SYNC STATUS INDICATOR
  ---------------------------------------------------------- */

  function initSyncStatusBar() {
    var bar = $('#rx-sync-status');
    if (!bar) return;

    FS.onStatusChange(function (info) {
      bar.className = 'rx-sync-bar rx-sync-' + info.status;
      var label = '';
      switch (info.status) {
        case 'online':   label = '● Online'; break;
        case 'offline':  label = '◌ Offline'; break;
        case 'syncing':  label = '↻ Syncing…'; break;
        case 'sync_error':
          label = '⚠ Sync Error' + (info.pendingCount > 0 ? ' (' + info.pendingCount + ' pending)' : '');
          break;
      }
      if (info.pendingCount > 0 && info.status === 'online') {
        label = '● ' + info.pendingCount + ' pending';
      }
      bar.textContent = label;
      bar.title = info.extra || '';
    });

    // Show error details on click
    bar.addEventListener('click', function () {
      var errors = FS.getErrorOperations();
      if (errors.length === 0) return;
      var msg = 'Failed operations:\n\n' + errors.map(function (op) {
        return '• ' + op.action + ': ' + (op.lastError || 'Unknown error') +
               ' (tried ' + op.attemptCount + 'x)';
      }).join('\n');
      if (confirm(msg + '\n\nClick OK to retry all failed operations.')) {
        errors.forEach(function (op) { FS.retryOperation(op.operationId); });
      }
    });
  }

  /* ----------------------------------------------------------
     2. TODAY'S SUMMARY STRIP
  ---------------------------------------------------------- */

  function renderSummaryStrip(data) {
    var container = $('#rx-summary-strip');
    if (!container || !data) return;

    var bills    = (data.bills    || []).filter(function (b) { return b.status !== 'VOID'; });
    var payments = data.payments  || [];
    var expenses = (data.expenses || []).filter(function (e) { return e.status !== 'VOID'; });
    var appts    = data.appointments || [];

    var dateStr = data.date || FC.toISTDateString();
    var range   = FC.getDateRange('today', new Date(dateStr + 'T00:00:00+05:30'));

    var revenueResult    = FC.aggregateBilledRevenue(bills, range.start, range.end);
    var collectionResult = FC.aggregateCollections(payments, range.start, range.end, bills);
    var expenseResult    = FC.aggregateExpenses(expenses, range.start, range.end);

    // Outstanding (all-time, not just today)
    var outstanding = (data.outstanding || []).reduce(function (sum, row) {
      return sum + FC.toNum(row.balance);
    }, 0);
    if (!data.outstanding) {
      var financeCache = FS.getFinanceCache();
      var allCacheBills = (financeCache.bills || []).length ? financeCache.bills : bills;
      var allCachePays  = (financeCache.payments || []).length ? financeCache.payments : payments;
      var postedBills   = allCacheBills.filter(function (b) {
        return b.status === 'POSTED' || b.status === 'PART_PAID';
      });
      outstanding = FC.calcOutstanding(
        postedBills.map(function (b) { return b.netBillAmount; }),
        FC.getEffectivePayments(allCachePays).map(function (p) { return p.amount; })
      );
    }

    var cashTotals   = FC.extractCashTotals(payments, dateStr);
    var cashExpenses = FC.extractCashExpenses(expenses, dateStr);
    var closing = data.closing || {};
    var netCash = FC.calcCashClosing({
      openingCash: closing.openingCash || 0,
      cashPayments: cashTotals.cashPayments,
      cashRefunds: cashTotals.cashRefunds,
      cashExpenses: cashExpenses,
      allCollections: collectionResult.totalCollected,
      allActiveExpenses: expenseResult.totalExpenses
    });

    var scheduled  = appts.filter(function (a) { return a.status === 'SCHEDULED' || a.status === 'CONFIRMED'; }).length;
    var arrived    = appts.filter(function (a) { return a.status === 'ARRIVED'; }).length;
    var completed  = appts.filter(function (a) { return a.status === 'COMPLETED'; }).length;

    var cards = [
      { label: 'Scheduled',        value: scheduled,                          id: 'kpi-scheduled',    icon: '📅', class: '' },
      { label: 'Arrived',          value: arrived,                            id: 'kpi-arrived',      icon: '🚶', class: '' },
      { label: 'Completed',        value: completed,                          id: 'kpi-completed',    icon: '✓',  class: 'kpi-green' },
      { label: 'Billed Today',     value: FC.formatINR(revenueResult.billedRevenue),    id: 'kpi-billed',   icon: '📋', class: 'kpi-blue' },
      { label: 'Collected Today',  value: FC.formatINR(collectionResult.totalCollected), id: 'kpi-collected',icon: '💰', class: 'kpi-green' },
      { label: 'Outstanding Due',  value: FC.formatINR(outstanding),          id: 'kpi-outstanding',  icon: '⏳', class: outstanding > 0 ? 'kpi-warning' : '' },
      { label: 'Expenses Today',   value: FC.formatINR(expenseResult.totalExpenses),    id: 'kpi-expenses', icon: '📤', class: '' },
      { label: 'Net Cash Movement', value: FC.formatINR(netCash.netCashMovement),       id: 'kpi-netcash',  icon: '⇅',  class: '', note: '(Not profit)' }
    ];

    container.innerHTML = cards.map(function (c) {
      return '<button class="rx-kpi-card ' + (c.class || '') + '" data-kpi="' + c.id + '" ' +
             'aria-label="' + c.label + ': ' + c.value + '">' +
             '<span class="kpi-icon">' + c.icon + '</span>' +
             '<span class="kpi-value">' + c.value + '</span>' +
             '<span class="kpi-label">' + c.label + (c.note ? '<br><small>' + c.note + '</small>' : '') + '</span>' +
             '</button>';
    }).join('');

    // KPI click → show detail panel
    $$('.rx-kpi-card', container).forEach(function (btn) {
      btn.addEventListener('click', function () {
        showKpiDetail(btn.dataset.kpi, data);
      });
    });
  }

  /* ----------------------------------------------------------
     3. TODAY'S QUEUE TABLE
  ---------------------------------------------------------- */

  var APPT_STATUS_LABELS = {
    'SCHEDULED':       { label: 'Scheduled',       cls: 'badge-blue' },
    'CONFIRMED':       { label: 'Confirmed',        cls: 'badge-teal' },
    'ARRIVED':         { label: 'Arrived ✓',        cls: 'badge-green' },
    'IN_CONSULTATION': { label: 'In Consultation',  cls: 'badge-orange' },
    'COMPLETED':       { label: 'Completed',        cls: 'badge-green-dark' },
    'CANCELLED':       { label: 'Cancelled',        cls: 'badge-red' },
    'NO_SHOW':         { label: 'No-show',          cls: 'badge-grey' }
  };

  function renderQueue(data) {
    var tbody = $('#rx-queue-tbody');
    if (!tbody) return;

    var appts    = (data.appointments || []).sort(function (a, b) {
      return String(a.scheduledAt || '').localeCompare(String(b.scheduledAt || ''));
    });
    var bills    = data.bills    || [];
    var payments = data.payments || [];

    if (appts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="rx-empty">No appointments scheduled for today</td></tr>';
      return;
    }

    tbody.innerHTML = appts.map(function (appt) {
      var statusInfo = APPT_STATUS_LABELS[appt.status] || { label: appt.status, cls: 'badge-grey' };

      // Find this patient's bill and outstanding
      var patientBills = bills.filter(function (b) {
        return b.patientId === appt.patientId && b.status !== 'VOID';
      });
      var patientPays = payments.filter(function (p) {
        return p.patientId === appt.patientId && p.status !== 'VOID';
      });
      var billDue = data.outstanding
        ? (data.outstanding || []).filter(function (row) { return row.patientId === appt.patientId; })
            .reduce(function (sum, row) { return sum + FC.toNum(row.balance); }, 0)
        : FC.calcOutstanding(
            patientBills.map(function (b) { return b.netBillAmount; }),
            FC.getEffectivePayments(patientPays).map(function (p) { return p.amount; })
          );

      var activeBill = patientBills.find(function (b) {
        return b.status === 'POSTED' || b.status === 'PART_PAID' || b.status === 'DRAFT';
      });

      var billStatusText = activeBill
        ? '<span class="badge badge-' + activeBill.status.toLowerCase() + '">' + activeBill.status + '</span>'
        : '<span class="rx-muted">—</span>';

      var timeStr = appt.scheduledAt
        ? new Date(appt.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '—';

      var dueText = billDue > 0
        ? '<span class="rx-due">' + FC.formatINR(billDue) + '</span>'
        : '<span class="rx-muted">Nil</span>';

      var pendingMark = appt._pending ? ' <span class="rx-pending-dot" title="Pending sync">●</span>' : '';

      return '<tr data-appointment-id="' + esc_(appt.appointmentId) + '" ' +
             '    data-patient-id="'     + esc_(appt.patientId)     + '" ' +
             '    data-status="'         + esc_(appt.status)         + '">' +
        '<td>' + timeStr + '</td>' +
        '<td class="rx-patient-name">' + esc_(appt.patientName) + pendingMark + '</td>' +
        '<td>' + esc_(appt.phone || '—') + '</td>' +
        '<td>' + esc_(appt.reason || '—') + '</td>' +
        '<td><span class="badge ' + statusInfo.cls + '">' + statusInfo.label + '</span></td>' +
        '<td>' + dueText + '</td>' +
        '<td>' + billStatusText + '</td>' +
        '<td class="rx-actions">' + renderQueueActions(appt, activeBill) + '</td>' +
      '</tr>';
    }).join('');

    // Bind row action buttons
    $$('button[data-queue-action]', tbody).forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleQueueAction(
          btn.dataset.queueAction,
          btn.closest('tr').dataset.appointmentId,
          btn.closest('tr').dataset.patientId,
          btn.dataset
        );
      });
    });
  }

  function renderQueueActions(appt, activeBill) {
    var actions = [];
    var s = appt.status;

    actions.push(btn_('prescription', appt.appointmentId, 'Rx', 'btn-outline'));

    if (s === 'SCHEDULED' || s === 'CONFIRMED') {
      actions.push(btn_('check-in',     appt.appointmentId, '✓ Check In',         'btn-primary'));
      actions.push(btn_('no-show',      appt.appointmentId, 'No-show',             'btn-ghost'));
      actions.push(btn_('cancel',       appt.appointmentId, 'Cancel',              'btn-ghost'));
    }
    if (s === 'ARRIVED') {
      actions.push(btn_('consult',      appt.appointmentId, '▶ Consult',           'btn-primary'));
    }
    if (s === 'IN_CONSULTATION') {
      actions.push(btn_('complete',     appt.appointmentId, '✓ Complete',          'btn-primary'));
    }
    if (s !== 'COMPLETED' && s !== 'CANCELLED' && s !== 'NO_SHOW') {
      if (activeBill && activeBill.status === 'DRAFT') {
        actions.push(btn_('open-bill',  appt.appointmentId, '🧾 Bill',             'btn-outline', { billId: activeBill.billId }));
      } else {
        if (!activeBill) actions.push(btn_('new-bill', appt.appointmentId, '+ Bill', 'btn-outline'));
      }
    }
    if (activeBill && activeBill.status !== 'PAID') {
      actions.push(btn_('pay',          appt.appointmentId, '💰 Collect',          'btn-outline', { billId: activeBill ? activeBill.billId : '' }));
    }

    return actions.join('');
  }

  function btn_(action, apptId, label, cls, extra) {
    var extraAttrs = extra ? Object.keys(extra).map(function (k) {
      return 'data-' + k + '="' + esc_(extra[k]) + '"';
    }).join(' ') : '';
    return '<button class="rx-btn ' + cls + '" ' +
           'data-queue-action="' + action + '" ' +
           'data-appointment-id="' + esc_(apptId) + '" ' +
           extraAttrs +
           ' aria-label="' + esc_(label) + '">' + esc_(label) + '</button>';
  }

  function handleQueueAction(action, appointmentId, patientId, data) {
    var statusMap = {
      'check-in':  'ARRIVED',
      'consult':   'IN_CONSULTATION',
      'complete':  'COMPLETED',
      'no-show':   'NO_SHOW',
      'cancel':    'CANCELLED'
    };

    if (statusMap[action]) {
      var newStatus = statusMap[action];
      var confirmMsg = newStatus === 'CANCELLED'
        ? 'Cancel this appointment?'
        : (newStatus === 'NO_SHOW' ? 'Mark patient as no-show?' : null);
      if (confirmMsg && !confirm(confirmMsg)) return;

      var cache = FS.getReceptionCache();
      var appt  = cache.appointments.find(function (a) { return a.appointmentId === appointmentId; });
      FS.updateAppointmentStatus(appointmentId, newStatus, undefined, appt && appt.recordVersion);
      refreshQueueFromCache();
      return;
    }

    if (action === 'prescription') {
      var prescriptionCache = FS.getReceptionCache();
      var prescriptionAppt = (prescriptionCache.appointments || []).find(function (a) {
        return a.appointmentId === appointmentId;
      });
      if (prescriptionAppt && window.openPrescriptionFromReception) {
        window.openPrescriptionFromReception(prescriptionAppt);
      }
      return;
    }

    if (action === 'open-bill' || action === 'new-bill') {
      openBillDialog(patientId, appointmentId, data.billId || null);
      return;
    }

    if (action === 'pay') {
      openPaymentDialog(data.billId || null, patientId);
      return;
    }
  }

  /* ----------------------------------------------------------
     4. PATIENT QUICK SEARCH
  ---------------------------------------------------------- */

  function initPatientSearch() {
    var input  = $('#rx-patient-search');
    var results = $('#rx-search-results');
    if (!input || !results) return;

    var _timer;
    input.addEventListener('input', function () {
      clearTimeout(_timer);
      var q = input.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      _timer = setTimeout(function () { doPatientSearch(q, results); }, 300);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { results.hidden = true; input.value = ''; }
    });

    document.addEventListener('click', function (e) {
      if (!input.contains(e.target) && !results.contains(e.target)) {
        results.hidden = true;
      }
    });
  }

  async function doPatientSearch(query, resultsEl) {
    resultsEl.innerHTML = '<div class="rx-search-loading">Searching…</div>';
    resultsEl.hidden = false;

    var res = await FS.searchPatients(query);
    if (!res.ok || !res.results || res.results.length === 0) {
      resultsEl.innerHTML = '<div class="rx-search-empty">No patients found for "' + esc_(query) + '"</div>';
      return;
    }

    resultsEl.innerHTML = res.results.map(function (p) {
      return '<button class="rx-search-item" data-patient-id="' + esc_(p.patientId || '') + '">' +
        '<strong>' + esc_(p.name) + '</strong>' +
        '<span class="rx-search-meta">' + esc_(p.phone || '') + ' · Last: ' + esc_(p.lastVisit || 'N/A') + '</span>' +
        '</button>';
    }).join('');

    $$('.rx-search-item', resultsEl).forEach(function (btn) {
      btn.addEventListener('click', function () {
        resultsEl.hidden = true;
        var selected = res.results.find(function (p) { return String(p.patientId || '') === btn.dataset.patientId; });
        openPatientPanel(btn.dataset.patientId, selected || null);
      });
    });
  }

  /* ----------------------------------------------------------
     5. PATIENT PANEL
  ---------------------------------------------------------- */

  function openPatientPanel(patientId, patient) {
    var panel = $('#rx-patient-panel');
    if (!panel) return;

    panel.hidden = false;
    panel.innerHTML = '<div class="rx-panel-loading">Loading patient data…</div>';

    // Load from cache first
    var cache = FS.getReceptionCache();
    var patientBills = (cache.bills || []).filter(function (b) { return b.patientId === patientId; });
    var patientPays  = (cache.payments || []).filter(function (p) { return p.patientId === patientId; });
    var patientAppts = (cache.appointments || []).filter(function (a) { return a.patientId === patientId; });

    var outstanding = FC.calcOutstanding(
      patientBills.filter(function (b) { return b.status !== 'VOID'; }).map(function (b) { return b.netBillAmount; }),
      FC.getEffectivePayments(patientPays).map(function (p) { return p.amount; })
    );

    var latestBill = patientBills.slice().sort(function (a, b) {
      return String(b.billDate || '').localeCompare(String(a.billDate || ''));
    })[0];

    patient = patient || {};
    panel.innerHTML =
      '<div class="rx-panel-header">' +
        '<h3 id="rx-panel-title">Patient Record</h3>' +
        '<button id="rx-panel-close" class="rx-btn btn-ghost" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="rx-panel-body">' +
        '<div class="rx-patient-info">' +
          '<div class="rx-info-row"><span class="rx-info-label">Patient</span><span>' + esc_(patient.name || 'Patient record') + '</span></div>' +
          '<div class="rx-info-row"><span class="rx-info-label">Phone</span><span>' + esc_(patient.phone || '—') + '</span></div>' +
          '<div class="rx-info-row"><span class="rx-info-label">Patient ID</span><span>' + esc_(patientId || 'N/A') + '</span></div>' +
          '<div class="rx-info-row"><span class="rx-info-label">Outstanding</span>' +
            '<span class="' + (outstanding > 0 ? 'rx-amount-due' : 'rx-amount-ok') + '">' + FC.formatINR(outstanding) + '</span></div>' +
        '</div>' +
        '<div class="rx-patient-bills">' +
          '<h4>Bills</h4>' +
          (patientBills.length === 0
            ? '<p class="rx-muted">No bills on record</p>'
            : '<table class="rx-table"><thead><tr><th>Date</th><th>Bill ID</th><th>Net Billed</th><th>Status</th><th>Action</th></tr></thead><tbody>' +
              patientBills.map(function (b) {
                return '<tr>' +
                  '<td>' + esc_(String(b.billDate || '').slice(0,10)) + '</td>' +
                  '<td class="rx-mono">' + esc_(b.billId || '') + '</td>' +
                  '<td>' + FC.formatINR(b.netBillAmount) + '</td>' +
                  '<td><span class="badge badge-' + (b.status || '').toLowerCase() + '">' + esc_(b.status || '') + '</span></td>' +
                  '<td>' +
                    (b.status === 'POSTED' || b.status === 'PART_PAID'
                      ? '<button class="rx-btn btn-outline btn-sm" onclick="Receptionist.openPaymentDialog(\'' + esc_(b.billId) + '\',\'' + esc_(patientId) + '\')">Collect</button>'
                      : '') +
                  '</td>' +
                '</tr>';
              }).join('') +
              '</tbody></table>'
          ) +
        '</div>' +
        '<div class="rx-patient-actions">' +
          '<button id="rx-panel-appointment" class="rx-btn btn-primary">+ Appointment</button>' +
          '<button class="rx-btn btn-primary" onclick="Receptionist.openBillDialog(\'' + esc_(patientId) + '\',null,null)">+ New Bill</button>' +
          '<button class="rx-btn btn-outline" onclick="Receptionist.openPaymentDialog(null,\'' + esc_(patientId) + '\')">+ Payment</button>' +
        '</div>' +
      '</div>';

    $('#rx-panel-close', panel).addEventListener('click', function () {
      panel.hidden = true;
    });
    $('#rx-panel-appointment', panel).addEventListener('click', function () {
      openAppointmentDialog(patientId, patient.name || '', patient.phone || '');
    });
  }

  /* ----------------------------------------------------------
     5B. APPOINTMENT DIALOG
  ---------------------------------------------------------- */

  function openAppointmentDialog(patientId, patientName, phone) {
    var dlg = $('#rx-appointment-dialog');
    if (!dlg) { dlg = buildAppointmentDialog(); document.body.appendChild(dlg); }
    $('#appt-patient-id', dlg).value = patientId || FC.genPatientId();
    $('#appt-patient-name', dlg).value = patientName || '';
    $('#appt-phone', dlg).value = phone || '';
    var istNow = new Date(Date.now() + (5 * 60 + 30) * 60000).toISOString().slice(0, 16);
    $('#appt-scheduled-at', dlg).value = istNow;
    $('#appt-reason', dlg).value = '';
    $('#appt-notes', dlg).value = '';
    dlg.hidden = false;
    dlg.removeAttribute('aria-hidden');
    $('#appt-patient-name', dlg).focus();

    $('#appt-close', dlg).onclick = function () { dlg.hidden = true; };
    $('#appt-cancel', dlg).onclick = function () { dlg.hidden = true; };
    $('#appt-form', dlg).onsubmit = function (e) {
      e.preventDefault();
      var localDateTime = $('#appt-scheduled-at', dlg).value;
      var result = FS.saveAppointment({
        appointmentId: FC.genAppointmentId(),
        patientId: $('#appt-patient-id', dlg).value,
        patientName: $('#appt-patient-name', dlg).value.trim(),
        phone: $('#appt-phone', dlg).value.trim(),
        scheduledAt: localDateTime ? localDateTime + ':00+05:30' : '',
        reason: $('#appt-reason', dlg).value.trim(),
        notes: $('#appt-notes', dlg).value.trim(),
        status: 'SCHEDULED'
      });
      dlg.hidden = true;
      refreshQueueFromCache();
      showToast('Appointment saved (' + result.operationId.slice(-8) + ')');
    };
  }

  function buildAppointmentDialog() {
    var dlg = document.createElement('div');
    dlg.id = 'rx-appointment-dialog';
    dlg.className = 'rx-dialog-overlay';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.innerHTML =
      '<div class="rx-dialog">' +
        '<div class="rx-dialog-header"><h2>Schedule Appointment</h2>' +
          '<button id="appt-close" type="button" class="rx-btn btn-ghost" aria-label="Close">✕</button></div>' +
        '<form id="appt-form" class="rx-dialog-body">' +
          '<input id="appt-patient-id" type="hidden" />' +
          '<div class="rx-form-row"><label for="appt-patient-name">Patient Name</label><input id="appt-patient-name" required /></div>' +
          '<div class="rx-form-row"><label for="appt-phone">Phone</label><input id="appt-phone" inputmode="tel" /></div>' +
          '<div class="rx-form-row"><label for="appt-scheduled-at">Date &amp; Time</label><input id="appt-scheduled-at" type="datetime-local" required /></div>' +
          '<div class="rx-form-row"><label for="appt-reason">Visit Reason</label><input id="appt-reason" /></div>' +
          '<div class="rx-form-row"><label for="appt-notes">Notes</label><input id="appt-notes" /></div>' +
          '<div class="rx-dialog-footer"><button id="appt-cancel" type="button" class="rx-btn btn-outline">Cancel</button>' +
            '<button type="submit" class="rx-btn btn-primary">Save Appointment</button></div>' +
        '</form>' +
      '</div>';
    return dlg;
  }

  /* ----------------------------------------------------------
     6. QUICK PAYMENT DIALOG
  ---------------------------------------------------------- */

  function openPaymentDialog(billId, patientId) {
    var dlg = $('#rx-payment-dialog');
    if (!dlg) { dlg = buildPaymentDialog(); document.body.appendChild(dlg); }

    var cache = FS.getReceptionCache();
    var financeCache = FS.getFinanceCache();
    var knownBills = (cache.bills || []).concat(financeCache.bills || []).filter(function (b, index, rows) {
      return rows.findIndex(function (candidate) { return candidate.billId === b.billId; }) === index;
    });
    var knownPayments = (cache.payments || []).concat(financeCache.payments || []).filter(function (p, index, rows) {
      return rows.findIndex(function (candidate) { return candidate.paymentId === p.paymentId; }) === index;
    });
    var bill  = billId ? knownBills.find(function (b) { return b.billId === billId; }) : null;
    var bills = patientId
      ? knownBills.filter(function (b) {
          return b.patientId === patientId &&
                 (b.status === 'POSTED' || b.status === 'PART_PAID');
        })
      : (bill ? [bill] : []);

    var billSelect = $('#pay-bill-select', dlg);
    var amountInput = $('#pay-amount', dlg);
    var balanceEl   = $('#pay-balance', dlg);
    var afterEl     = $('#pay-after', dlg);

    billSelect.innerHTML = bills.map(function (b) {
      return '<option value="' + esc_(b.billId) + '">' +
             'Bill ' + esc_(b.billId.slice(-8)) + ' — Due: ' + FC.formatINR(b.netBillAmount) + '</option>';
    }).join('');
    if (bill) billSelect.value = billId;

    function updateBalance() {
      var selectedBillId = billSelect.value;
      var selectedBill = bills.find(function (b) { return b.billId === selectedBillId; });
      if (!selectedBill) { balanceEl.textContent = '—'; return; }
      var pays = knownPayments.filter(function (p) { return p.billId === selectedBillId; });
      var netPaid = FC.calcNetCollected(pays);
      var balance = FC.round2(FC.toNum(selectedBill.netBillAmount) - netPaid);
      balanceEl.textContent = FC.formatINR(balance);
      amountInput.max = balance;
      if (!amountInput.value) amountInput.value = balance.toFixed(2);
      var after = FC.round2(balance - (parseFloat(amountInput.value) || 0));
      afterEl.textContent = FC.formatINR(Math.max(0, after));
    }

    billSelect.onchange = updateBalance;
    amountInput.oninput = function () {
      var balance = parseFloat(balanceEl.textContent.replace(/[^0-9.-]/g,'')) || 0;
      var after = FC.round2(balance - (parseFloat(amountInput.value) || 0));
      afterEl.textContent = FC.formatINR(Math.max(0, after));
    };
    updateBalance();

    dlg.hidden = false;
    dlg.removeAttribute('aria-hidden');
    amountInput.focus();

    $('#pay-cancel', dlg).onclick = function () { dlg.hidden = true; };
    $('#pay-close', dlg).onclick = function () { dlg.hidden = true; };
    $('#pay-form', dlg).onsubmit = function (e) {
      e.preventDefault();
      submitPayment(dlg, billSelect.value, patientId, cache);
    };
  }

  function buildPaymentDialog() {
    var dlg = document.createElement('div');
    dlg.id = 'rx-payment-dialog';
    dlg.className = 'rx-dialog-overlay';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'pay-dialog-title');
    dlg.innerHTML =
      '<div class="rx-dialog">' +
        '<div class="rx-dialog-header">' +
          '<h2 id="pay-dialog-title">Record Payment</h2>' +
          '<button id="pay-close" type="button" class="rx-btn btn-ghost" aria-label="Close">✕</button>' +
        '</div>' +
        '<form id="pay-form" class="rx-dialog-body">' +
          '<div class="rx-form-row">' +
            '<label for="pay-bill-select">Bill</label>' +
            '<select id="pay-bill-select" required></select>' +
          '</div>' +
          '<div class="rx-balance-display">' +
            '<span>Outstanding: <strong id="pay-balance">—</strong></span>' +
            '<span>After payment: <strong id="pay-after">—</strong></span>' +
          '</div>' +
          '<div class="rx-form-row">' +
            '<label for="pay-amount">Amount (₹)</label>' +
            '<input id="pay-amount" type="number" min="1" step="0.01" required />' +
          '</div>' +
          '<div class="rx-form-row">' +
            '<label for="pay-mode">Payment Mode</label>' +
            '<select id="pay-mode" required>' +
              '<option value="CASH">Cash</option>' +
              '<option value="UPI">UPI</option>' +
              '<option value="CARD">Card</option>' +
              '<option value="BANK">Bank Transfer</option>' +
              '<option value="OTHER">Other</option>' +
            '</select>' +
          '</div>' +
          '<div class="rx-form-row">' +
            '<label for="pay-reference">Reference / UTR (optional)</label>' +
            '<input id="pay-reference" type="text" placeholder="e.g. UPI transaction ID" />' +
          '</div>' +
          '<div class="rx-form-row">' +
            '<label for="pay-note">Note (optional)</label>' +
            '<input id="pay-note" type="text" />' +
          '</div>' +
          '<div class="rx-dialog-footer">' +
            '<button type="button" id="pay-cancel" class="rx-btn btn-outline">Cancel</button>' +
            '<button type="submit" class="rx-btn btn-primary">Save Payment</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    return dlg;
  }

  function submitPayment(dlg, billId, patientId, cache) {
    var amount    = parseFloat($('#pay-amount', dlg).value);
    var mode      = $('#pay-mode', dlg).value;
    var reference = $('#pay-reference', dlg).value.trim();
    var note      = $('#pay-note', dlg).value.trim();

    if (!isFinite(amount) || amount <= 0) {
      showDlgError(dlg, 'Please enter a valid amount.');
      return;
    }

    var bill = billId ? (cache.bills || []).find(function (b) { return b.billId === billId; }) : null;
    if (!bill) { showDlgError(dlg, 'Please select a bill.'); return; }

    var user = FS.getCurrentUser();
    var result = FS.recordPayment({
      paymentId:       FC.genPaymentId(),
      billId:          billId,
      visitId:         bill.visitId || '',
      patientId:       bill.patientId || patientId || '',
      paymentDate:     new Date().toISOString(),
      amount:          amount,
      paymentMode:     mode,
      reference:       reference,
      note:            note,
      transactionType: 'PAYMENT'
    });

    if (result && result.errors) {
      showDlgError(dlg, result.errors.join('\n'));
      return;
    }

    dlg.hidden = true;
    refreshQueueFromCache();
    renderSummaryStrip(FS.getReceptionCache());
    showToast('Payment of ' + FC.formatINR(amount) + ' recorded (' + result.operationId + ')');
  }

  /* ----------------------------------------------------------
     7. BILL DIALOG
  ---------------------------------------------------------- */

  function openBillDialog(patientId, appointmentId, existingBillId) {
    var dlg = $('#rx-bill-dialog');
    if (!dlg) { dlg = buildBillDialog(); document.body.appendChild(dlg); }

    var cache = FS.getReceptionCache();
    var existingBill = existingBillId
      ? (cache.bills || []).find(function (b) { return b.billId === existingBillId; })
      : null;

    if (existingBill && existingBill.status !== 'DRAFT') {
      showToast('Posted bills cannot be edited. Use Collect to record a payment.');
      return;
    }

    $('#bill-patient-id', dlg).value  = patientId || '';
    $('#bill-appt-id', dlg).value     = appointmentId || '';
    $('#bill-id', dlg).value          = (existingBill && existingBill.billId) || FC.genBillId();
    $('#bill-date', dlg).value        = FC.toISTDateString();
    $('#bill-discount', dlg).value    = existingBill ? existingBill.discount : '0';

    var tbody = $('#bill-items-body', dlg);
    tbody.innerHTML = '';
    if (existingBill && existingBill.itemsJson) {
      try {
        var items = typeof existingBill.itemsJson === 'string'
          ? JSON.parse(existingBill.itemsJson) : existingBill.itemsJson;
        items.forEach(function (item) { addBillItemRow(tbody, item, dlg); });
      } catch (e) { addBillItemRow(tbody, null, dlg); }
    } else {
      addBillItemRow(tbody, null, dlg);
    }

    updateBillTotals(dlg);
    dlg.hidden = false;
    dlg.removeAttribute('aria-hidden');

    // Prior outstanding
    var priorEl = $('#bill-prior-outstanding', dlg);
    var bills = (cache.bills || []).filter(function (b) {
      return b.patientId === patientId && b.status !== 'VOID' && b.billId !== existingBillId;
    });
    var pays = (cache.payments || []).filter(function (p) { return p.patientId === patientId; });
    var prior = FC.calcOutstanding(
      bills.filter(function (b) { return b.status !== 'VOID'; }).map(function (b) { return b.netBillAmount; }),
      FC.getEffectivePayments(pays).map(function (p) { return p.amount; })
    );
    if (priorEl) priorEl.textContent = prior > 0 ? FC.formatINR(prior) : 'None';

    $('#bill-add-item', dlg).onclick = function () { addBillItemRow(tbody, null, dlg); updateBillTotals(dlg); };
    $('#bill-cancel', dlg).onclick   = function () { dlg.hidden = true; };
    $('#bill-close', dlg).onclick    = function () { dlg.hidden = true; };
    $('#bill-form', dlg).onsubmit    = function (e) { e.preventDefault(); submitBill(dlg, cache); };
  }

  function addBillItemRow(tbody, item, dlg) {
    item = item || {};
    var tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" class="bill-item-desc" value="' + esc_(item.description || '') + '" placeholder="Service/item" required /></td>' +
      '<td><input type="number" class="bill-item-qty" value="' + (item.quantity || 1) + '" min="1" step="1" style="width:60px" /></td>' +
      '<td><input type="number" class="bill-item-price" value="' + (item.unitPrice || '') + '" min="0" step="0.01" placeholder="0.00" /></td>' +
      '<td class="bill-item-amount rx-mono">₹0.00</td>' +
      '<td><button type="button" class="rx-btn btn-ghost btn-sm bill-item-del">✕</button></td>';

    tr.querySelector('.bill-item-del').addEventListener('click', function () {
      tr.remove();
      updateBillTotals(dlg);
    });
    ['bill-item-qty','bill-item-price'].forEach(function (cls) {
      tr.querySelector('.' + cls).addEventListener('input', function () {
        var q = parseFloat(tr.querySelector('.bill-item-qty').value) || 0;
        var p = parseFloat(tr.querySelector('.bill-item-price').value) || 0;
        tr.querySelector('.bill-item-amount').textContent = FC.formatINR(q * p);
        updateBillTotals(dlg);
      });
    });
    tbody.appendChild(tr);
  }

  function updateBillTotals(dlg) {
    var rows = $$('#bill-items-body tr', dlg);
    var currentCharges = 0;
    rows.forEach(function (tr) {
      var q = parseFloat(tr.querySelector('.bill-item-qty').value) || 0;
      var p = parseFloat(tr.querySelector('.bill-item-price').value) || 0;
      currentCharges += FC.round2(q * p);
    });
    var discount = parseFloat($('#bill-discount', dlg).value) || 0;
    var net = FC.round2(currentCharges - discount);
    var chargesEl = $('#bill-current-charges', dlg);
    var netEl     = $('#bill-net-amount', dlg);
    if (chargesEl) chargesEl.textContent = FC.formatINR(currentCharges);
    if (netEl)     netEl.textContent     = FC.formatINR(net);
  }

  function buildBillDialog() {
    var dlg = document.createElement('div');
    dlg.id = 'rx-bill-dialog';
    dlg.className = 'rx-dialog-overlay';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'bill-dialog-title');
    dlg.innerHTML =
      '<div class="rx-dialog rx-dialog-wide">' +
        '<div class="rx-dialog-header">' +
          '<h2 id="bill-dialog-title">Create Bill</h2>' +
          '<button id="bill-close" type="button" class="rx-btn btn-ghost" aria-label="Close">✕</button>' +
        '</div>' +
        '<form id="bill-form" class="rx-dialog-body">' +
          '<input type="hidden" id="bill-id" />' +
          '<input type="hidden" id="bill-patient-id" />' +
          '<input type="hidden" id="bill-appt-id" />' +
          '<div class="rx-form-row"><label>Date</label><input id="bill-date" type="date" required /></div>' +
          '<div class="rx-prior-outstanding"><label>Prior Outstanding:</label> <span id="bill-prior-outstanding">—</span></div>' +
          '<table class="rx-table"><thead><tr>' +
            '<th>Description</th><th>Qty</th><th>Unit Price (₹)</th><th>Amount</th><th></th>' +
          '</tr></thead><tbody id="bill-items-body"></tbody></table>' +
          '<button type="button" id="bill-add-item" class="rx-btn btn-outline btn-sm">+ Add Item</button>' +
          '<div class="rx-bill-totals">' +
            '<div class="rx-total-row"><span>Current Charges:</span><span id="bill-current-charges">₹0.00</span></div>' +
            '<div class="rx-total-row"><span>Discount (₹):</span><input id="bill-discount" type="number" min="0" step="0.01" value="0" style="width:100px" /></div>' +
            '<div class="rx-total-row rx-total-net"><span>Net Bill Amount:</span><span id="bill-net-amount">₹0.00</span></div>' +
          '</div>' +
          '<div class="rx-form-row"><label for="bill-notes">Notes</label><input id="bill-notes" type="text" /></div>' +
          '<div class="rx-dialog-footer">' +
            '<button type="button" id="bill-cancel" class="rx-btn btn-outline">Cancel</button>' +
            '<button type="submit" class="rx-btn btn-primary">Save &amp; Post Bill</button>' +
          '</div>' +
        '</form>' +
      '</div>';

    $('#bill-discount', dlg).addEventListener('input', function () { updateBillTotals(dlg); });
    return dlg;
  }

  function submitBill(dlg, cache) {
    var billId    = $('#bill-id', dlg).value;
    var patientId = $('#bill-patient-id', dlg).value;
    var apptId    = $('#bill-appt-id', dlg).value;
    var billDate  = $('#bill-date', dlg).value;
    var discount  = parseFloat($('#bill-discount', dlg).value) || 0;
    var notes     = $('#bill-notes', dlg).value.trim();

    var items = $$('#bill-items-body tr', dlg).map(function (tr) {
      var desc  = tr.querySelector('.bill-item-desc').value.trim();
      var qty   = parseFloat(tr.querySelector('.bill-item-qty').value) || 1;
      var price = parseFloat(tr.querySelector('.bill-item-price').value) || 0;
      return { description: desc, quantity: qty, unitPrice: price, amount: FC.round2(qty * price) };
    }).filter(function (item) { return item.description || item.amount > 0; });

    if (items.length === 0) {
      showDlgError(dlg, 'Please add at least one item to the bill.');
      return;
    }

    // Lookup patient name from cache
    var appt = apptId ? (cache.appointments || []).find(function (a) { return a.appointmentId === apptId; }) : null;
    var patientName = appt ? appt.patientName : '';
    var phone       = appt ? appt.phone : '';

    var result = FS.saveAndPostBill({
      billId: billId, patientId: patientId, appointmentId: apptId,
      billDate: billDate, patientName: patientName, phone: phone,
      items: items, discount: discount, notes: notes
    });

    dlg.hidden = true;
    refreshQueueFromCache();
    renderSummaryStrip(FS.getReceptionCache());
    showToast('Bill posted (' + billId.slice(-8) + ', sync ' + result.postOperationId.slice(-8) + ')');
  }

  /* ----------------------------------------------------------
     8. DAILY CLOSING PANEL
  ---------------------------------------------------------- */

  function initDailyClosing() {
    var form = $('#rx-closing-form');
    if (!form) return;

    var dateStr = FC.toISTDateString();
    var dateEl  = $('#closing-date', form);
    if (dateEl) dateEl.value = dateStr;

    function recalc() {
      var cache    = FS.getReceptionCache();
      var payments = cache.payments || [];
      var expenses = cache.expenses || [];
      var openingCash = parseFloat($('#closing-opening-cash', form).value) || 0;

      var cashTotals  = FC.extractCashTotals(payments, dateStr);
      var cashExp     = FC.extractCashExpenses(expenses, dateStr);
      var result      = FC.calcCashClosing({
        openingCash:   openingCash,
        cashPayments:  cashTotals.cashPayments,
        cashRefunds:   cashTotals.cashRefunds,
        cashExpenses:  cashExp,
        allCollections: 0,
        allActiveExpenses: 0
      });

      var setVal = function (id, v) {
        var el = $(id, form); if (el) el.textContent = FC.formatINR(v);
      };
      setVal('#closing-cash-payments',  cashTotals.cashPayments);
      setVal('#closing-cash-refunds',   cashTotals.cashRefunds);
      setVal('#closing-cash-expenses',  cashExp);
      setVal('#closing-expected',       result.expectedClosingCash);

      var counted = parseFloat($('#closing-counted', form).value);
      if (isFinite(counted)) {
        var diff = FC.round2(counted - result.expectedClosingCash);
        var diffEl = $('#closing-difference', form);
        if (diffEl) {
          diffEl.textContent = FC.formatINR(diff);
          diffEl.className = diff < 0 ? 'rx-amount-due' : (diff > 0 ? 'rx-amount-ok' : '');
        }
      }
    }

    if (form.dataset.rxBound === '1') { recalc(); return; }
    form.dataset.rxBound = '1';
    $('#closing-opening-cash', form).addEventListener('input', recalc);
    $('#closing-counted', form).addEventListener('input', recalc);
    recalc();

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (!window.AdminTools || !await window.AdminTools.ensureAdminSession()) return;
      var user = FS.getCurrentUser();
      if (user.role !== 'admin' && user.role !== 'doctor') {
        alert('Only Admin or Doctor can close the day.');
        return;
      }
      var openingCash = parseFloat($('#closing-opening-cash', form).value) || 0;
      var counted     = parseFloat($('#closing-counted', form).value);
      var note        = $('#closing-note', form) ? $('#closing-note', form).value.trim() : '';
      if (!isFinite(counted)) { alert('Please enter the counted closing cash amount.'); return; }
      if (!confirm('Close day ' + dateStr + '? This will lock new entries.')) return;

      FS.closeDay({
        businessDate: dateStr,
        openingCash: openingCash,
        countedClosingCash: counted,
        note: note
      });
      showToast('Day closing submitted. Waiting for server confirmation.');
    });
  }

  /* ----------------------------------------------------------
     9. KPI DETAIL PANEL
  ---------------------------------------------------------- */

  function showKpiDetail(kpiId, data) {
    var detailContainer = $('#rx-kpi-detail');
    if (!detailContainer) return;

    var title  = '';
    var content = '';
    var range  = FC.getDateRange('today', new Date((data.date || FC.toISTDateString()) + 'T00:00:00+05:30'));
    var bills    = data.bills    || [];
    var payments = data.payments || [];
    var expenses = (data.expenses || []).filter(function (e) { return e.status !== 'VOID'; });
    var appts    = data.appointments || [];

    switch (kpiId) {
      case 'kpi-billed':
        title = 'Bills Today';
        var revBills = FC.aggregateBilledRevenue(bills, range.start, range.end).bills;
        content = renderBillsTable(revBills);
        break;
      case 'kpi-collected':
        title = 'Collections Today';
        var colResult = FC.aggregateCollections(payments, range.start, range.end, bills);
        content = renderPaymentsTable(colResult.payments);
        break;
      case 'kpi-outstanding':
        title = 'Outstanding Balances';
        content = '<p class="rx-muted">Loading outstanding balances…</p>';
        FS.refreshOutstanding().then(function (res) {
          if (res.ok) {
            detailContainer.querySelector('.rx-detail-body').innerHTML = renderOutstandingTable(res.outstanding || []);
          }
        });
        break;
      case 'kpi-expenses':
        title = 'Expenses Today';
        content = renderExpensesTable(expenses);
        break;
      case 'kpi-scheduled':
      case 'kpi-arrived':
      case 'kpi-completed':
        var filterStatus = { 'kpi-scheduled': ['SCHEDULED','CONFIRMED'], 'kpi-arrived': ['ARRIVED'], 'kpi-completed': ['COMPLETED'] }[kpiId];
        title = { 'kpi-scheduled': 'Scheduled', 'kpi-arrived': 'Arrived', 'kpi-completed': 'Completed' }[kpiId];
        var filteredAppts = appts.filter(function (a) { return filterStatus.indexOf(a.status) !== -1; });
        content = renderAppointmentsList(filteredAppts);
        break;
      default:
        return;
    }

    detailContainer.innerHTML =
      '<div class="rx-detail-header">' +
        '<h3>' + title + '</h3>' +
        '<button class="rx-btn btn-ghost" onclick="this.closest(\'#rx-kpi-detail\').hidden=true">✕</button>' +
      '</div>' +
      '<div class="rx-detail-body">' + content + '</div>';
    detailContainer.hidden = false;
  }

  function renderBillsTable(bills) {
    if (!bills || bills.length === 0) return '<p class="rx-muted">No bills in this period.</p>';
    return '<table class="rx-table"><thead><tr><th>Date</th><th>Bill ID</th><th>Patient</th><th>Net Billed</th><th>Status</th></tr></thead><tbody>' +
      bills.map(function (b) {
        return '<tr><td>' + esc_(String(b.billDate || '').slice(0,10)) + '</td>' +
          '<td class="rx-mono">' + esc_(b.billId || '') + '</td>' +
          '<td>' + esc_(b.patientName || '') + '</td>' +
          '<td>' + FC.formatINR(b.netBillAmount) + '</td>' +
          '<td><span class="badge badge-' + (b.status||'').toLowerCase() + '">' + esc_(b.status) + '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderPaymentsTable(pays) {
    if (!pays || pays.length === 0) return '<p class="rx-muted">No payments in this period.</p>';
    return '<table class="rx-table"><thead><tr><th>Time</th><th>Payment ID</th><th>Bill</th><th>Amount</th><th>Mode</th><th>By</th></tr></thead><tbody>' +
      pays.map(function (p) {
        var t = p.paymentDate ? new Date(p.paymentDate).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '—';
        return '<tr><td>' + t + '</td>' +
          '<td class="rx-mono">' + esc_(p.paymentId || '') + '</td>' +
          '<td class="rx-mono">' + esc_(p.billId || '') + '</td>' +
          '<td class="' + (p.transactionType !== 'PAYMENT' ? 'rx-amount-due' : '') + '">' +
            (p.transactionType !== 'PAYMENT' ? '−' : '') + FC.formatINR(p.amount) + '</td>' +
          '<td><span class="badge badge-' + (p.paymentMode||'').toLowerCase() + '">' + esc_(p.paymentMode||'') + '</span></td>' +
          '<td>' + esc_(p.createdBy || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderExpensesTable(exps) {
    if (!exps || exps.length === 0) return '<p class="rx-muted">No expenses in this period.</p>';
    return '<table class="rx-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Mode</th><th>Vendor</th></tr></thead><tbody>' +
      exps.map(function (e) {
        return '<tr><td>' + esc_(String(e.expenseDate||'').slice(0,10)) + '</td>' +
          '<td>' + esc_(e.category||'') + '</td><td>' + esc_(e.description||'') + '</td>' +
          '<td>' + FC.formatINR(e.amount) + '</td>' +
          '<td><span class="badge badge-' + (e.paymentMode||'').toLowerCase() + '">' + esc_(e.paymentMode||'') + '</span></td>' +
          '<td>' + esc_(e.vendorPayee||'—') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderOutstandingTable(items) {
    if (!items || items.length === 0) return '<p class="rx-muted">No outstanding balances.</p>';
    return '<table class="rx-table"><thead><tr><th>Patient</th><th>Phone</th><th>Bill Date</th><th>Balance</th><th>Days</th><th>Action</th></tr></thead><tbody>' +
      items.map(function (o) {
        return '<tr><td>' + esc_(o.patientName||'') + '</td><td>' + esc_(o.phone||'') + '</td>' +
          '<td>' + esc_(o.billDate||'') + '</td>' +
          '<td class="rx-amount-due">' + FC.formatINR(o.balance) + '</td>' +
          '<td>' + (o.daysOutstanding||0) + '</td>' +
          '<td><button class="rx-btn btn-outline btn-sm" ' +
            'onclick="Receptionist.openPaymentDialog(\'' + esc_(o.billId) + '\',\'' + esc_(o.patientId) + '\')">Collect</button></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderAppointmentsList(appts) {
    if (!appts || appts.length === 0) return '<p class="rx-muted">No appointments in this category.</p>';
    return '<ul class="rx-appt-list">' +
      appts.map(function (a) {
        var t = a.scheduledAt ? new Date(a.scheduledAt).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) : '?';
        return '<li>' + t + ' — <strong>' + esc_(a.patientName||'') + '</strong> ' + esc_(a.phone||'') + '</li>';
      }).join('') + '</ul>';
  }

  /* ----------------------------------------------------------
     10. REFRESH AND INITIALIZATION
  ---------------------------------------------------------- */

  function refreshQueueFromCache() {
    var cache = FS.getReceptionCache();
    if (!cache) return;
    renderQueue(cache);
    renderSummaryStrip(cache);
  }

  async function loadReceptionDay(date) {
    var loadingEl = $('#rx-queue-loading');
    if (loadingEl) loadingEl.hidden = false;

    var result = await FS.refreshReceptionDay(date || FC.toISTDateString());
    var data   = result.data || {};

    if (loadingEl) loadingEl.hidden = true;
    renderSummaryStrip(data);
    renderQueue(data);
    initDailyClosing();

    return data;
  }

  function initReceptionTab() {
    var tab = $('#receptionView');
    if (!tab) return;

    // Load data when tab is shown
    tab.addEventListener('rx-tab-shown', function () {
      loadReceptionDay();
    });

    // Also load immediately if Reception is active
    if (tab.classList.contains('active')) {
      loadReceptionDay();
    }

    initPatientSearch();
    initSyncStatusBar();

    // Refresh button
    var refreshBtn = $('#rx-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () { loadReceptionDay(); });
    }
    var newApptBtn = $('#rx-new-appt-btn');
    if (newApptBtn) newApptBtn.addEventListener('click', function () { openAppointmentDialog('', '', ''); });
  }

  /* ----------------------------------------------------------
     UTILITIES
  ---------------------------------------------------------- */

  function esc_(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showDlgError(dlg, msg) {
    var errEl = $('.rx-dialog-error', dlg);
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.className = 'rx-dialog-error';
      var body = $('.rx-dialog-body', dlg);
      if (body) body.prepend(errEl);
    }
    errEl.textContent = msg;
    errEl.hidden = false;
    setTimeout(function () { errEl.hidden = true; }, 5000);
  }

  function showToast(msg) {
    var toast = $('#rx-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rx-toast';
      toast.className = 'rx-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('rx-toast-show');
    setTimeout(function () { toast.classList.remove('rx-toast-show'); }, 3500);
  }

  /* ----------------------------------------------------------
     EXPORT
  ---------------------------------------------------------- */

  window.Receptionist = {
    init:               initReceptionTab,
    loadReceptionDay:   loadReceptionDay,
    refreshQueue:       refreshQueueFromCache,
    openPaymentDialog:  openPaymentDialog,
    openBillDialog:     openBillDialog,
    openPatientPanel:   openPatientPanel,
    openAppointmentDialog: openAppointmentDialog,
    showKpiDetail:      showKpiDetail,
    showToast:          showToast,
    renderSummaryStrip: renderSummaryStrip,
    renderQueue:        renderQueue
  };

})();

﻿/* =========================================================
   RECEPTION PAGE LOGIC (rp-*) - Modified to sync with Doctor
   ========================================================= */

(function() {
  function getLocalISTDate() {
    return new Date(Date.now() + (5.5 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  }

  function getPatientsForDay(dayStr) {
    if (!window.getDayRecords) return [];
    var recs = window.getDayRecords().filter(function(r) { return (r.date || '') === dayStr; });
    recs.sort(function(a, b) { return String(a.timestamp).localeCompare(String(b.timestamp)); });
    return recs;
  }

  window.rpSetToday = function() {
    var dateEl = document.getElementById('rp-date');
    if (dateEl) dateEl.value = getLocalISTDate();
    rpLoadPatients();
  };

  window.rpLoadPatients = function() {
    var tbody = document.getElementById('rp-tbody');
    var countText = document.getElementById('rp-count');
    var dateEl = document.getElementById('rp-date');
    var searchEl = document.getElementById('rp-search');
    if (!tbody || !dateEl) return;
    
    var dayStr = dateEl.value;
    if (!dayStr) return;
    
    var patients = getPatientsForDay(dayStr);
    
    var q = (searchEl ? searchEl.value.trim().toLowerCase() : '');
    if (q) {
      patients = patients.filter(function(p) {
        return (p.name || '').toLowerCase().indexOf(q) > -1 || (p.phone || '').toLowerCase().indexOf(q) > -1;
      });
    }

    if (countText) {
      countText.innerHTML = 'Showing <strong>' + patients.length + '</strong> patient(s)';
    }

    if (patients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="rp-empty">No patients found.</td></tr>';
      return;
    }

    var html = '';
    patients.forEach(function(p, i) {
      var amountStr = p.billAmount ? '₹' + p.billAmount : '<span class="rp-amount-zero">0</span>';
      
      html += '<tr>' +
        '<td class="rp-serial">' + (i + 1) + '</td>' +
        '<td class="rp-name-cell">' + (p.name || '') + '</td>' +
        '<td>' + (p.age || '') + ' / ' + (p.gender ? p.gender.charAt(0) : '') + '</td>' +
        '<td>' + (p.phone || '-') + '</td>' +
        '<td>' + (p.address || '-') + '</td>' +
        '<td class="rp-amount-due">' + amountStr + '</td>' +
        '<td></td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  };

  window.rpSavePatient = function() {
    var nameEl = document.getElementById('rp-name');
    var ageEl = document.getElementById('rp-age');
    var genderEl = document.getElementById('rp-gender');
    var addrEl = document.getElementById('rp-address');
    var mobEl = document.getElementById('rp-mobile');
    var amtEl = document.getElementById('rp-amount');

    var name = nameEl.value.trim();
    if (!name) return alert('Patient Name is required.');

    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    var ts = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());

    var rec = {
      timestamp: ts,
      name: name,
      age: ageEl.value.trim(),
      gender: genderEl.value,
      phone: mobEl.value.trim(),
      address: addrEl.value.trim(),
      date: document.getElementById('rp-date').value || getLocalISTDate(),
      billAmount: amtEl.value.trim() || '0',
      patientId: 'P' + Date.now().toString().slice(-6),
      visitId: 'V' + Date.now().toString().slice(-6),
      billId: 'B' + Date.now().toString().slice(-6)
    };

    if (window.backupAndSend) {
      window.backupAndSend(rec).then(function() {
        rpClearForm();
        rpLoadPatients();
      });
    } else {
      alert("Error: backupAndSend not found.");
    }
  };

  window.rpClearForm = function() {
    document.getElementById('rp-edit-id').value = '';
    document.getElementById('rp-name').value = '';
    document.getElementById('rp-age').value = '';
    document.getElementById('rp-gender').selectedIndex = 0;
    document.getElementById('rp-address').value = '';
    document.getElementById('rp-mobile').value = '';
    document.getElementById('rp-amount').value = '0';
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function() {
      if (document.getElementById('receptionView')) {
        rpSetToday();
      }
    });
  }

  window.Receptionist = {
    init: function() {
      var r = document.querySelector('#receptionView');
      if (r && r.addEventListener) {
        r.addEventListener('rx-tab-shown', function(){});
      }
    }
  };

})();
