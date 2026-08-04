const MAX_ENTRIES = 500;

/** @typedef {'info' | 'warn' | 'error'} LogLevel */
/** @typedef {{ id: string, time: string, ts: number, level: LogLevel, message: string, macroId?: string|null }} LogEntry */

/** @type {LogEntry[]} */
const entries = [];
/** @type {Set<(entry: LogEntry) => void>} */
const listeners = new Set();
let seq = 0;

function timestamp() {
  return new Date().toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * @param {LogLevel} level
 * @param {string} message
 * @param {{ macroId?: string|null }} [meta]
 */
function addLog(level, message, meta = {}) {
  const entry = {
    id: `log-${Date.now()}-${++seq}`,
    time: timestamp(),
    ts: Date.now(),
    level,
    message: String(message || ''),
    macroId: meta.macroId || null
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch (_) {
      // ignore listener errors
    }
  }
  return entry;
}

function getLogs() {
  return entries.slice();
}

function clearLogs() {
  entries.length = 0;
}

function onLog(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

module.exports = {
  addLog,
  getLogs,
  clearLogs,
  onLog
};
