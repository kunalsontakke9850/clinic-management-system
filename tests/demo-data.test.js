'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const moduleSource = fs.readFileSync(path.join(root, 'demo-data.js'), 'utf8');

function loadDemo(url) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url });
  const calls = [];
  const context = {
    window: dom.window,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
    fetch: function () { calls.push('fetch'); return Promise.reject(new Error('demo must stay local')); }
  };
  vm.runInNewContext(moduleSource, context, { filename: 'demo-data.js' });
  return { window: dom.window, calls, api: dom.window.ClinicDemo };
}

test('demo mode seeds isolated fictional clinic records only when enabled', function () {
  const fixture = loadDemo('https://clinic.test/?demo=1');

  assert.equal(fixture.api.isEnabled(), true);
  const first = fixture.api.seed();
  const second = fixture.api.seed();
  assert.deepEqual(second, first);
  assert.equal(fixture.calls.length, 0);
  assert.equal(fixture.window.localStorage.getItem('clinic_demo_seed_v1'), '1');

  const patient = JSON.parse(fixture.window.localStorage.getItem('patient_demo_arjun_mehta'));
  assert.equal(patient.name, 'Arjun Mehta');
  assert.equal(patient.phone, '9999999999');
  assert.equal(patient.doctorName, 'Dr. Demo User');
  const reception = JSON.parse(fixture.window.localStorage.getItem('clinic_reception_patients_v1'));
  assert.equal(reception[0].name, 'Arjun Mehta');
});

test('demo mode is disabled by default and reset removes only demo records', function () {
  const fixture = loadDemo('https://clinic.test/');
  fixture.window.localStorage.setItem('patient_private_record', JSON.stringify({ name: 'Keep Me' }));

  assert.equal(fixture.api.isEnabled(), false);
  assert.deepEqual(fixture.api.seed(), null);
  assert.equal(fixture.window.localStorage.getItem('patient_demo_arjun_mehta'), null);

  const enabled = loadDemo('https://clinic.test/?demo=1');
  enabled.window.localStorage.setItem('patient_private_record', JSON.stringify({ name: 'Keep Me' }));
  enabled.api.seed();
  enabled.api.reset();
  assert.equal(enabled.window.localStorage.getItem('patient_demo_arjun_mehta'), null);
  assert.equal(enabled.window.localStorage.getItem('clinic_demo_seed_v1'), null);
  assert.equal(enabled.window.localStorage.getItem('patient_private_record'), JSON.stringify({ name: 'Keep Me' }));
});
