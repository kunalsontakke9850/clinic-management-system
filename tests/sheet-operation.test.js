'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const OPERATION_FILE = path.join(__dirname, '..', 'sheet-operation.js');

function loadOperation() {
  const dom = new JSDOM('<!doctype html><html><body><div id="sheetOperationOverlay" hidden><p id="sheetOperationMessage"></p></div></body></html>');
  const context = { window: dom.window, document: dom.window.document, Promise, console };
  vm.runInNewContext(fs.readFileSync(OPERATION_FILE, 'utf8'), context, { filename: 'sheet-operation.js' });
  return { document: dom.window.document, api: dom.window.SheetOperation };
}

test('Google Sheets operation overlay blocks repeat actions until the request settles', async function () {
  const fixture = loadOperation();
  let finish;
  const pending = fixture.api.run('Deleting visit from Google Sheets…', function () {
    return new Promise(function (resolve) { finish = resolve; });
  });

  assert.equal(fixture.document.getElementById('sheetOperationOverlay').hidden, false);
  assert.equal(fixture.document.getElementById('sheetOperationMessage').textContent, 'Deleting visit from Google Sheets…');
  assert.equal(await fixture.api.run('Deleting again…', function () { throw new Error('must not run'); }), undefined);

  finish('deleted');
  assert.equal(await pending, 'deleted');
  assert.equal(fixture.document.getElementById('sheetOperationOverlay').hidden, true);
});

test('Google Sheets operation overlay clears when a request fails', async function () {
  const fixture = loadOperation();
  await assert.rejects(fixture.api.run('Deleting prescription from Google Sheets…', function () {
    throw new Error('network unavailable');
  }), /network unavailable/);
  assert.equal(fixture.document.getElementById('sheetOperationOverlay').hidden, true);
});
