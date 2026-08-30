(function (root) {
  'use strict';

  var DESKTOP_MIN_WIDTH = 1025;
  var NAVIGATION_COLLAPSED_KEY = 'clinic_management_desktop_navigation_collapsed';
  var initialized = false;
  var currentView = 'home';
  var shell;

  var NAV_GROUPS = [
    {
      label: 'Clinical',
      items: [
        { view: 'home', label: 'Home' },
        { view: 'prescription', label: 'Prescription' },
        { view: 'appointments', label: 'Appointments' }
      ]
    },
    {
      label: 'Operations',
      items: [
        { view: 'finance', label: 'Finance' },
        { view: 'expenses', label: 'Expenses' },
        { view: 'report', label: 'Monthly Report' },
        { view: 'payments', label: 'Patient Payment' }
      ]
    },
    {
      label: 'Account',
      items: [{ view: 'settings', label: 'Settings' }]
    }
  ];

  function getDocument() {
    return root.document;
  }

  function isDesktop() {
    return Number(root.innerWidth) >= DESKTOP_MIN_WIDTH;
  }

  function getInitialView() {
    var active = getDocument().querySelector('.nav-tab.active[data-view]');
    return active ? active.getAttribute('data-view') : currentView;
  }

  function buildNavigation() {
    return NAV_GROUPS.map(function (group) {
      var buttons = group.items.map(function (item) {
        return '<button class="desktop-nav-item desktop-focusable" type="button" data-desktop-view="' + item.view + '"><span>' + item.label + '</span></button>';
      }).join('');
      return '<section class="desktop-nav-group" aria-label="' + group.label + '"><p>' + group.label + '</p>' + buttons + '</section>';
    }).join('');
  }

  function navigationIsCollapsed() {
    try {
      return root.localStorage.getItem(NAVIGATION_COLLAPSED_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function setNavigationCollapsed(collapsed) {
    var isCollapsed = !!collapsed;
    var doc = getDocument();
    doc.body.classList.toggle('desktop-nav-collapsed', isCollapsed);

    var toggle = doc.getElementById('desktopNavToggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!isCollapsed));
      toggle.setAttribute('aria-label', 'Minimize navigation');
    }

    var navigation = doc.getElementById('desktopNav');
    if (navigation) {
      navigation.setAttribute('aria-hidden', String(isCollapsed));
      navigation.inert = isCollapsed;
    }

    var restore = doc.getElementById('desktopNavRestore');
    if (restore) restore.hidden = !isCollapsed;

    try {
      root.localStorage.setItem(NAVIGATION_COLLAPSED_KEY, isCollapsed ? '1' : '0');
    } catch (error) {
      // The clinic remains usable when browser storage is unavailable.
    }
  }

  function createShell() {
    var doc = getDocument();
    shell = doc.getElementById('desktopAppShell');
    if (shell) return shell;
    shell = doc.createElement('section');
    shell.id = 'desktopAppShell';
    shell.setAttribute('data-desktop-workspace', 'true');
    shell.setAttribute('aria-label', 'Clinic desktop workspace');
    shell.innerHTML =
      '<aside class="desktop-nav" id="desktopNav" aria-label="Doctor navigation">' +
        '<div class="desktop-nav-actions"><button class="desktop-nav-toggle desktop-focusable" id="desktopNavToggle" type="button" aria-expanded="true" aria-label="Minimize navigation" title="Minimize navigation">&#8249;</button></div>' +
        buildNavigation() +
        '<button class="desktop-nav-item desktop-logout desktop-focusable" id="desktopLogout" type="button">Logout</button>' +
      '</aside>' +
      '<button class="desktop-nav-restore desktop-focusable" id="desktopNavRestore" type="button" aria-label="Restore navigation" title="Restore navigation" hidden>&#8250;</button>';
    var controlPanel = doc.querySelector('.control-panel');
    if (controlPanel && controlPanel.parentNode) controlPanel.parentNode.insertBefore(shell, controlPanel);
    else doc.body.insertBefore(shell, doc.body.firstChild);

    bindShellControls();
    return shell;
  }

  function bindShellControls() {
    var doc = getDocument();
    Array.prototype.forEach.call(doc.querySelectorAll('[data-desktop-view]'), function (button) {
      button.addEventListener('click', function () {
        if (typeof root.switchView === 'function') root.switchView(button.getAttribute('data-desktop-view'));
      });
    });
    var logout = doc.getElementById('desktopLogout');
    if (logout) logout.addEventListener('click', function () {
      if (root.TusharReceptionAuth && typeof root.TusharReceptionAuth.logout === 'function') root.TusharReceptionAuth.logout();
      else if (typeof root.switchView === 'function') root.switchView('reception');
    });
    var minimize = doc.getElementById('desktopNavToggle');
    if (minimize) minimize.addEventListener('click', function () { setNavigationCollapsed(true); });
    var restore = doc.getElementById('desktopNavRestore');
    if (restore) restore.addEventListener('click', function () { setNavigationCollapsed(false); });
  }

  function setActiveView(view) {
    currentView = view || currentView;
    Array.prototype.forEach.call(getDocument().querySelectorAll('[data-desktop-view]'), function (button) {
      var active = button.getAttribute('data-desktop-view') === currentView;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function setDoctorShellVisible(visible) {
    if (!shell) return;
    var show = !!visible && isDesktop();
    shell.hidden = !show;
    getDocument().body.classList.toggle('doctor-desktop', show);
    if (show) setActiveView(currentView);
  }

  function doctorShellIsVisible() {
    var reception = getDocument().getElementById('receptionView');
    return !reception || reception.hidden;
  }

  function refresh() {
    createShell();
    setDoctorShellVisible(doctorShellIsVisible());
    setActiveView(getInitialView());
  }

  function wrapNavigation() {
    if (typeof root.switchView !== 'function' || root.switchView._desktopWorkspaceWrapped) return;
    var originalSwitchView = root.switchView;
    function desktopSwitchView(view) {
      var result = originalSwitchView.apply(this, arguments);
      setActiveView(view);
      setDoctorShellVisible(view !== 'reception');
      return result;
    }
    desktopSwitchView._desktopWorkspaceWrapped = true;
    root.switchView = desktopSwitchView;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    createShell();
    setNavigationCollapsed(navigationIsCollapsed());
    currentView = getInitialView();
    wrapNavigation();
    getDocument().addEventListener('clinic:doctor-shell', function (event) {
      setDoctorShellVisible(event.detail && event.detail.visible);
    });
    getDocument().addEventListener('clinic:viewchange', function (event) {
      setActiveView(event.detail && event.detail.view);
    });
    root.addEventListener('resize', refresh);
    refresh();
  }

  root.DesktopWorkspace = {
    init: init,
    refresh: refresh
  };
}(window));
