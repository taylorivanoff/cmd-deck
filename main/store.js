const Store = require('electron-store');
const { randomUUID } = require('crypto');

const store = new Store({
  name: 'cmd-deck',
  defaults: {
    macros: [],
    columns: 3,
    rows: 3,
    opacity: 1,
    alwaysOnTop: true,
    startMinimised: false,
    sizeLocked: true,
    windowBounds: null
  }
});

function getMacros() {
  return store.get('macros', []);
}

function setMacros(macros) {
  store.set('macros', macros);
  return macros;
}

function addMacro(partial) {
  const macros = getMacros();
  const macro = {
    id: randomUUID(),
    command: (partial.command || '').trim(),
    name: (partial.name || '').trim(),
    imagePath: partial.imagePath || null,
    cwd: (partial.cwd || '').trim() || null,
    showTerminal: !!partial.showTerminal,
    shell: (partial.shell || partial.terminalApp || '').trim() || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  macros.push(macro);
  setMacros(macros);
  return macro;
}

function updateMacro(id, partial) {
  const macros = getMacros();
  const index = macros.findIndex((m) => m.id === id);
  if (index === -1) return null;
  macros[index] = {
    ...macros[index],
    ...partial,
    id,
    command: partial.command !== undefined ? String(partial.command).trim() : macros[index].command,
    name: partial.name !== undefined ? String(partial.name).trim() : macros[index].name,
    cwd: partial.cwd !== undefined ? (String(partial.cwd).trim() || null) : macros[index].cwd,
    showTerminal: partial.showTerminal !== undefined ? !!partial.showTerminal : !!macros[index].showTerminal,
    shell: partial.shell !== undefined
      ? (String(partial.shell).trim() || null)
      : (macros[index].shell || macros[index].terminalApp || null),
    updatedAt: Date.now()
  };
  setMacros(macros);
  return macros[index];
}

function deleteMacro(id) {
  const next = getMacros().filter((m) => m.id !== id);
  setMacros(next);
  return next;
}

function reorderMacros(orderedIds) {
  const current = getMacros();
  const byId = new Map(current.map((m) => [m.id, m]));
  const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  const leftovers = current.filter((m) => !orderedIds.includes(m.id));
  const next = [...ordered, ...leftovers];
  setMacros(next);
  return next;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getSettings() {
  return {
    columns: clamp(store.get('columns', 3), 2, 32, 3),
    rows: clamp(store.get('rows', 3), 1, 32, 3),
    opacity: store.get('opacity', 0.94),
    alwaysOnTop: store.get('alwaysOnTop', true),
    startMinimised: store.get('startMinimised', false),
    sizeLocked: store.get('sizeLocked', true)
  };
}

function setSettings(partial) {
  if (partial.columns !== undefined) store.set('columns', clamp(partial.columns, 2, 32, 3));
  if (partial.rows !== undefined) store.set('rows', clamp(partial.rows, 1, 32, 3));
  if (partial.opacity !== undefined) store.set('opacity', clamp(partial.opacity, 0.35, 1, 0.94));
  if (partial.alwaysOnTop !== undefined) store.set('alwaysOnTop', !!partial.alwaysOnTop);
  if (partial.startMinimised !== undefined) store.set('startMinimised', !!partial.startMinimised);
  if (partial.sizeLocked !== undefined) store.set('sizeLocked', !!partial.sizeLocked);
  return getSettings();
}

function getWindowBounds() {
  return store.get('windowBounds', null);
}

function setWindowBounds(bounds) {
  store.set('windowBounds', bounds);
}

module.exports = {
  getMacros,
  setMacros,
  addMacro,
  updateMacro,
  deleteMacro,
  reorderMacros,
  getSettings,
  setSettings,
  getWindowBounds,
  setWindowBounds
};
