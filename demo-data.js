(function (root) {
  'use strict';

  var MARKER = 'clinic_demo_seed_v1';
  var DEMO_KEYS = [
    MARKER,
    'patient_demo_arjun_mehta',
    'bills_arjun_mehta_9999999999',
    'clinic_reception_patients_v1',
    'reception_cache_v1',
    'finance_cache_v1',
    'clinic_expenses',
    'upcoming_appointment_actions'
  ];
  var DEMO_DATE = '2026-08-30';
  var DEMO_TIMESTAMP = '2026-08-30T09:30:00+05:30';

  var patient = {
    id: 'demo-visit-001',
    name: 'Arjun Mehta',
    age: 32,
    gender: 'M',
    phone: '9999999999',
    date: DEMO_DATE,
    timestamp: DEMO_TIMESTAMP,
    status: 'completed',
    doctorName: 'Dr. Demo User',
    chiefComplaint: 'Routine dental consultation',
    PMH: 'No known allergies',
    workDone: 'Clinical examination',
    instructions: 'Return for a routine follow-up if needed.',
    medicines: [
      { name: 'Sample mouth rinse', quantity: 1, frequency: 'Morning | Night', duration: '5 days' }
    ],
    totalFees: 600,
    feesPaid: 400,
    paymentHistory: [
      { id: 'demo-payment-001', amount: 400, mode: 'Cash', date: DEMO_DATE, type: 'payment' }
    ],
    whatsappConsent: true
  };

  var bill = {
    billId: 'demo-bill-001',
    patientName: patient.name,
    patientPhone: patient.phone,
    date: DEMO_DATE,
    currentCharges: 600,
    discount: 0,
    netBillAmount: 600,
    paidAmount: 400,
    balance: 200,
    status: 'PART_PAID'
  };

  var receptionPatient = {
    id: 'demo-reception-001',
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    phone: patient.phone,
    date: DEMO_DATE,
    status: 'completed',
    createdAt: DEMO_TIMESTAMP,
    whatsappConsent: true
  };

  var appointment = {
    id: 'demo-appointment-001',
    name: patient.name,
    phone: patient.phone,
    date: DEMO_DATE,
    appointmentDate: '2026-09-05',
    appointmentTime: '10:00',
    status: 'upcoming',
    notes: 'Routine follow-up'
  };

  function enabled() {
    return !!(root.location && /(?:^|[?&])demo=1(?:&|$)/.test(root.location.search || ''));
  }

  function write(key, value) {
    root.localStorage.setItem(key, JSON.stringify(value));
  }

  function snapshot() {
    return {
      patient: patient,
      bill: bill,
      appointment: appointment,
      receptionPatient: receptionPatient
    };
  }

  function seed() {
    if (!enabled()) return null;
    if (root.localStorage.getItem(MARKER) === '1') return snapshot();

    write('patient_demo_arjun_mehta', patient);
    write('bills_arjun_mehta_9999999999', [bill]);
    write('clinic_reception_patients_v1', [receptionPatient]);
    write('reception_cache_v1', {
      date: DEMO_DATE,
      appointments: [appointment],
      bills: [bill],
      payments: patient.paymentHistory,
      expenses: [],
      collectionTasks: [],
      closing: null,
      loadedAt: DEMO_TIMESTAMP
    });
    write('finance_cache_v1', {
      summary: { billedRevenue: 600, totalCollections: 400, outstanding: 200, totalExpenses: 0 },
      bills: [bill],
      payments: patient.paymentHistory,
      receipts: [],
      expenses: [],
      patientFees: [patient],
      completedVisits: [patient],
      outstanding: [bill],
      loadedAt: DEMO_TIMESTAMP
    });
    write('clinic_expenses', []);
    write('upcoming_appointment_actions', {});
    root.localStorage.setItem(MARKER, '1');
    return snapshot();
  }

  function reset() {
    if (!enabled()) return false;
    DEMO_KEYS.forEach(function (key) { root.localStorage.removeItem(key); });
    return true;
  }

  root.ClinicDemo = {
    isEnabled: enabled,
    seed: seed,
    reset: reset,
    keys: DEMO_KEYS.slice()
  };

  if (enabled()) seed();
}(window));
