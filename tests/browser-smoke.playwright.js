async page => {
  const actions = [];
  const pageErrors = [];
  const consoleErrors = [];
  const today = '2026-08-21';
  const appointments = [
    { appointmentId: 'APT-100', patientId: 'PAT-100', scheduledAt: today + 'T09:00:00+05:30', patientName: 'Asha Test', phone: '0000000000', reason: 'Consultation', status: 'SCHEDULED', recordVersion: '1' },
    { appointmentId: 'APT-200', patientId: 'PAT-200', scheduledAt: today + 'T10:00:00+05:30', patientName: 'Ravi Test', phone: '0000000001', reason: 'Follow-up', status: 'ARRIVED', recordVersion: '1' }
  ];
  const bills = [
    { billId: 'BIL-200', visitId: 'VIS-200', patientId: 'PAT-200', billDate: today, patientName: 'Ravi Test', phone: '0000000001', currentCharges: 500, discount: 0, netBillAmount: 500, status: 'POSTED', recordVersion: '2' }
  ];
  const payments = [];
  const expenses = [];

  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.addInitScript(() => localStorage.clear());
  await page.route('https://script.google.com/macros/s/**', async route => {
    const request = route.request();
    const getParam = name => {
      const match = request.url().match(new RegExp('[?&]' + name + '=([^&]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    };
    const action = getParam('action');
    let response = { ok: true };

    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      actions.push(body.action || body.sheet || 'legacy');
      const payload = body.payload || {};
      if (body.action === 'upsertAppointment') {
        const index = appointments.findIndex(row => row.appointmentId === payload.appointmentId);
        const row = Object.assign({ status: 'SCHEDULED', recordVersion: '1' }, payload);
        if (index >= 0) appointments[index] = Object.assign({}, appointments[index], row);
        else appointments.push(row);
        response = { ok: true, appointmentId: row.appointmentId, recordVersion: row.recordVersion };
      } else if (body.action === 'updateAppointmentStatus') {
        const row = appointments.find(item => item.appointmentId === payload.appointmentId);
        if (row) row.status = payload.status;
      } else if (body.action === 'upsertBill') {
        const index = bills.findIndex(row => row.billId === payload.billId);
        const row = Object.assign({}, payload, { status: 'DRAFT', recordVersion: '1' });
        if (index >= 0) bills[index] = Object.assign({}, bills[index], row);
        else bills.push(row);
        response = { ok: true, billId: row.billId, recordVersion: '1' };
      } else if (body.action === 'postBill') {
        const row = bills.find(item => item.billId === payload.billId);
        if (row) { row.status = 'POSTED'; row.recordVersion = '2'; }
      } else if (body.action === 'recordPayment') {
        payments.push(Object.assign({}, payload, { status: 'ACTIVE', createdBy: body.userId }));
        const row = bills.find(item => item.billId === payload.billId);
        if (row) row.status = payload.amount >= row.netBillAmount ? 'PAID' : 'PART_PAID';
      } else if (body.action === 'upsertExpense') {
        expenses.push(Object.assign({}, payload, { status: 'ACTIVE', createdBy: body.userId }));
      } else if (body.action === 'adminLogin') {
        response = { ok: true, sessionToken: 'TEST-SESSION', userId: 'doctor', role: 'admin', name: 'Doctor' };
      }
    } else if (action === 'receptionistDay') {
      response = { ok: true, date: today, appointments, bills, payments, expenses, outstanding: bills.filter(row => row.status === 'POSTED' || row.status === 'PART_PAID').map(row => ({
        billId: row.billId, patientId: row.patientId, patientName: row.patientName, phone: row.phone,
        billDate: row.billDate, netBillAmount: row.netBillAmount,
        paidToDate: payments.filter(payment => payment.billId === row.billId).reduce((sum, payment) => sum + payment.amount, 0),
        balance: Math.max(0, row.netBillAmount - payments.filter(payment => payment.billId === row.billId).reduce((sum, payment) => sum + payment.amount, 0)), status: row.status
      })), closing: null };
    } else if (action === 'financeSummary') {
      response = { ok: true, from: getParam('from'), to: getParam('to'), bills, payments, expenses,
        billedRevenue: bills.filter(row => row.status !== 'DRAFT' && row.status !== 'VOID').reduce((sum, row) => sum + Number(row.netBillAmount || 0), 0),
        totalCollected: payments.reduce((sum, row) => sum + Number(row.amount || 0), 0), totalExpenses: expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0) };
    } else if (action === 'outstanding') {
      response = { ok: true, outstanding: [] };
    } else if (action === 'patientSearch') {
      response = { ok: true, results: [{ patientId: 'PAT-300', name: 'Meena Test', phone: '0000000002', lastVisit: '2026-08-01' }] };
    } else if (action === 'audit') {
      response = { ok: true, audit: [] };
    } else {
      response = { ok: true, records: [] };
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
  });

  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('domcontentloaded');

  await page.locator('.nav-tab[data-view="reception"]').click();
  await page.locator('#rx-queue-tbody tr[data-appointment-id="APT-100"]').waitFor();

  await page.locator('tr[data-appointment-id="APT-100"] button[data-queue-action="prescription"]').click();
  if (await page.locator('#patName').inputValue() !== 'Asha Test') throw new Error('Reception appointment did not open the prescription identity');
  await page.locator('.nav-tab[data-view="reception"]').click();

  await page.locator('#rx-patient-search').fill('Meena');
  await page.locator('.rx-search-item').waitFor();
  await page.locator('.rx-search-item').click();
  await page.locator('#rx-panel-appointment').click();
  await page.locator('#appt-scheduled-at').fill(today + 'T11:30');
  await page.locator('#appt-form button[type="submit"]').click();

  await page.locator('tr[data-appointment-id="APT-100"] button[data-queue-action="new-bill"]').click();
  await page.locator('#rx-bill-dialog .bill-item-desc').fill('Consultation');
  await page.locator('#rx-bill-dialog .bill-item-price').fill('750');
  await page.locator('#bill-form button[type="submit"]').click();

  await page.locator('tr[data-appointment-id="APT-200"] button[data-queue-action="pay"]').click();
  await page.locator('#pay-amount').fill('200');
  await page.locator('#pay-form button[type="submit"]').click();

  await page.locator('.nav-tab[data-view="expenses"]').click();
  await page.locator('#expAmount').fill('300');
  await page.locator('#expDescription').fill('Test supplies');
  await page.locator('button[onclick="addExpense()"]', { hasText: 'Save' }).click();

  await page.locator('.nav-tab[data-view="finance"]').click();
  await page.locator('#fd-kpi-strip .rx-kpi-card').first().waitFor();
  await page.waitForTimeout(700);

  await page.locator('.nav-tab[data-view="report"]').click();
  await page.locator('button[onclick="loadMonthlyReport()"]').click();
  await page.locator('#reportContent').waitFor({ state: 'visible' });
  const reportBilledText = await page.locator('#rptBilled').innerText();

  const receptionCacheIsSerializable = await page.evaluate(() => {
    const value = localStorage.getItem('reception_cache_v1');
    return !!value && !!JSON.parse(value);
  });
  const financeText = await page.locator('#fd-kpi-strip').innerText();
  const uniqueDialogIds = await page.evaluate(() => {
    const ids = Array.from(document.querySelectorAll('[id]')).map(node => node.id);
    return ids.length === new Set(ids).size;
  });

  if (!actions.includes('upsertAppointment')) throw new Error('Appointment was not queued');
  if (!actions.includes('upsertBill') || !actions.includes('postBill')) throw new Error('Bill was not saved and posted');
  if (!actions.includes('recordPayment')) throw new Error('Payment was not recorded');
  if (!actions.includes('upsertExpense')) throw new Error('Expense was not recorded');
  if (!receptionCacheIsSerializable) throw new Error('Reception cache is not serializable');
  if (!uniqueDialogIds) throw new Error('Duplicate DOM IDs remain after opening dialogs');
  if (pageErrors.length) throw new Error('Page errors: ' + pageErrors.join(' | '));

  return { actions, financeText, reportBilledText, receptionCacheIsSerializable, uniqueDialogIds, pageErrors, consoleErrors };
}
