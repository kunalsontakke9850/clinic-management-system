(function (root) {
  'use strict';

  var doc = root.document;
  var PATIENTS_KEY = 'clinic_reception_patients_v1';
  var AUTH_KEY = 'Clinic_doctor_auth_v1';
  var SESSION_KEY = 'Clinic_doctor_session_v1';
  var SETTINGS_KEY = 'clinic_management_settings_v1';
  var DEFAULT_SETTINGS = { density: 'comfortable', autoLockMinutes: 0, whatsappClinicName: 'Clinic Management System', whatsappTemplate: 'Hello {name},\nWarm wishes from {clinic}.', whatsappSignature: 'Clinic Doctor' };
  var originalSwitchView = typeof root.switchView === 'function' ? root.switchView : null;
  var markupReady = false;
  var receptionDate = '';
  var editingReceptionId = '';
  var homeShowsPrevious = false;
  var collectionPollTimer = null;
  var autoLockTimer = null;
  var activeSettingsSection = '';

  function getStorage(name) {
    try { return root[name]; } catch (e) { return null; }
  }

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function capitalizeFirstWord(value) {
    return String(value == null ? '' : value).replace(/^(\s*)([a-z])/, function (_, leading, letter) {
      return leading + letter.toUpperCase();
    });
  }

  function normalizeVisibleCopy() {
    if (!doc || !doc.querySelectorAll) return;
    var selector = '#receptionView h1,#receptionView h2,#receptionView h3,#receptionView button,#receptionView label,#receptionView .tr-eyebrow,#receptionView .tr-kicker,#receptionView .tr-empty,#receptionView .tr-status-pill,#receptionView .tr-settings-help,#receptionView .tr-settings-note,#homeView h1,#homeView h2,#homeView button,#homeView .tr-empty,#settingsView h1,#settingsView h2,#settingsView h3,#settingsView button,#settingsView label,#settingsView .tr-eyebrow,#settingsView .tr-kicker,#settingsView .tr-settings-help,#settingsView .tr-settings-note';
    Array.prototype.forEach.call(doc.querySelectorAll(selector), function (element) {
      Array.prototype.forEach.call(element.childNodes || [], function (node) {
        if (node.nodeType === 3 && /[a-z]/.test(node.nodeValue)) node.nodeValue = capitalizeFirstWord(node.nodeValue);
      });
    });
  }

  function escapeHtml(value) {
    return text(value).replace(/[&<>"']/g, function (ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function istDate(value) {
    var date = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(date.getTime())) date = new Date();
    try {
      var parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date).reduce(function (out, part) {
        out[part.type] = part.value;
        return out;
      }, {});
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }
  }

  function isoDate(value) {
    var date = value instanceof Date ? value : new Date(value || Date.now());
    return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function readJson(key, fallback) {
    var store = getStorage('localStorage');
    try {
      var value = store && store.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    var store = getStorage('localStorage');
    try { if (store) store.setItem(key, JSON.stringify(value)); } catch (e) { /* local-only fallback */ }
  }

  function normalizeSettings(input) {
    input = input && typeof input === 'object' ? input : {};
    var autoLockMinutes = Number(input.autoLockMinutes);
    return {
      density: input.density === 'compact' ? 'compact' : DEFAULT_SETTINGS.density,
      autoLockMinutes: [0, 15, 30, 60].indexOf(autoLockMinutes) > -1 ? autoLockMinutes : DEFAULT_SETTINGS.autoLockMinutes,
      whatsappClinicName: text(input.whatsappClinicName) || DEFAULT_SETTINGS.whatsappClinicName,
      whatsappTemplate: text(input.whatsappTemplate) || DEFAULT_SETTINGS.whatsappTemplate,
      whatsappSignature: text(input.whatsappSignature) || DEFAULT_SETTINGS.whatsappSignature
    };
  }

  function getSettingsPreferences() {
    return normalizeSettings(readJson(SETTINGS_KEY, DEFAULT_SETTINGS));
  }

  function applyWorkspaceDensity() {
    var body = doc.body;
    if (!body) return;
    body.classList.toggle('doctor-density-compact', getSettingsPreferences().density === 'compact');
  }

  function clearAutoLockTimer() {
    if (autoLockTimer == null) return;
    if (typeof root.clearTimeout === 'function') root.clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }

  function resetAutoLockTimer() {
    clearAutoLockTimer();
    var preferences = getSettingsPreferences();
    if (!preferences.autoLockMinutes || !authApi || !authApi.isAuthenticated() || typeof root.setTimeout !== 'function') return;
    autoLockTimer = root.setTimeout(function () {
      autoLockTimer = null;
      if (authApi.isAuthenticated()) authApi.logout();
    }, preferences.autoLockMinutes * 60 * 1000);
  }

  function saveSettingsPreferences(input) {
    var preferences = normalizeSettings(Object.assign({}, getSettingsPreferences(), input || {}));
    writeJson(SETTINGS_KEY, preferences);
    applyWorkspaceDensity();
    resetAutoLockTimer();
    return preferences;
  }

  function fallbackHash(value) {
    var hashA = 2166136261;
    var hashB = 16777619;
    for (var i = 0; i < value.length; i++) {
      hashA ^= value.charCodeAt(i);
      hashA = Math.imul(hashA, 16777619);
      hashB ^= value.charCodeAt(i) + i;
      hashB = Math.imul(hashB, 2246822519);
    }
    return (hashA >>> 0).toString(16).padStart(8, '0') + (hashB >>> 0).toString(16).padStart(8, '0');
  }

  function hashValue(value) {
    var crypto = root.crypto;
    var Encoder = root.TextEncoder;
    if (crypto && crypto.subtle && typeof crypto.subtle.digest === 'function' && Encoder) {
      return crypto.subtle.digest('SHA-256', new Encoder().encode(value)).then(function (buffer) {
        return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
          return byte.toString(16).padStart(2, '0');
        }).join('');
      });
    }
    return Promise.resolve(fallbackHash(value));
  }

  function makeId(now) {
    return 'TR-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + istDate(now);
  }

  function normalizePatient(input, now, existing) {
    input = input || {};
    var record = existing ? Object.assign({}, existing) : {};
    record.id = existing ? existing.id : makeId(now);
    record.timestamp = existing ? existing.timestamp : isoDate(now);
    record.createdAt = existing ? existing.createdAt : isoDate(now);
    record.updatedAt = isoDate(now);
    record.name = text(input.name != null ? input.name : record.name);
    record.age = text(input.age != null ? input.age : record.age);
    record.gender = text(input.gender != null ? input.gender : record.gender).toUpperCase();
    record.phone = text(input.phone != null ? input.phone : record.phone);
    record.address = text(input.address != null ? input.address : record.address);
    var whatsappOptIn = text(input.whatsappOptIn != null ? input.whatsappOptIn : record.whatsappOptIn).toLowerCase();
    record.whatsappOptIn = ['yes', 'no'].indexOf(whatsappOptIn) > -1 ? whatsappOptIn : 'unknown';
    var due = Number(input.due != null ? input.due : record.due || 0);
    record.due = isFinite(due) && due > 0 ? due : 0;
    record.date = text(input.date != null ? input.date : record.date) || istDate(now);
    record.workflowStatus = existing && existing.workflowStatus === 'finalized' ? 'waiting' : (existing ? existing.workflowStatus : 'waiting');
    record.receptionDone = record.workflowStatus === 'finalized';
    record.receptionDoneAt = record.workflowStatus === 'finalized' ? (record.receptionDoneAt || '') : '';
    record.queueRemovedAt = record.workflowStatus === 'finalized' ? (record.queueRemovedAt || '') : '';
    return record;
  }

  var storeApi = {
    read: function () {
      var records = readJson(PATIENTS_KEY, []);
      return Array.isArray(records) ? records : [];
    },
    write: function (records) {
      writeJson(PATIENTS_KEY, Array.isArray(records) ? records : []);
      return records;
    },
    createPatient: function (input, now) {
      now = now instanceof Date ? now : new Date(now || Date.now());
      var records = this.read();
      var name = text(input && input.name).toLowerCase();
      var phone = text(input && input.phone);
      var date = text(input && input.date) || istDate(now);
      var existingIndex = name ? records.findIndex(function (item) {
        return text(item.name).toLowerCase() === name && text(item.phone) === phone && text(item.date) === date;
      }) : -1;
      var record = normalizePatient(input, now, existingIndex >= 0 ? records[existingIndex] : null);
      if (existingIndex >= 0) records[existingIndex] = record;
      else records.push(record);
      this.write(records);
      return record;
    },
    updatePatient: function (id, input, now) {
      now = now instanceof Date ? now : new Date(now || Date.now());
      var records = this.read();
      var index = records.findIndex(function (item) { return item.id === id; });
      if (index < 0) return null;
      var existing = records[index];
      var record = normalizePatient(Object.assign({}, existing, input || {}), now, existing);
      record.workflowStatus = existing.workflowStatus || 'waiting';
      record.receptionDone = !!existing.receptionDone;
      record.receptionDoneAt = existing.receptionDoneAt || '';
      record.queueRemovedAt = existing.queueRemovedAt || '';
      records[index] = record;
      this.write(records);
      return record;
    },
    deletePatient: function (id) {
      var records = this.read();
      var removed = records.find(function (item) { return item.id === id; }) || null;
      if (!removed) return null;
      this.write(records.filter(function (item) { return item.id !== id; }));
      return removed;
    },
    listPatients: function (date) {
      var target = date || istDate(new Date());
      return this.read().filter(function (item) { return text(item.date) === target; });
    },
    findPatient: function (id) {
      return this.read().find(function (item) { return item.id === id; }) || null;
    },
    search: function (records, query) {
      var needle = text(query).toLowerCase();
      if (!needle) return records || [];
      return (records || []).filter(function (item) {
        return [item.name, item.phone, item.address].some(function (field) {
          return text(field).toLowerCase().indexOf(needle) !== -1;
        });
      });
    },
    completePatient: function (id, now) {
      var records = this.read();
      var index = records.findIndex(function (item) { return item.id === id; });
      if (index < 0) return null;
      var stamp = isoDate(now || new Date());
      records[index] = Object.assign({}, records[index], {
        workflowStatus: 'finalized',
        receptionDone: true,
        receptionDoneAt: stamp,
        queueRemovedAt: stamp,
        updatedAt: stamp
      });
      this.write(records);
      return records[index];
    },
    counts: function (date) {
      var records = this.listPatients(date);
      return records.reduce(function (out, item) {
        if (item.workflowStatus === 'finalized' || item.receptionDone) out.completed += 1;
        else out.waiting += 1;
        return out;
      }, { waiting: 0, completed: 0 });
    }
  };

  var authApi = {
    hasCredentials: function () { return !!readJson(AUTH_KEY, null); },
    setup: async function (password, pin) {
      password = text(password);
      pin = text(pin);
      if (password.length < 4) throw new Error('Password must be at least 4 characters.');
      if (!/^\d{4,6}$/.test(pin)) throw new Error('Recovery PIN must contain 4 to 6 digits.');
      var hashes = await Promise.all([hashValue(password), hashValue(pin)]);
      writeJson(AUTH_KEY, { passwordHash: hashes[0], pinHash: hashes[1], updatedAt: isoDate(new Date()) });
      return true;
    },
    verifyPassword: async function (password) {
      var credentials = readJson(AUTH_KEY, null);
      if (!credentials || !credentials.passwordHash) return false;
      return (await hashValue(text(password))) === credentials.passwordHash;
    },
    changePassword: async function (currentPassword, newPassword) {
      currentPassword = text(currentPassword);
      newPassword = text(newPassword);
      if (newPassword.length < 4) return { ok: false, error: 'New password must be at least 4 characters.' };
      if (!await this.verifyPassword(currentPassword)) return { ok: false, error: 'Current password is incorrect.' };
      var credentials = readJson(AUTH_KEY, null) || {};
      credentials.passwordHash = await hashValue(newPassword);
      credentials.updatedAt = isoDate(new Date());
      writeJson(AUTH_KEY, credentials);
      return { ok: true };
    },
    login: async function (password) {
      var credentials = readJson(AUTH_KEY, null);
      if (!credentials || !credentials.passwordHash) return false;
      var valid = (await hashValue(text(password))) === credentials.passwordHash;
      if (valid) {
        var session = getStorage('sessionStorage');
        try { if (session) session.setItem(SESSION_KEY, 'active'); } catch (e) { /* no session storage */ }
        showDoctorShell();
        root.switchView('home');
      }
      return valid;
    },
    logout: function () {
      var session = getStorage('sessionStorage');
      try { if (session) session.removeItem(SESSION_KEY); } catch (e) { /* no session storage */ }
      clearAutoLockTimer();
      showReception();
    },
    isAuthenticated: function () {
      var session = getStorage('sessionStorage');
      try { return !!(session && session.getItem(SESSION_KEY) === 'active'); } catch (e) { return false; }
    },
    renderAccessState: function () {
      if (this.isAuthenticated()) showDoctorShell();
      else showReception();
    }
  };

  function setVisible(selector, visible) {
    var elements = doc.querySelectorAll(selector);
    Array.prototype.forEach.call(elements, function (element) {
      element.style.visibility = visible ? '' : 'hidden';
      element.style.display = visible ? '' : 'none';
      element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function notifyDoctorShell(visible) {
    if (!doc.dispatchEvent || !root.CustomEvent) return;
    doc.dispatchEvent(new root.CustomEvent('clinic:doctor-shell', { detail: { visible: !!visible } }));
  }

  function hideDoctorViews() {
    Array.prototype.forEach.call(doc.querySelectorAll('.tab-page'), function (element) {
      element.style.display = 'none';
    });
  }

  function hideLegacyShellPages() {
    ['.page-wrapper', '#financeView', '#expensesView', '#reportView', '#appointmentsView', '#settingsView'].forEach(function (selector) {
      var element = doc.querySelector(selector);
      if (element) element.style.display = 'none';
    });
  }

  function updateDoctorToolbar(view) {
    var prescriptionOpen = view === 'prescription';
    Array.prototype.forEach.call(doc.querySelectorAll('.control-panel [data-toolbar-context]'), function (control) {
      var context = control.getAttribute('data-toolbar-context');
      var visible = context === 'global' || (context === 'prescription-only' && prescriptionOpen);
      control.hidden = !visible;
      control.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
  }

  function showDoctorShell() {
    stopCollectionPolling();
    applyWorkspaceDensity();
    resetAutoLockTimer();
    setVisible('.control-panel, #topNav, .page-wrapper', true);
    notifyDoctorShell(true);
    var reception = doc.getElementById('receptionView');
    var home = doc.getElementById('homeView');
    if (reception) reception.hidden = true;
    if (home) home.hidden = false;
    var modal = doc.getElementById('doctorLoginModal');
    if (modal) modal.hidden = true;
  }

  function showReception() {
    clearAutoLockTimer();
    setVisible('.control-panel, #topNav, .page-wrapper', false);
    notifyDoctorShell(false);
    hideLegacyShellPages();
    hideDoctorViews();
    var reception = doc.getElementById('receptionView');
    var home = doc.getElementById('homeView');
    if (reception) reception.hidden = false;
    if (home) home.hidden = true;
    renderReception();
  }

  function getQrPreference() {
    var store = getStorage('localStorage');
    try { return !!(store && store.getItem('showQR') === '1'); } catch (e) { return false; }
  }

  function setQrPreference(enabled) {
    var checked = !!enabled;
    var prescriptionQr = doc.getElementById('showQR');
    if (prescriptionQr) prescriptionQr.checked = checked;
    if (typeof root.toggleQR === 'function' && prescriptionQr) root.toggleQR(prescriptionQr);
    else {
      var store = getStorage('localStorage');
      try { if (store) store.setItem('showQR', checked ? '1' : '0'); } catch (e) { /* local-only fallback */ }
    }
  }

  function syncSummary() {
    var financeStore = root.FinanceStore;
    if (!financeStore || typeof financeStore.getSyncStatus !== 'function') return 'Local-only mode. Download a backup before moving to another device.';
    var status = financeStore.getSyncStatus() || {};
    var pending = Number(status.pendingCount) || 0;
    var errors = Number(status.errorCount) || 0;
    if (status.status === 'error' || status.status === 'sync_error' || errors > 0) return 'Sync needs attention. Review pending records before closing the app.';
    if (status.status === 'syncing') return 'Syncing ' + pending + ' change' + (pending === 1 ? '.' : 's.');
    if (pending > 0 || status.status === 'offline') return pending + ' change' + (pending === 1 ? '' : 's') + ' waiting to sync.';
    return 'All local changes are synced.';
  }

  function settingsRupee(value) {
    return '₹' + (Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function whatsappRecords() {
    var local = storeApi.read();
    var cloud = Array.isArray(root._sheetRecordsCache) ? root._sheetRecordsCache : [];
    return local.concat(cloud);
  }

  function renderWhatsAppSummary() {
    var summary = doc.getElementById('trSettingsWhatsAppSummary');
    if (!summary || !root.WhatsAppMessaging) return;
    var result = root.WhatsAppMessaging.buildRecipients(whatsappRecords(), { requireOptIn: true });
    summary.textContent = result.counts.eligible + ' eligible · ' + result.counts.unknown + ' need consent · ' + result.counts.missing + ' missing or invalid number';
  }

  function startWhatsAppReview() {
    var review = doc.getElementById('trWhatsAppReview');
    var status = doc.getElementById('trSettingsWhatsAppStatus');
    if (!review || !root.WhatsAppMessaging) return;
    var preferences = getSettingsPreferences();
    var recipients = root.WhatsAppMessaging.buildRecipients(whatsappRecords(), { requireOptIn: true }).eligible;
    if (!recipients.length) {
      review.hidden = false;
      review.innerHTML = '<p class="tr-empty">No opted-in patients with valid mobile numbers are ready for review.</p>';
      if (status) status.textContent = 'Mark patient WhatsApp consent as Yes before starting a review.';
      return;
    }
    review.hidden = false;
    var index = 0;
    function renderNext() {
      if (index >= recipients.length) {
        review.innerHTML = '<p class="tr-empty">Review complete. No messages were sent automatically.</p>';
        if (status) status.textContent = 'WhatsApp review complete for ' + recipients.length + ' patient' + (recipients.length === 1 ? '' : 's') + '.';
        return;
      }
      var recipient = recipients[index];
      var message = root.WhatsAppMessaging.renderMessage(preferences.whatsappTemplate, { name: recipient.name, clinic: preferences.whatsappClinicName }, preferences.whatsappSignature);
      review.innerHTML = '<div class="tr-whatsapp-review-head"><strong>Review ' + (index + 1) + ' of ' + recipients.length + '</strong><span>' + escapeHtml(recipient.name) + ' · ' + escapeHtml(recipient.phone) + '</span></div><pre class="tr-whatsapp-preview">' + escapeHtml(message) + '</pre><button class="tr-primary" type="button" data-wa-review-send>Open WhatsApp draft</button>';
      var send = review.querySelector('[data-wa-review-send]');
      if (send) send.addEventListener('click', function () {
        send.disabled = true;
        if (typeof root.confirm === 'function' && !root.confirm('Open the WhatsApp draft for ' + recipient.name + '?')) {
          send.disabled = false;
          return;
        }
        var url = root.WhatsAppMessaging.buildDraftUrl(recipient.phone, message);
        if (url && typeof root.open === 'function') root.open(url, '_blank', 'noopener');
        index += 1;
        renderNext();
      });
    }
    renderNext();
  }

  function settingsSectionSummary(section, preferences) {
    if (section === 'workspace') return preferences.density === 'compact' ? 'Compact layout' : 'Comfortable layout';
    if (section === 'new-patient') return 'Reception setup';
    if (section === 'prescription') return getQrPreference() ? 'QR code shown' : 'QR code hidden';
    if (section === 'data') return syncSummary();
    if (section === 'security') return preferences.autoLockMinutes ? 'Locks after ' + preferences.autoLockMinutes + ' minutes' : 'Auto-lock off';
    if (section === 'whatsapp') return preferences.whatsappSignature ? 'Review before sending' : 'Draft review required';
    return '';
  }

  function updateSettingsSectionState() {
    Array.prototype.forEach.call(doc.querySelectorAll('[data-settings-section]'), function (button) {
      var isOpen = button.getAttribute('data-settings-section') === activeSettingsSection;
      var panel = doc.getElementById(button.getAttribute('aria-controls'));
      var card = button.closest('.tr-settings-disclosure');
      button.setAttribute('aria-expanded', String(isOpen));
      if (panel) panel.hidden = !isOpen;
      if (card) card.classList.toggle('is-open', isOpen);
    });
  }

  function setActiveSettingsSection(section) {
    activeSettingsSection = activeSettingsSection === section ? '' : section;
    updateSettingsSectionState();
  }

  function buildSettingsDisclosure(section, kicker, title, summaryId, content) {
    var titleId = 'trSettings' + section.replace(/(^|-)([a-z])/g, function (_, __, letter) { return letter.toUpperCase(); }) + 'Toggle';
    var panelId = 'trSettings' + section.replace(/(^|-)([a-z])/g, function (_, __, letter) { return letter.toUpperCase(); }) + 'Panel';
    return '<section class="tr-settings-disclosure tr-settings-disclosure--' + section + '" data-settings-card="' + section + '">' +
      '<h2 class="tr-settings-disclosure-title"><button id="' + titleId + '" class="tr-settings-disclosure-button" type="button" data-settings-section="' + section + '" aria-expanded="false" aria-controls="' + panelId + '">' +
        '<span><span class="tr-eyebrow">' + kicker + '</span><strong>' + title + '</strong><small id="' + summaryId + '"></small></span><span class="tr-settings-chevron" aria-hidden="true">›</span>' +
      '</button></h2>' +
      '<div class="tr-settings-panel" id="' + panelId + '" data-settings-panel="' + section + '" role="region" aria-labelledby="' + titleId + '" hidden>' + content + '</div>' +
    '</section>';
  }

  function buildSettingsMarkup() {
    var workspace = '<p class="tr-settings-help">Choose the amount of space used by the Doctor workspace navigation.</p><label class="tr-settings-field">Workspace density<select id="trSettingsDensity"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label><div class="tr-form-actions"><button class="tr-primary" type="button" data-settings-save>Save workspace</button></div><p class="tr-status" id="trSettingsWorkspaceStatus" role="status" aria-live="polite"></p>';
    var newPatient = '<p class="tr-settings-help">Reception records patient identity and WhatsApp consent. Fees are managed in the Doctor billing workspace.</p><p class="tr-settings-note">Existing finance history is preserved.</p>';
    var prescription = '<p class="tr-settings-help">Choose whether new prescriptions show the clinic QR code. Existing saved prescriptions are not changed.</p><label class="tr-settings-check"><input id="trSettingsQR" type="checkbox"> Show QR code on prescriptions</label><p class="tr-settings-note">This preference is applied immediately and is saved on this clinic device.</p>';
    var data = '<p class="tr-settings-help" id="trSettingsSync" role="status" aria-live="polite"></p><button class="tr-secondary" id="trSettingsBackup" type="button">Download local CSV backup</button><p class="tr-settings-note">Downloads locally saved patient records only. It does not delete or overwrite anything.</p>';
    var security = '<p class="tr-settings-help">Lock the Doctor workspace after inactivity and return safely to Reception.</p><label class="tr-settings-field">Lock after inactivity<select id="trSettingsAutoLock"><option value="0">Never</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label><div class="tr-form-actions"><button class="tr-primary" type="button" data-settings-save>Save security setting</button></div><p class="tr-status" id="trSettingsStatus" role="status" aria-live="polite"></p><div class="tr-settings-subsection"><span class="tr-eyebrow">DOCTOR LOGIN</span><h3>Change password</h3><p class="tr-settings-help">Enter your current password, then choose a new password. Passwords are stored only as secure hashes; the plain password is never saved.</p><form id="trPasswordForm" class="tr-settings-form" autocomplete="off"><label>Current password<input id="trCurrentPassword" type="password" autocomplete="current-password" required></label><label>New password<input id="trNewPassword" type="password" autocomplete="new-password" minlength="4" required></label><label>Confirm new password<input id="trConfirmPassword" type="password" autocomplete="new-password" minlength="4" required></label><div class="tr-form-actions"><button class="tr-primary" type="submit">Update Password</button><button class="tr-secondary" id="trPasswordClear" type="button">Clear</button></div><p class="tr-status" id="trPasswordStatus" role="status" aria-live="polite"></p></form></div>';
    var whatsapp = '<p class="tr-settings-help">Create a personal message and review each WhatsApp draft before it opens. Only patients marked as opted in are included.</p><div class="tr-settings-field-grid"><label class="tr-settings-field">Clinic name<input id="trSettingsWhatsAppClinic" type="text" maxlength="80" autocomplete="organization"></label><label class="tr-settings-field">Signature<input id="trSettingsWhatsAppSignature" type="text" maxlength="80"></label></div><label class="tr-settings-field">Message template<textarea id="trSettingsWhatsAppTemplate" rows="4" maxlength="800" placeholder="Hello {name}, …"></textarea></label><p class="tr-settings-note">Use {name} and {clinic}. Sending is manual and one patient at a time; WhatsApp availability cannot be checked from a draft link.</p><div class="tr-whatsapp-summary" id="trSettingsWhatsAppSummary" role="status" aria-live="polite"></div><div class="tr-form-actions"><button class="tr-primary" id="trSettingsWhatsAppSave" type="button">Save WhatsApp settings</button><button class="tr-secondary" id="trSettingsWhatsAppStart" type="button">Review bulk message</button></div><p class="tr-status" id="trSettingsWhatsAppStatus" role="status" aria-live="polite"></p><div class="tr-whatsapp-review" id="trWhatsAppReview" hidden></div>';
    return '<div class="tr-shell tr-settings-workspace"><div class="tr-brand tr-settings-heading"><div><span class="tr-kicker">DOCTOR CONTROL CENTRE</span><h1>Settings</h1><p>Manage this clinic device, new-visit defaults, data safety, and doctor access.</p></div><button class="tr-secondary" id="trSettingsBack" type="button">Back to Home</button></div><div class="tr-settings-list">' +
      buildSettingsDisclosure('workspace', 'WORKSPACE', 'Workspace', 'trSettingsWorkspaceSummary', workspace) +
      buildSettingsDisclosure('new-patient', 'NEW PATIENT DEFAULTS', 'New patient defaults', 'trSettingsNewPatientSummary', newPatient) +
      buildSettingsDisclosure('prescription', 'PRESCRIPTION DISPLAY', 'Prescription display', 'trSettingsPrescriptionSummary', prescription) +
      buildSettingsDisclosure('data', 'DATA & BACKUP', 'Data & backup', 'trSettingsDataSummary', data) +
      buildSettingsDisclosure('security', 'SECURITY', 'Security', 'trSettingsSecuritySummary', security) +
      buildSettingsDisclosure('whatsapp', 'WHATSAPP MESSAGING', 'WhatsApp messaging', 'trSettingsWhatsappSummary', whatsapp) +
    '</div></div>';
  }

  function renderSettings() {
    var preferences = getSettingsPreferences();
    var density = doc.getElementById('trSettingsDensity');
    var autoLock = doc.getElementById('trSettingsAutoLock');
    var qr = doc.getElementById('trSettingsQR');
    var sync = doc.getElementById('trSettingsSync');
    if (density) density.value = preferences.density;
    if (autoLock) autoLock.value = String(preferences.autoLockMinutes);
    if (qr) qr.checked = getQrPreference();
    if (sync) sync.textContent = syncSummary();
    var waClinic = doc.getElementById('trSettingsWhatsAppClinic');
    var waTemplate = doc.getElementById('trSettingsWhatsAppTemplate');
    var waSignature = doc.getElementById('trSettingsWhatsAppSignature');
    if (waClinic) waClinic.value = preferences.whatsappClinicName;
    if (waTemplate) waTemplate.value = preferences.whatsappTemplate;
    if (waSignature) waSignature.value = preferences.whatsappSignature;
    renderWhatsAppSummary();
    ['workspace', 'new-patient', 'prescription', 'data', 'security', 'whatsapp'].forEach(function (section) {
      var summary = doc.getElementById('trSettings' + section.replace(/(^|-)([a-z])/g, function (_, __, letter) { return letter.toUpperCase(); }) + 'Summary');
      if (summary) summary.textContent = settingsSectionSummary(section, preferences);
    });
    updateSettingsSectionState();
  }

  function saveSettingsFromForm() {
    var preferences = saveSettingsPreferences({
      density: doc.getElementById('trSettingsDensity').value,
      autoLockMinutes: doc.getElementById('trSettingsAutoLock').value,
      whatsappClinicName: (doc.getElementById('trSettingsWhatsAppClinic') || {}).value,
      whatsappTemplate: (doc.getElementById('trSettingsWhatsAppTemplate') || {}).value,
      whatsappSignature: (doc.getElementById('trSettingsWhatsAppSignature') || {}).value
    });
    var status = doc.getElementById('trSettingsStatus');
    if (status) status.textContent = 'Settings saved for this device.';
    renderSettings();
    normalizeVisibleCopy();
    return preferences;
  }

  function activeNav(view) {
    Array.prototype.forEach.call(doc.querySelectorAll('.nav-tab[data-view]'), function (button) {
      button.classList.toggle('active', button.getAttribute('data-view') === view);
    });
  }

  function buildMarkup() {
    if (markupReady) return;
    var reception = doc.getElementById('receptionView');
    var home = doc.getElementById('homeView');
    var modal = doc.getElementById('doctorLoginModal');
    if (!reception || !home || !modal) return;
    reception.innerHTML =
      '<div class="tr-shell tr-reception-workspace">' +
        '<div class="tr-brand tr-reception-top"><div><span class="tr-kicker">CLINIC RECEPTION</span><h1>Clinic Reception</h1><p>Front desk — patient registration</p></div><button class="tr-secondary" id="trDoctorLogin" type="button">Doctor Login <span aria-hidden="true">→</span></button></div>' +
        '<div class="tr-reception-grid">' +
          '<form class="tr-card tr-form tr-reception-form-card" id="trReceptionForm">' +
            '<div class="tr-card-heading"><div><span class="tr-eyebrow">REGISTER / UPDATE PATIENT</span><h2 id="trRcFormTitle">Add patient</h2></div><span class="tr-badge">Today</span></div>' +
            '<div class="tr-field-grid tr-patient-grid"><label>Patient name<input id="trRcName" required autocomplete="name" placeholder="Full name"></label><label>Age<input id="trRcAge" type="number" min="0" max="120"></label><label>Gender<select id="trRcGender"><option value="M">Male</option><option value="F">Female</option></select></label></div>' +
            '<label>Address<input id="trRcAddress" autocomplete="street-address" placeholder="Address"></label>' +
            '<div class="tr-two-col"><label>Mobile number<input id="trRcPhone" type="tel" maxlength="15" autocomplete="tel" placeholder="Mobile"></label><label>WhatsApp updates<select id="trRcWhatsappOptIn"><option value="unknown">Unknown</option><option value="yes">Yes — patient opted in</option><option value="no">No — do not message</option></select></label></div>' +
            '<div class="tr-form-actions"><button class="tr-primary" id="trRcSubmit" type="submit">Save Patient</button><button class="tr-secondary" id="trRcClear" type="button">Clear</button></div><p class="tr-status" id="trRcStatus" role="status" aria-live="polite"></p>' +
          '</form>' +
          '<section class="tr-card tr-list-card tr-reception-list-card" aria-labelledby="trReceptionListTitle"><div class="tr-card-heading"><div><span class="tr-eyebrow">REGISTERED PATIENTS</span><h2 id="trReceptionListTitle">Patients</h2></div><span class="tr-count" id="trRcCount">0</span></div><div class="tr-reception-filters"><label>Show day<input id="trRcDate" type="date"></label><button class="tr-secondary tr-today" id="trRcToday" type="button">Today</button><label class="tr-search tr-day-search"><span aria-hidden="true">⌕</span><span class="sr-only">Search this day</span><input id="trRcSearch" type="search" placeholder="Name or mobile…" autocomplete="off"></label></div><p class="tr-list-summary" id="trRcSummary" role="status" aria-live="polite"></p><div id="trRcList" class="tr-list tr-reception-table"></div></section>' +
        '</div>' +
        '<section class="tr-card tr-collection-panel" id="trCollectionPanel" aria-labelledby="trCollectionTitle"><div class="tr-card-heading"><div><span class="tr-eyebrow">DOCTOR REQUESTS</span><h2 id="trCollectionTitle">Collect at reception</h2></div><div class="tr-collection-heading-actions"><button class="tr-secondary tr-collection-refresh" id="trCollectionRefresh" type="button" aria-label="Refresh doctor collection requests">Refresh</button><span class="tr-count tr-collection-count" id="trCollectionCount">0</span></div></div><p class="tr-collection-alert" id="trCollectionAlert" role="status" aria-live="polite"></p><div id="trCollectionList" class="tr-collection-list"></div></section>' +
      '</div>';
    home.innerHTML =
      '<div class="tr-home-shell tr-home-workspace" id="trHomeWorkspace"><div class="tr-home-heading tr-home-queue-heading"><div class="tr-home-title-block"><h1>Patient Queue <span>— Today</span></h1><p class="tr-home-summary" id="trHomeSummary">0 waiting · 0 completed. | Today</p></div><button class="tr-secondary" id="trHomeLogout" type="button">Logout</button></div>' +
      '<div class="tr-stat-row tr-home-stats tr-home-counts"><div class="tr-stat tr-waiting"><span>Waiting</span><strong id="trHomeWaiting">0</strong><small>patients in queue</small></div><div class="tr-stat tr-completed"><span>Completed</span><strong id="trHomeCompleted">0</strong><small>finished today</small></div></div>' +
      '<div class="tr-home-toolbar tr-home-search-row"><label class="tr-search"><span aria-hidden="true">⌕</span><span class="sr-only">Search patient name or mobile</span><input id="trHomeSearch" type="search" placeholder="Search patient name or mobile…" autocomplete="off"></label><button class="tr-secondary tr-previous" id="trHomePreviousPatients" type="button">Previous Patients</button></div>' +
      '<div id="trHomeCards" class="tr-queue-grid"></div></div>';
    var settings = doc.getElementById('settingsView');
    if (settings) settings.innerHTML = buildSettingsMarkup();
    modal.innerHTML =
      '<div class="tr-modal-backdrop"><form class="tr-modal" id="trLoginForm" role="dialog" aria-modal="true" aria-labelledby="trLoginTitle"><button class="tr-modal-close" id="trLoginClose" type="button" aria-label="Close">×</button><span class="tr-eyebrow">SECURE ACCESS</span><h2 id="trLoginTitle">Doctor Login</h2><p id="trLoginIntro"></p><label>Password<input id="trLoginPassword" type="password" autocomplete="current-password" required></label><label id="trPinRow">Recovery PIN<input id="trLoginPin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" autocomplete="off"></label><label id="trConfirmRow">Confirm password<input id="trLoginConfirm" type="password" autocomplete="new-password"></label><button class="tr-primary" id="trLoginSubmit" type="submit">Continue</button><p class="tr-status" id="trLoginStatus" role="status" aria-live="polite"></p></form></div>';

    doc.getElementById('trReceptionForm').addEventListener('submit', function (event) {
      event.preventDefault();
      var input = {
        name: doc.getElementById('trRcName').value,
        age: doc.getElementById('trRcAge').value,
        gender: doc.getElementById('trRcGender').value,
        address: doc.getElementById('trRcAddress').value,
        phone: doc.getElementById('trRcPhone').value,
        whatsappOptIn: doc.getElementById('trRcWhatsappOptIn').value
      };
      if (!text(input.name)) {
        doc.getElementById('trRcStatus').textContent = 'Patient name is required.';
        return;
      }
      var record = editingReceptionId ? storeApi.updatePatient(editingReceptionId, input, new Date()) : storeApi.createPatient(input, new Date());
      doc.getElementById('trRcStatus').textContent = 'Patient added locally. Syncing when available…';
      renderReception();
      sync(record).then(function (result) {
        var status = doc.getElementById('trRcStatus');
        if (status) status.textContent = result.status === 'cloud' ? 'Patient saved and synced.' : 'Patient saved locally.';
      });
      clearReceptionForm();
    });
    doc.getElementById('trRcSearch').addEventListener('input', renderReceptionList);
    doc.getElementById('trRcDate').addEventListener('change', function (event) {
      receptionDate = event.target.value || istDate(new Date());
      renderReceptionList();
    });
    doc.getElementById('trRcToday').addEventListener('click', function () {
      receptionDate = istDate(new Date());
      doc.getElementById('trRcDate').value = receptionDate;
      renderReceptionList();
    });
    doc.getElementById('trRcClear').addEventListener('click', clearReceptionForm);
    doc.getElementById('trRcList').addEventListener('click', handleReceptionAction);
    doc.getElementById('trCollectionList').addEventListener('click', handleCollectionAction);
    doc.getElementById('trCollectionRefresh').addEventListener('click', function () {
      var button = doc.getElementById('trCollectionRefresh');
      if (!button || button.disabled) return;
      button.disabled = true;
      button.textContent = 'Refreshing…';
      renderCollectionTasks('Refreshing doctor collection requests…');
      refreshCollectionTasks().finally(function () {
        button.disabled = false;
        button.textContent = 'Refresh';
      });
    });
    doc.getElementById('trHomeSearch').addEventListener('input', renderHomeCards);
    doc.getElementById('trHomePreviousPatients').addEventListener('click', togglePreviousHomePatients);
    doc.getElementById('trDoctorLogin').addEventListener('click', openLogin);
    doc.getElementById('trHomeLogout').addEventListener('click', authApi.logout);
    doc.getElementById('trSettingsBack').addEventListener('click', function () { root.switchView('home'); });
    doc.getElementById('trPasswordClear').addEventListener('click', function () {
      doc.getElementById('trPasswordForm').reset();
      doc.getElementById('trPasswordStatus').textContent = '';
    });
    doc.getElementById('trPasswordForm').addEventListener('submit', submitPasswordChange);
    Array.prototype.forEach.call(doc.querySelectorAll('[data-settings-section]'), function (button) {
      button.addEventListener('click', function () { setActiveSettingsSection(button.getAttribute('data-settings-section')); });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('[data-settings-save]'), function (button) {
      button.addEventListener('click', saveSettingsFromForm);
    });
    doc.getElementById('trSettingsQR').addEventListener('change', function (event) {
      setQrPreference(event.target.checked);
      renderSettings();
    });
    doc.getElementById('trSettingsWhatsAppSave').addEventListener('click', function () {
      saveSettingsFromForm();
      var status = doc.getElementById('trSettingsWhatsAppStatus');
      if (status) status.textContent = 'WhatsApp settings saved on this device.';
    });
    doc.getElementById('trSettingsWhatsAppStart').addEventListener('click', startWhatsAppReview);
    doc.getElementById('trSettingsBackup').addEventListener('click', function () {
      var status = doc.getElementById('trSettingsSync');
      var summary = doc.getElementById('trSettingsDataSummary');
      if (typeof root.exportSavedCSV !== 'function') {
        if (status) status.textContent = 'Local backup is unavailable in this browser.';
        if (summary) summary.textContent = 'Backup unavailable';
        return;
      }
      root.exportSavedCSV();
      if (status) status.textContent = 'Local CSV backup download started.';
      if (summary) summary.textContent = 'Backup download started';
    });
    doc.getElementById('trLoginClose').addEventListener('click', closeLogin);
    doc.getElementById('trLoginForm').addEventListener('submit', submitLogin);
    doc.getElementById('trHomeCards').addEventListener('click', function (event) {
      var button = event.target.closest('button[data-action]');
      if (!button) return;
      var id = button.getAttribute('data-id');
      if (button.getAttribute('data-action') === 'prescription') openPrescription(id);
      if (button.getAttribute('data-action') === 'remove') removeFromQueue(id);
    });
    doc.addEventListener('pointerdown', resetAutoLockTimer, true);
    doc.addEventListener('keydown', resetAutoLockTimer, true);
    receptionDate = receptionDate || istDate(new Date());
    doc.getElementById('trRcDate').value = receptionDate;
    markupReady = true;
    clearReceptionForm();
    renderSettings();
    normalizeVisibleCopy();
  }

  function formatReceptionDate(value) {
    var parts = text(value).split('-');
    if (parts.length !== 3) return text(value);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Number(parts[2]) + ' ' + (months[Number(parts[1]) - 1] || parts[1]) + ' ' + parts[0];
  }

  function clearReceptionForm() {
    var form = doc.getElementById('trReceptionForm');
    if (form) form.reset();
    editingReceptionId = '';
    var title = doc.getElementById('trRcFormTitle');
    var submit = doc.getElementById('trRcSubmit');
    if (title) title.textContent = 'Add patient';
    if (submit) submit.textContent = 'Save Patient';
  }

  function beginReceptionEdit(id) {
    var record = storeApi.findPatient(id);
    if (!record) return;
    editingReceptionId = id;
    var values = { Name: record.name, Age: record.age, Gender: record.gender, Address: record.address, Phone: record.phone, WhatsappOptIn: record.whatsappOptIn || 'unknown' };
    Object.keys(values).forEach(function (field) {
      var input = doc.getElementById('trRc' + field);
      if (input) input.value = values[field] == null ? '' : values[field];
    });
    var title = doc.getElementById('trRcFormTitle');
    var submit = doc.getElementById('trRcSubmit');
    if (title) title.textContent = 'Update patient';
    if (submit) submit.textContent = 'Update Patient';
    var name = doc.getElementById('trRcName');
    if (name) name.focus();
  }

  function deleteReceptionPatient(id) {
    var record = storeApi.findPatient(id);
    if (!record) return Promise.resolve(null);
    if (typeof root.confirm === 'function' && !root.confirm('Permanently delete ' + record.name + ' from Reception?')) return Promise.resolve(record);
    var removed = storeApi.deletePatient(id);
    renderReceptionList();
    return syncDelete(removed);
  }

  function markReceptionDone(id) {
    var record = storeApi.completePatient(id, new Date());
    if (!record) return Promise.resolve(null);
    renderReceptionList();
    return sync(record);
  }

  function handleReceptionAction(event) {
    var button = event.target.closest('button[data-action]');
    if (!button) return;
    var id = button.getAttribute('data-id');
    var action = button.getAttribute('data-action');
    if (action === 'edit') beginReceptionEdit(id);
    if (action === 'delete') deleteReceptionPatient(id);
    if (action === 'done') markReceptionDone(id);
  }

  function renderReceptionList() {
    var list = doc.getElementById('trRcList');
    if (!list) return;
    var date = receptionDate || istDate(new Date());
    var dateInput = doc.getElementById('trRcDate');
    if (dateInput && dateInput.value !== date) dateInput.value = date;
    var records = storeApi.listPatients(date);
    var query = doc.getElementById('trRcSearch');
    records = storeApi.search(records, query && query.value);
    var count = doc.getElementById('trRcCount');
    if (count) count.textContent = String(records.length);
    var summary = doc.getElementById('trRcSummary');
    if (summary) summary.innerHTML = 'Showing <strong>' + records.length + '</strong> patients for <strong>' + escapeHtml(formatReceptionDate(date)) + '</strong>';
    list.innerHTML = records.length ? '<div class="tr-list-header" aria-hidden="true"><span>#</span><span>Patient</span><span>WhatsApp</span><span>Status</span><span>Actions</span></div>' + records.map(function (record) {
      var completed = record.workflowStatus === 'finalized' || record.receptionDone;
      var optIn = String(record.whatsappOptIn || 'unknown').toLowerCase();
      var optInLabel = optIn === 'yes' ? 'Opted in' : optIn === 'no' ? 'Opted out' : 'Unknown';
      return '<div class="tr-list-row ' + (completed ? 'is-complete' : '') + '"><div class="tr-list-index">' + escapeHtml(String(records.indexOf(record) + 1)) + '</div><div class="tr-list-main"><strong>' + escapeHtml(record.name) + '</strong><span>' + escapeHtml(record.age || '—') + ' / ' + escapeHtml(record.gender || '—') + ' · ' + escapeHtml(record.phone || 'No mobile') + '</span><small>' + escapeHtml(record.address || 'No address') + '</small></div><div class="tr-list-whatsapp">' + escapeHtml(optInLabel) + '</div><em class="tr-status-pill ' + (completed ? 'is-complete' : '') + '">' + (completed ? 'Completed' : 'Waiting') + '</em><div class="tr-list-actions"><button class="tr-action tr-edit" type="button" data-action="edit" data-id="' + escapeHtml(record.id) + '">Edit</button><button class="tr-action tr-delete" type="button" data-action="delete" data-id="' + escapeHtml(record.id) + '">Delete</button>' + (completed ? '' : '<button class="tr-primary tr-action" type="button" data-action="done" data-id="' + escapeHtml(record.id) + '">Mark as done</button>') + '</div></div>';
    }).join('') : '<div class="tr-empty">No patients registered for this day.</div>';
    normalizeVisibleCopy();
  }

  function renderReception() {
    buildMarkup();
    renderReceptionList();
    renderCollectionTasks();
    refreshCollectionTasks();
    startCollectionPolling();
  }

  function collectionTasks() {
    if (!root.FinanceStore || !root.FinanceStore.getReceptionCache) return [];
    var cache = root.FinanceStore.getReceptionCache() || {};
    return (cache.collectionTasks || []).filter(function (task) {
      return task && String(task.status || '').toUpperCase() !== 'VOID' && Number(task.remainingAmount) > 0;
    }).sort(function (a, b) { return String(a.requestedAt || '').localeCompare(String(b.requestedAt || '')); });
  }

  function renderCollectionTasks(message) {
    var list = doc.getElementById('trCollectionList');
    var count = doc.getElementById('trCollectionCount');
    var alert = doc.getElementById('trCollectionAlert');
    if (!list) return;
    var tasks = collectionTasks();
    if (count) count.textContent = String(tasks.length);
    if (alert) alert.textContent = message || (tasks.length ? tasks.length + ' patient' + (tasks.length === 1 ? '' : 's') + ' waiting for collection.' : 'No collection requests waiting.');
    list.innerHTML = tasks.length ? tasks.map(function (task) {
      var remaining = Number(task.remainingAmount) || 0;
      return '<article class="tr-collection-row"><div class="tr-collection-main"><strong>' + escapeHtml(task.patientName) + '</strong><span>' + escapeHtml(task.phone || 'No mobile') + '</span><small>Requested ' + escapeHtml(String(task.requestedAmount || 0)) + ' · Remaining ' + escapeHtml(String(remaining)) + '</small></div><div class="tr-collection-amount">₹' + escapeHtml(String(remaining)) + '</div><div class="tr-collection-action"><label>Received now<input class="tr-collection-input" data-collection-input="' + escapeHtml(task.taskId) + '" type="number" min="0.01" max="' + escapeHtml(String(remaining)) + '" step="0.01" value="' + escapeHtml(String(remaining)) + '"></label><label>Payment mode<select class="tr-collection-mode" data-collection-mode="' + escapeHtml(task.taskId) + '"><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option><option value="BANK">Bank</option><option value="OTHER">Other</option></select></label><button class="tr-primary" type="button" data-collection-action="collect" data-id="' + escapeHtml(task.taskId) + '">Record collection</button></div></article>';
    }).join('') : '<div class="tr-empty">No doctor collection requests are waiting.</div>';
  }

  function refreshCollectionTasks() {
    if (!root.FinanceStore || !root.FinanceStore.refreshReceptionDay) return Promise.resolve(null);
    return root.FinanceStore.refreshReceptionDay(receptionDate || istDate(new Date())).then(function (result) {
      renderCollectionTasks();
      return result;
    }).catch(function () {
      renderCollectionTasks('Showing locally saved collection requests.');
      return null;
    });
  }

  function startCollectionPolling() {
    if (collectionPollTimer || !root.FinanceStore) return;
    collectionPollTimer = setInterval(function () { refreshCollectionTasks(); }, 2000);
    if (collectionPollTimer && typeof collectionPollTimer.unref === 'function') collectionPollTimer.unref();
  }

  function stopCollectionPolling() {
    if (!collectionPollTimer) return;
    root.clearInterval(collectionPollTimer);
    collectionPollTimer = null;
  }

  function handleCollectionAction(event) {
    var button = event.target.closest('button[data-collection-action]');
    if (!button || button.getAttribute('data-collection-action') !== 'collect') return;
    var taskId = button.getAttribute('data-id');
    var task = collectionTasks().find(function (item) { return item.taskId === taskId; });
    if (!task || !root.FinanceStore) return;
    var input = doc.querySelector('[data-collection-input="' + taskId.replace(/"/g, '\\"') + '"]');
    var modeInput = doc.querySelector('[data-collection-mode="' + taskId.replace(/"/g, '\\"') + '"]');
    var amount = Number(input && input.value);
    var remaining = Number(task.remainingAmount) || 0;
    if (!isFinite(amount) || amount <= 0 || amount > remaining + 0.01) {
      renderCollectionTasks('Enter an amount between ₹0.01 and ₹' + remaining + '.');
      return;
    }
    var cache = root.FinanceStore.getReceptionCache() || {};
    var bill = (cache.bills || []).find(function (item) { return item.billId === task.billId; });
    if (!bill) { renderCollectionTasks('The bill is still syncing. Please try again in a moment.'); return; }
    var payments = (cache.payments || []).filter(function (payment) { return payment.billId === task.billId; });
    var billRemaining = Math.max(0, (Number(bill.netBillAmount) || 0) - root.FinanceCore.calcNetCollected(payments));
    if (amount > billRemaining + 0.01) { renderCollectionTasks('This bill has only ₹' + billRemaining + ' outstanding.'); return; }
    var result = root.FinanceStore.recordPayment({
      paymentId: root.FinanceCore.genPaymentId(), billId: task.billId,
      visitId: task.visitId || bill.visitId || '', patientId: task.patientId || bill.patientId || '',
      paymentDate: new Date().toISOString(), amount: amount, paymentMode: (modeInput && modeInput.value) || 'CASH',
      transactionType: 'PAYMENT', note: 'Collected at reception for doctor request'
    });
    if (result && result.errors) { renderCollectionTasks(result.errors.join(' ')); return; }
    var collected = root.FinanceCore.round2((Number(task.collectedAmount) || 0) + amount);
    var taskRemaining = root.FinanceCore.round2(Math.max(0, (Number(task.requestedAmount) || 0) - collected));
    root.FinanceStore.updateCollectionTask(Object.assign({}, task, {
      collectedAmount: collected,
      remainingAmount: taskRemaining,
      status: taskRemaining <= 0 ? 'COLLECTED' : 'PARTIAL',
      updatedAt: new Date().toISOString()
    }));
    renderCollectionTasks(taskRemaining > 0 ? '₹' + amount + ' collected. ₹' + taskRemaining + ' remains due.' : 'Collection completed for ' + task.patientName + '.');
  }

  function renderHomeCards() {
    var list = doc.getElementById('trHomeCards');
    if (!list) return;
    var date = istDate(new Date());
    var records = homeShowsPrevious ? storeApi.read().filter(function (record) {
      return text(record.date) !== date || record.workflowStatus === 'finalized' || record.receptionDone;
    }) : storeApi.listPatients(date).filter(function (record) {
      return record.workflowStatus !== 'finalized' && !record.receptionDone;
    });
    var query = doc.getElementById('trHomeSearch');
    records = storeApi.search(records, query && query.value);
    var counts = storeApi.counts(date);
    var waiting = doc.getElementById('trHomeWaiting');
    var completed = doc.getElementById('trHomeCompleted');
    var dateLabel = doc.getElementById('trHomeDate');
    var summary = doc.getElementById('trHomeSummary');
    var previousButton = doc.getElementById('trHomePreviousPatients');
    if (waiting) waiting.textContent = String(counts.waiting);
    if (completed) completed.textContent = String(counts.completed);
    if (dateLabel) dateLabel.textContent = homeShowsPrevious ? 'Previous patients' : date;
    if (summary) summary.textContent = homeShowsPrevious ? 'Previous patients from all recorded days.' : String(counts.waiting) + ' Waiting · ' + String(counts.completed) + ' Completed. | ' + formatReceptionDate(date);
    if (previousButton) previousButton.textContent = homeShowsPrevious ? 'Today’s Queue' : 'Previous Patients';
    list.innerHTML = records.length ? records.map(function (record, index) {
      var completed = record.workflowStatus === 'finalized' || record.receptionDone;
      var dateMeta = homeShowsPrevious && record.date ? ' · ' + escapeHtml(formatReceptionDate(record.date)) : '';
      var metaParts = [];
      if (record.age) metaParts.push(escapeHtml(record.age) + ' yrs');
      if (record.gender) metaParts.push(record.gender === 'F' ? 'Female' : 'Male');
      metaParts.push(record.phone ? 'Tel ' + escapeHtml(record.phone) : 'No mobile');
      var subMeta = (record.address ? escapeHtml(record.address) : '') + dateMeta;
      var removeAction = completed ? '' : '<button class="tr-danger" type="button" data-action="remove" data-id="' + escapeHtml(record.id) + '">Remove</button>';
      return '<article class="tr-queue-card"><div class="tr-queue-accent" aria-hidden="true"></div><div class="tr-queue-body"><div class="tr-queue-number">#' + String(index + 1) + '</div><div class="tr-queue-name"><h3>' + escapeHtml(record.name) + '</h3><span class="tr-status-pill ' + (completed ? 'is-complete' : '') + '">' + (completed ? 'Completed' : 'Waiting') + '</span></div><p class="tr-queue-meta">' + metaParts.map(function (part, partIndex) { return (partIndex ? '<span class="tr-queue-separator" aria-hidden="true">|</span>' : '') + '<span>' + part + '</span>'; }).join('') + '</p>' + (subMeta ? '<p class="tr-queue-submeta">' + subMeta + '</p>' : '') + '<div class="tr-queue-actions"><button class="tr-primary tr-small" type="button" data-action="prescription" data-id="' + escapeHtml(record.id) + '">Prescription</button>' + removeAction + '</div></div></article>';
    }).join('') : '<div class="tr-empty tr-queue-empty">No waiting patients match your search.</div>';
  }

  function togglePreviousHomePatients() {
    homeShowsPrevious = !homeShowsPrevious;
    var search = doc.getElementById('trHomeSearch');
    if (search) search.value = '';
    renderHomeCards();
  }

  function renderHome() {
    buildMarkup();
    var home = doc.getElementById('homeView');
    if (home) home.hidden = false;
    homeShowsPrevious = false;
    renderHomeCards();
  }

  function openPrescription(id) {
    var record = storeApi.findPatient(id);
    if (!record) return false;
    if (typeof root.resetFormSilent === 'function') root.resetFormSilent();
    var fields = {
      patName: record.name,
      patAge: record.age,
      patGender: record.gender === 'F' ? 'F' : 'M',
      patAddress: record.address,
      patPhone: record.phone,
      patDate: record.date
    };
    Object.keys(fields).forEach(function (idKey) {
      var field = doc.getElementById(idKey);
      if (field) field.value = fields[idKey] || '';
    });
    if (typeof root.switchView === 'function') root.switchView('prescription');
    return true;
  }

  function removeFromQueue(id) {
    var record = storeApi.findPatient(id);
    if (!record) return Promise.resolve(null);
    if (typeof root.confirm === 'function' && !root.confirm('Remove ' + record.name + ' from the waiting queue?')) return Promise.resolve(record);
    var completed = storeApi.completePatient(id, new Date());
    renderHomeCards();
    return sync(completed).then(function () { return completed; });
  }

  function sync(record) {
    var config = root.CONFIG || {};
    var url = text(config.APPS_SCRIPT_URL || config.GOOGLE_SHEETS_URL || config.SHEETS_URL || config.scriptUrl);
    if (!url || !record) return Promise.resolve({ status: 'local' });
    var payload = Object.assign({ sheet: 'Reception', appWriteKey: text(config.APP_WRITE_KEY) }, record);
    return Promise.resolve().then(function () {
      return root.fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('Cloud sync failed.');
        return response.json();
      });
    }).then(function (result) {
      if (!result || !result.ok) throw new Error('Cloud sync was rejected.');
      return { status: 'cloud' };
    }).catch(function () { return { status: 'local' }; });
  }

  function syncDelete(record) {
    var config = root.CONFIG || {};
    var url = text(config.APPS_SCRIPT_URL || config.GOOGLE_SHEETS_URL || config.SHEETS_URL || config.scriptUrl);
    if (!url || !record) return Promise.resolve({ status: 'local' });
    return Promise.resolve().then(function () {
      return root.fetch(url, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ sheet: 'Reception', action: 'deleteReception', id: record.id, appWriteKey: text(config.APP_WRITE_KEY) })
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('Cloud deletion failed.');
        return response.json();
      });
    }).then(function (result) {
      if (!result || !result.ok) throw new Error('Cloud deletion was rejected.');
      return { status: 'cloud' };
    }).catch(function () { return { status: 'local' }; });
  }

  function configureLoginMode(firstUse) {
    var pinRow = doc.getElementById('trPinRow');
    var confirmRow = doc.getElementById('trConfirmRow');
    var pinInput = doc.getElementById('trLoginPin');
    var confirmInput = doc.getElementById('trLoginConfirm');
    var setupFields = [
      { row: pinRow, input: pinInput },
      { row: confirmRow, input: confirmInput }
    ];

    setupFields.forEach(function (field) {
      if (field.row) {
        field.row.hidden = !firstUse;
        field.row.setAttribute('aria-hidden', firstUse ? 'false' : 'true');
      }
      if (field.input) {
        field.input.disabled = !firstUse;
        field.input.required = firstUse;
        if (!firstUse) field.input.value = '';
      }
    });
  }

  function openLogin() {
    buildMarkup();
    var modal = doc.getElementById('doctorLoginModal');
    var firstUse = !authApi.hasCredentials();
    if (modal) modal.hidden = false;
    var intro = doc.getElementById('trLoginIntro');
    var submit = doc.getElementById('trLoginSubmit');
    if (intro) intro.textContent = firstUse ? 'Set a local password and recovery PIN for doctor access.' : 'Enter the doctor password to open the workspace.';
    configureLoginMode(firstUse);
    if (submit) submit.textContent = firstUse ? 'Set up and continue' : 'Login';
    var password = doc.getElementById('trLoginPassword');
    if (password) password.focus();
  }

  function closeLogin() {
    var modal = doc.getElementById('doctorLoginModal');
    if (modal) modal.hidden = true;
  }

  async function submitLogin(event) {
    event.preventDefault();
    var status = doc.getElementById('trLoginStatus');
    var password = doc.getElementById('trLoginPassword').value;
    try {
      if (!authApi.hasCredentials()) {
        var confirm = doc.getElementById('trLoginConfirm').value;
        var pin = doc.getElementById('trLoginPin').value;
        if (password !== confirm) throw new Error('Passwords do not match.');
        await authApi.setup(password, pin);
        configureLoginMode(false);
      }
      if (!await authApi.login(password)) throw new Error('Incorrect doctor password.');
      closeLogin();
    } catch (error) {
      if (status) status.textContent = error.message || 'Unable to login.';
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    var current = doc.getElementById('trCurrentPassword').value;
    var next = doc.getElementById('trNewPassword').value;
    var confirmNext = doc.getElementById('trConfirmPassword').value;
    var status = doc.getElementById('trPasswordStatus');
    if (next !== confirmNext) {
      if (status) status.textContent = 'New password and confirmation do not match.';
      return;
    }
    var result = await authApi.changePassword(current, next);
    if (!result.ok) {
      if (status) status.textContent = result.error;
      return;
    }
    if (status) status.textContent = 'Password updated successfully.';
    doc.getElementById('trPasswordForm').reset();
  }

  root.switchView = function (view) {
    if (view === 'reception') {
      showReception();
      return;
    }
    if (!authApi.isAuthenticated()) {
      showReception();
      openLogin();
      return;
    }
    showDoctorShell();
    updateDoctorToolbar(view);
    if (view === 'home') {
      hideLegacyShellPages();
      hideDoctorViews();
      activeNav('home');
      renderHome();
      return;
    }
    var home = doc.getElementById('homeView');
    if (home) home.hidden = true;
    if (view === 'settings') {
      hideLegacyShellPages();
      hideDoctorViews();
      var settings = doc.getElementById('settingsView');
      if (settings) { settings.hidden = false; settings.style.display = ''; }
      renderSettings();
      activeNav('settings');
      return;
    }
    var settings = doc.getElementById('settingsView');
    if (settings) settings.hidden = true;
    if (originalSwitchView) originalSwitchView(view);
    activeNav(view);
  };

  root.ClinicReceptionStore = storeApi;
  root.ClinicReceptionAuth = authApi;
  root.ClinicReception = {
    boot: function () {
      buildMarkup();
      authApi.renderAccessState();
      if (authApi.isAuthenticated()) root.switchView('home');
      else showReception();
    },
    renderReception: renderReception,
    renderHome: renderHome,
    renderSettings: renderSettings,
    openPrescription: openPrescription,
    removeFromQueue: removeFromQueue,
    sync: sync,
    syncDelete: syncDelete,
    getSettingsPreferences: getSettingsPreferences,
    saveSettingsPreferences: saveSettingsPreferences,
    capitalizeFirstWord: capitalizeFirstWord
  };

  root.ClinicReception.boot();
}(window));
