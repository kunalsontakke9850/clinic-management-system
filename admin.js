/* =========================================================
   admin.js
   Server-authenticated Admin/Doctor tools.
   Exposes: loginWithPin, logout, hasValidAdminSession,
            ensureAdminSession (legacy), openAudit, openMigration.
   ========================================================= */

(function (exports) {
  'use strict';

  /* -------------------------------------------------------
     PRIVATE HELPERS
  ------------------------------------------------------- */
  function esc_(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getModalContainer() {
    var c = document.getElementById('admin-modal-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'admin-modal-container';
      document.body.appendChild(c);
    }
    return c;
  }

  function renderModal(title, contentHtml) {
    var c = getModalContainer();
    c.innerHTML = '<div class="rx-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;">' +
      '<div class="rx-dialog" style="width:800px;max-width:95vw;max-height:90vh;display:flex;flex-direction:column;background:#fff;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.2);">' +
        '<div class="rx-dialog-header" style="display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid #cbd5e1;">' +
          '<h3 style="margin:0;font-size:18px;color:#0e6a3f;">' + esc_(title) + '</h3>' +
          '<button class="rx-btn" id="admin-modal-close" type="button" aria-label="Close admin dialog" style="background:none;border:none;font-size:24px;cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div class="rx-dialog-body" style="padding:16px;overflow-y:auto;flex:1;">' + contentHtml + '</div>' +
      '</div>' +
    '</div>';
    var closeBtn = document.getElementById('admin-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { c.innerHTML = ''; });
  }

  function configuredUrl_() {
    return window.CONFIG && window.CONFIG.GOOGLE_SHEETS_URL;
  }

  async function readJson_(response) {
    if (!response || response.ok === false) throw new Error('Admin request could not reach the server');
    var json = await response.json();
    if (!json || !json.ok) {
      throw new Error((json && (json.message || json.error || (json.errors || []).join(', '))) || 'Admin request failed');
    }
    return json;
  }

  function protectedUrl_(action, extra) {
    var user = window.FinanceStore.getCurrentUser();
    var params = Object.assign({
      action: action,
      sessionToken: user.sessionToken || ''
    }, extra || {});
    return configuredUrl_() + '?' + Object.keys(params).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    }).join('&');
  }

  /* -------------------------------------------------------
     PUBLIC AUTH PRIMITIVES (Section 5.2)
  ------------------------------------------------------- */

  /**
   * Pure boolean: is the given user object an active privileged session?
   * @param {object} user
   * @param {number} [nowMs] - override for testing
   */
  function hasValidAdminSession(user, nowMs) {
    if (!user) return false;
    if (user.role !== 'admin' && user.role !== 'doctor') return false;
    if (!user.sessionToken) return false;
    if (user.sessionExpiresAt && Number(user.sessionExpiresAt) <= (nowMs !== undefined ? nowMs : Date.now())) return false;
    return true;
  }

  /**
   * Send PIN to server, store resulting session, return user object.
   * Throws on blank PIN, server rejection, or network failure.
   * Never logs the PIN.
   */
  async function loginWithPin(pin) {
    if (!String(pin || '').trim()) throw new Error('PIN is required.');
    if (!window.FinanceStore) throw new Error('FinanceStore not available.');
    var current = window.FinanceStore.getCurrentUser();
    var result = await readJson_(await fetch(configuredUrl_(), {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'adminLogin',
        userId: (current && current.userId) || 'doctor',
        appVersion: (window.CONFIG && window.CONFIG.APP_VERSION) || '3.6.1',
        payload: { pin: String(pin) }
      })
    }));
    var user = {
      userId: result.userId || 'doctor',
      role: result.role || 'admin',
      name: result.name || 'Doctor/Admin',
      sessionToken: result.sessionToken,
      sessionExpiresAt: Date.now() + Number(result.expiresInSeconds || 21600) * 1000
    };
    window.FinanceStore.setCurrentUser(user);
    return user;
  }

  /**
   * Clears privileged session and restores receptionist identity.
   */
  function logout() {
    if (window.FinanceStore && window.FinanceStore.clearCurrentUser) {
      return window.FinanceStore.clearCurrentUser();
    }
    var receptionist = { userId: 'receptionist', role: 'receptionist', name: 'Staff' };
    if (window.FinanceStore) window.FinanceStore.setCurrentUser(receptionist);
    return receptionist;
  }

  /* -------------------------------------------------------
     LEGACY ensureAdminSession (preserved for Audit/Migration/Void)
     Refactored to reuse loginWithPin.
  ------------------------------------------------------- */
  async function ensureAdminSession() {
    if (!window.FinanceStore) return false;
    var current = window.FinanceStore.getCurrentUser();
    if (hasValidAdminSession(current)) return true;

    var pin = prompt('Enter Admin PIN:');
    if (pin === null) return false;
    if (!String(pin).trim()) { alert('Admin PIN is required.'); return false; }

    try {
      await loginWithPin(pin);
      return true;
    } catch (error) {
      alert(error.message);
      return false;
    }
  }

  /* -------------------------------------------------------
     PROTECTED ADMIN TOOLS (Audit, Migration)
  ------------------------------------------------------- */
  async function openAudit() {
    if (!await ensureAdminSession()) return;
    renderModal('Audit Log', '<div class="rx-loading">Loading audit logs from server...</div>');
    try {
      var res = await readJson_(await fetch(protectedUrl_('audit', { limit: 100 }), { method: 'GET' }));
      var rows = (res.audit || []).map(function (row) {
        var state = row.afterJson || row.after || '';
        return '<tr>' +
          '<td style="white-space:nowrap;">' + esc_(new Date(row.timestamp).toLocaleString('en-IN')) + '</td>' +
          '<td>' + esc_(row.userId) + '</td><td>' + esc_(row.entityType) + '</td>' +
          '<td>' + esc_(row.entityId) + '</td><td>' + esc_(row.action) + '</td>' +
          '<td style="font-family:monospace;font-size:10px;white-space:pre-wrap;">' + esc_(state) + '</td></tr>';
      }).join('');
      renderModal('Audit Log (Last 100)', '<table class="rx-table" style="font-size:12px;">' +
        '<thead><tr><th>Time</th><th>User</th><th>Entity</th><th>ID</th><th>Action</th><th>State</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6">No audit records found</td></tr>') + '</tbody></table>');
    } catch (error) {
      renderModal('Audit Error', '<div class="rx-empty" style="color:#b91c1c;">' + esc_(error.message) + '</div>');
    }
  }

  async function openMigration() {
    if (!await ensureAdminSession()) return;
    renderModal('Legacy Migration Tool',
      '<div style="margin-bottom:16px;">Preview and migrate legacy prescription fees into the unified Bills and Payments ledger. Existing rows are preserved.</div>' +
      '<button class="rx-btn btn-primary" id="btn-run-mig" type="button">Start Migration Preview</button>' +
      '<div id="mig-log" style="margin-top:16px;background:#1e293b;color:#a7f3d0;font-family:monospace;font-size:12px;padding:12px;min-height:200px;border-radius:4px;overflow-y:auto;max-height:400px;">Ready.</div>');
    var button = document.getElementById('btn-run-mig');
    if (button) button.addEventListener('click', runMigration);
  }

  async function runMigration() {
    if (!await ensureAdminSession()) return;
    var log = document.getElementById('mig-log');
    var button = document.getElementById('btn-run-mig');
    if (!log || !button) return;
    button.disabled = true;
    var append = function (message) {
      var line = document.createElement('div');
      line.textContent = '> ' + message;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    };

    try {
      append('Requesting migration preview...');
      var preview = await readJson_(await fetch(protectedUrl_('migrationPreview'), { method: 'GET' }));
      append('Prescription rows: ' + preview.prescriptionRowCount);
      append('Proposed conversions: ' + preview.proposedConversions);
      append('Conflicts/already migrated: ' + preview.conflictCount);
      append('Legacy billed total: \u20b9' + Number(preview.legacyBilledTotal || 0).toFixed(2));
      append('Legacy paid total: \u20b9' + Number(preview.legacyPaidTotal || 0).toFixed(2));

      var pendingRows = preview.pendingRows || [];
      if (!pendingRows.length) { append('Nothing pending migration.'); return; }
      if (!confirm('Migrate ' + pendingRows.length + ' reviewed legacy rows? A spreadsheet backup is required before continuing.')) {
        append('Commit cancelled. Preview made no changes.');
        return;
      }

      var user = window.FinanceStore.getCurrentUser();
      var created = 0, skipped = 0;
      for (var i = 0; i < pendingRows.length; i += 50) {
        var rowIndexes = pendingRows.slice(i, i + 50).map(function (row) { return row.rowIndex; });
        var result = await readJson_(await fetch(configuredUrl_(), {
          method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'commitMigration',
            operationId: window.FinanceCore.genOperationId(),
            userId: user.userId,
            role: user.role,
            sessionToken: user.sessionToken,
            appVersion: (window.CONFIG && window.CONFIG.APP_VERSION) || '3.6.1',
            appWriteKey: (window.CONFIG && window.CONFIG.APP_WRITE_KEY) || '',
            payload: { rowIndexes: rowIndexes }
          })
        }));
        created += Number(result.created) || 0;
        skipped += Number(result.skipped) || 0;
      }
      append('Migration complete. Created ' + created + '; skipped ' + skipped + '.');
    } catch (error) {
      append('ERROR: ' + error.message);
    } finally {
      button.disabled = false;
    }
  }

  exports.AdminTools = {
    // New primitives (Section 5.2)
    loginWithPin:         loginWithPin,
    logout:               logout,
    hasValidAdminSession: hasValidAdminSession,
    // Legacy (preserved for Audit/Migration/Void callers)
    ensureAdminSession:   ensureAdminSession,
    openAudit:            openAudit,
    openMigration:        openMigration,
    runMigration:         runMigration
  };

})(window);
