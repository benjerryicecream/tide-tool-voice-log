/* ============================================================
   main.js — boot
   ============================================================ */
(function () {
  'use strict';

  var TT = window.TT;

  function boot() {
    TT.store.load();
    TT.UI.init();

    window.addEventListener('error', function (ev) {
      if (ev && ev.message && /ResizeObserver/.test(ev.message)) return;
      console.error(ev.error || ev.message);
    });

    // Don't let a tab close silently eat a recording.
    window.addEventListener('beforeunload', function (ev) {
      if (TT.Recorder && TT.Recorder.isRecording && TT.Recorder.isRecording()) {
        ev.preventDefault();
        ev.returnValue = '';
        return '';
      }
    });

    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        console.info('Offline cache not enabled:', err && err.message);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
