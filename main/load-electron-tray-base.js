const { app } = require('electron');
const fs = require('fs');
const path = require('path');

function findLocalTrayBase(startDir) {
  let dir = path.resolve(startDir);
  while (dir !== path.dirname(dir)) {
    const sibling = path.join(path.dirname(dir), 'electron-tray-base');
    if (fs.existsSync(path.join(sibling, 'package.json'))) return sibling;
    dir = path.dirname(dir);
  }
  return null;
}

function clearRequireCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(resolved + path.sep) || key === resolved) {
      delete require.cache[key];
    }
  }
}

function loadElectronTrayBase(entryDir = __dirname) {
  if (!app.isPackaged) {
    const localBase = findLocalTrayBase(entryDir);
    if (localBase) {
      try {
        clearRequireCache(localBase);
        return require(localBase);
      } catch (_) {
        // Fall through to installed package.
      }
    }
  }
  return require('electron-tray-base');
}

module.exports = loadElectronTrayBase;
