/* =========================================================
   access-control.js
   Role-aware navigation guard and Doctor Login controller.
   Implements Section 5.3 of the implementation plan.
   ========================================================= */

(function (exports) {
  'use strict';

  var PROTECTED_VIEWS = ['prescription', 'finance', 'report'];
  var pendingView = null;
  var _initialized = false;

  /* -------------------------------------------------------
     PURE DECISION FUNCTIONS
  ------------------------------------------------------- */

  function hasDoctorAccess(user, nowMs) {
    if (!window.AdminTools || !window.AdminTools.hasValidAdminSession) return false;
    return window.AdminTools.hasValidAdminSession(user, nowMs !== undefined ? nowMs : Date.now());
  }

  function canOpenView(view) {
    if (PROTECTED_VIEWS.indexOf(view) === -1) return true;
    var user = window.FinanceStore ? window.FinanceStore.getCurrentUser() : null;
    return hasDoctorAccess(user, Date.now());
  }

  /* -------------------------------------------------------
     MODAL HELPERS
  ------------------------------------------------------- */

  function getEl(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, isError) {
    var el = getEl('doctorLoginStatus');
    if (!el) return;
    el.textContent = msg;
    el.setAttribute('aria-live', 'polite');
    el.style && (el.style.color = isError ? '#b91c1c' : '#0e6a3f');
  }

  function openModal() {
    var modal = getEl('doctorLoginModal');
    if (!modal) return;
    modal.hidden = false;
    setStatus('');
    var pinInput = getEl('doctorPinInput');
    if (pinInput) {
      pinInput.value = '';
      try { pinInput.focus(); } catch (e) {}
    }
  }

  function closeModal() {
    var modal = getEl('doctorLoginModal');
    if (modal) modal.hidden = true;
    setStatus('');
    var pinInput = getEl('doctorPinInput');
    if (pinInput) pinInput.value = '';
    pendingView = null;
  }

  /* -------------------------------------------------------
     UI REFRESH
  ------------------------------------------------------- */

  function refreshAccessUI() {
    var user = window.FinanceStore ? window.FinanceStore.getCurrentUser() : null;
    var hasAccess = hasDoctorAccess(user, Date.now());

    // Toggle toolbars
    var receptionToolbar = document.getElementById('receptionToolbar');
    var doctorToolbar    = document.getElementById('doctorActionToolbar');
    var topNav           = document.getElementById('topNav');

    if (receptionToolbar) receptionToolbar.hidden = hasAccess;
    if (doctorToolbar)    doctorToolbar.hidden    = !hasAccess;
    if (topNav)           topNav.hidden           = !hasAccess;

    // Role badge (if present)
    var badge = document.getElementById('currentRoleBadge');
    if (badge) badge.textContent = hasAccess ? 'Doctor Mode' : 'Reception Mode';
  }

  /* -------------------------------------------------------
     NAVIGATION GUARD
  ------------------------------------------------------- */

  function requestDoctorLogin(targetView) {
    pendingView = targetView || null;
    openModal();
  }

  /* -------------------------------------------------------
     LOGIN SUBMISSION
  ------------------------------------------------------- */

  async function submitDoctorLogin(event) {
    if (event && event.preventDefault) event.preventDefault();
    var pinInput = getEl('doctorPinInput');
    var submitBtn = getEl('doctorLoginSubmit');
    var pin = pinInput ? pinInput.value : '';

    if (!String(pin || '').trim()) {
      setStatus('PIN is required.', true);
      return;
    }

    if (!window.AdminTools || !window.AdminTools.loginWithPin) {
      setStatus('Authentication service not available. Please refresh.', true);
      return;
    }

    setStatus('Verifying...', false);
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying...'; }

    try {
      await window.AdminTools.loginWithPin(pin);

      // Clear PIN from memory immediately
      if (pinInput) pinInput.value = '';

      closeModal();
      refreshAccessUI();

      // Navigate to pending or default protected view
      var destination = pendingView || 'home';
      pendingView = null;
      if (window.switchView) {
        window.switchView(destination, { skipAccessCheck: true });
      }
    } catch (error) {
      setStatus(error.message || 'Login failed. Please try again.', true);
      if (pinInput) { pinInput.value = ''; try { pinInput.focus(); } catch (e) {} }
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Login'; }
    }
  }

  /* -------------------------------------------------------
     LOGOUT
  ------------------------------------------------------- */

  function logoutDoctor() {
    if (window.AdminTools && window.AdminTools.logout) {
      window.AdminTools.logout();
    } else if (window.FinanceStore && window.FinanceStore.clearCurrentUser) {
      window.FinanceStore.clearCurrentUser();
    }
    refreshAccessUI();
    if (window.switchView) {
      window.switchView('reception', { skipAccessCheck: true });
    }
  }

  /* -------------------------------------------------------
     INITIALIZATION (idempotent)
  ------------------------------------------------------- */

  function init() {
    if (_initialized) return;
    _initialized = true;

    // Expire stale doctor session on boot
    if (window.FinanceStore) {
      var user = window.FinanceStore.getCurrentUser();
      if (user && !hasDoctorAccess(user, Date.now()) &&
          (user.role === 'admin' || user.role === 'doctor')) {
        window.FinanceStore.clearCurrentUser
          ? window.FinanceStore.clearCurrentUser()
          : window.FinanceStore.setCurrentUser({ userId: 'receptionist', role: 'receptionist', name: 'Staff' });
      }
    }

    // Bind modal controls
    var form   = getEl('doctorLoginForm');
    var cancel = getEl('doctorLoginCancel');
    var close  = getEl('doctorLoginClose');
    var loginBtn  = getEl('doctorLoginBtn');
    var logoutBtn = getEl('doctorLogoutBtn');

    if (form && !form._acBound) {
      form._acBound = true;
      form.addEventListener('submit', submitDoctorLogin);
    }
    if (cancel && !cancel._acBound) {
      cancel._acBound = true;
      cancel.addEventListener('click', function () {
        pendingView = null;
        closeModal();
        try { if (loginBtn) loginBtn.focus(); } catch (e) {}
      });
    }
    if (close && !close._acBound) {
      close._acBound = true;
      close.addEventListener('click', function () {
        pendingView = null;
        closeModal();
      });
    }
    if (loginBtn && !loginBtn._acBound) {
      loginBtn._acBound = true;
      loginBtn.addEventListener('click', function () { openModal(); });
    }
    if (logoutBtn && !logoutBtn._acBound) {
      logoutBtn._acBound = true;
      logoutBtn.addEventListener('click', logoutDoctor);
    }

    // Escape key closes modal when idle
    document.addEventListener('keydown', function (e) {
      var modal = getEl('doctorLoginModal');
      if (!modal || modal.hidden) return;
      if (e.key === 'Escape') {
        var submitBtn = getEl('doctorLoginSubmit');
        if (submitBtn && submitBtn.disabled) return; // request in flight
        pendingView = null;
        closeModal();
      }
    });

    // Always start on Reception
    refreshAccessUI();
    if (window.switchView) {
      window.switchView('reception', { skipAccessCheck: true });
    }
  }

  exports.AccessControl = {
    init:               init,
    hasDoctorAccess:    hasDoctorAccess,
    canOpenView:        canOpenView,
    requestDoctorLogin: requestDoctorLogin,
    refreshAccessUI:    refreshAccessUI,
    logoutDoctor:       logoutDoctor,
    submitDoctorLogin:  submitDoctorLogin
  };

})(window);
