const Store = require('electron-store');
const { randomUUID } = require('crypto');

const store = new Store({
  name: 'cmd-deck',
  defaults: {
    macros: [],
    columns: 3,
    alwaysOnTop: true,
    startMinimised: false,
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

function getSettings() {
  return {
    columns: store.get('columns', 3),
    alwaysOnTop: store.get('alwaysOnTop', true),
    startMinimised: store.get('startMinimised', false)
  };
}

function setSettings(partial) {
  if (partial.columns !== undefined) store.set('columns', Math.min(6, Math.max(2, Number(partial.columns) || 3)));
  if (partial.alwaysOnTop !== undefined) store.set('alwaysOnTop', !!partial.alwaysOnTop);
  if (partial.startMinimised !== undefined) store.set('startMinimised', !!partial.startMinimised);
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
