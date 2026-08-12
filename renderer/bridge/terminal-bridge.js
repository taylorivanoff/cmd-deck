/**
 * Recreates the Electron `window.cmdDeckTerminal` preload API for terminal.html
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

  global.cmdDeckTerminal = {
    getBootstrap: (id) => invoke("terminal_bootstrap", { id }),
    stop: (id) => invoke("macros_stop", { id }),
    close: (id) => invoke("terminal_close", { id }),
    onInit: (cb) => onEvent("terminal:init", cb),
    onOutput: (cb) => onEvent("terminal:output", cb),
    onStatus: (cb) => onEvent("terminal:status", cb),
  };
})(typeof window !== "undefined" ? window : globalThis);
