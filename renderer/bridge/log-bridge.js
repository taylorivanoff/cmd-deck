/**
 * Recreates the Electron `window.cmdDeckLog` preload API for log.html
 * on top of `window.tauriTrayBridge`.
 */
(function (global) {
  const { invoke, listen } = global.tauriTrayBridge;

  function onEvent(event, cb) {
    let unlisten = null;
    let cancelled = false;
    listen(event, cb).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }

  global.cmdDeckLog = {
    getLogs: () => invoke("log_get"),
    clearLogs: () => invoke("log_clear"),
    closeWindow: () => global.tauriTrayBridge.closeCurrentWindow(),
    onEntry: (cb) => onEvent("log:entry", cb),
  };
})(typeof window !== "undefined" ? window : globalThis);
