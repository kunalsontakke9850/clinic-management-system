(function (root) {
  'use strict';

  var active = false;

  function overlayElements() {
    return {
      overlay: root.document && root.document.getElementById('sheetOperationOverlay'),
      message: root.document && root.document.getElementById('sheetOperationMessage')
    };
  }

  function show(message) {
    var elements = overlayElements();
    if (elements.message) elements.message.textContent = message || 'Working with Google Sheets…';
    if (elements.overlay) elements.overlay.hidden = false;
  }

  function hide() {
    var elements = overlayElements();
    if (elements.overlay) elements.overlay.hidden = true;
  }

  function run(message, operation) {
    if (active) return Promise.resolve(undefined);
    active = true;
    show(message);
    return Promise.resolve()
      .then(operation)
      .finally(function () {
        active = false;
        hide();
      });
  }

  root.SheetOperation = { show: show, hide: hide, run: run };
})(window);
