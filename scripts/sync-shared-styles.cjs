/**
 * Copy @taylorivanoff/shared-styles into renderer/vendor so Tauri CSP
 * and frontendDist can load them.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'node_modules', '@taylorivanoff', 'shared-styles');
const dest = path.join(root, 'renderer', 'vendor', 'shared-styles');

if (!fs.existsSync(src)) {
  console.error('shared-styles not installed. Run: npm install');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

for (const file of ['tokens.css', 'base.css', 'window.css', 'index.css']) {
  const from = path.join(src, file);
  if (!fs.existsSync(from)) {
    console.error(`Missing ${file} in shared-styles package`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(dest, file));
}

console.log('Synced shared-styles → renderer/vendor/shared-styles');
