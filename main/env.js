const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CACHE_TTL_MS = 5 * 60_000;
let cachedEnv = null;
let cachedAt = 0;

function exists(filePath) {
  try {
    return !!(filePath && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function pathSep() {
  return process.platform === 'win32' ? ';' : ':';
}

function splitPath(value) {
  return String(value || '')
    .split(pathSep())
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniquePaths(...values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    for (const part of splitPath(value)) {
      const key = process.platform === 'win32' ? part.toLowerCase() : part;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(part);
    }
  }
  return result;
}

function expandWinVars(value) {
  return String(value || '').replace(/%([^%]+)%/gi, (_, name) => {
    const upper = name.toUpperCase();
    if (process.env[name] != null) return process.env[name];
    if (process.env[upper] != null) return process.env[upper];
    if (upper === 'USERPROFILE') return os.homedir();
    if (upper === 'SYSTEMROOT') return process.env.SystemRoot || 'C:\\Windows';
    if (upper === 'WINDIR') return process.env.windir || process.env.SystemRoot || 'C:\\Windows';
    if (upper === 'LOCALAPPDATA') {
      return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    }
    if (upper === 'APPDATA') {
      return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    }
    if (upper === 'PROGRAMFILES') return process.env.ProgramFiles || 'C:\\Program Files';
    if (upper === 'PROGRAMFILES(X86)') {
      return process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    }
    return '';
  });
}

function runCapture(command, args, options = {}) {
  try {
    let bin = command;
    let binArgs = args || [];

    // execFileSync cannot launch .bat/.cmd directly on Windows (EINVAL).
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(bin)) {
      binArgs = ['/d', '/s', '/c', [bin, ...binArgs].map((part) => {
        const text = String(part);
        return /\s/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      }).join(' ')];
      bin = process.env.ComSpec || 'cmd.exe';
    }

    return execFileSync(bin, binArgs, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: options.timeout || 5000,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: options.env || process.env
    }).trim();
  } catch {
    return '';
  }
}

function readWindowsRegistryPath() {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const out = runCapture(powershell, [
    '-NoProfile',
    '-NoLogo',
    '-Command',
    "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
  ], { timeout: 6000 });
  return expandWinVars(out);
}

function readWindowsShellPath() {
  // Include profile-based PATH additions from the user's PowerShell session.
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const out = runCapture(powershell, [
    '-NoLogo',
    '-Command',
    '$env:Path'
  ], { timeout: 8000 });
  return expandWinVars(out);
}

function readUnixLoginPath() {
  const candidates = [
    exists('/bin/zsh') ? ['/bin/zsh', ['-lc', 'printenv PATH']] : null,
    exists('/bin/bash') ? ['/bin/bash', ['-lc', 'printenv PATH']] : null,
    exists('/usr/bin/zsh') ? ['/usr/bin/zsh', ['-lc', 'printenv PATH']] : null,
    exists('/usr/bin/bash') ? ['/usr/bin/bash', ['-lc', 'printenv PATH']] : null,
    exists('/bin/sh') ? ['/bin/sh', ['-lc', 'printenv PATH']] : null
  ].filter(Boolean);

  for (const [bin, args] of candidates) {
    const out = runCapture(bin, args, { timeout: 5000 });
    if (out) return out;
  }
  return '';
}

function addIfDir(target, dirPath) {
  if (!dirPath) return;
  try {
    const resolved = path.resolve(dirPath);
    if (exists(resolved) && fs.statSync(resolved).isDirectory()) {
      target.push(resolved);
    }
  } catch {
    /* ignore */
  }
}

function listSubdirs(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

/**
 * Find tool-manager / language bin directories that often exist outside the
 * stale PATH Electron inherits when launched from a GUI or IDE.
 */
function discoverToolBinDirs() {
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const found = [];

  // Generic user bin locations (all platforms)
  for (const dir of [
    path.join(home, 'bin'),
    path.join(home, '.local', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, 'go', 'bin'),
    path.join(home, '.deno', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.composer', 'vendor', 'bin'),
    path.join(home, '.yarn', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.asdf', 'shims'),
    path.join(home, '.asdf', 'bin'),
    path.join(home, '.pyenv', 'bin'),
    path.join(home, '.pyenv', 'shims'),
    path.join(home, '.nvm'), // nvm itself isn't bins; versions handled below
    path.join(home, '.fnm'),
    path.join(home, '.local', 'share', 'pnpm'),
    path.join(home, '.config', 'composer', 'vendor', 'bin')
  ]) {
    addIfDir(found, dir);
  }

  // Any ~/.config/<tool>/bin (Herd, etc.)
  for (const toolDir of listSubdirs(path.join(home, '.config'))) {
    addIfDir(found, path.join(toolDir, 'bin'));
    addIfDir(found, path.join(toolDir, 'shims'));
  }

  // nvm / fnm version node bins: ~/.nvm/versions/node/*/bin
  for (const versionRoot of [
    path.join(home, '.nvm', 'versions', 'node'),
    path.join(home, '.local', 'share', 'fnm', 'node-versions')
  ]) {
    const versions = listSubdirs(versionRoot).sort().reverse();
    for (const versionDir of versions.slice(0, 3)) {
      addIfDir(found, path.join(versionDir, 'bin'));
      addIfDir(found, path.join(versionDir, 'installation', 'bin'));
    }
  }

  if (process.platform === 'win32') {
    for (const dir of [
      path.join(home, 'scoop', 'shims'),
      path.join(localAppData, 'scoop', 'shims'),
      path.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      path.join(appData, 'npm'),
      path.join(appData, 'Composer', 'vendor', 'bin'),
      path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin'),
      path.join(localAppData, 'Programs', 'cursor', 'resources', 'app', 'bin'),
      'C:\\php',
      'C:\\xampp\\php',
      'C:\\laragon\\bin',
      'C:\\laragon\\bin\\nodejs',
      'C:\\laragon\\bin\\composer',
      'C:\\laragon\\bin\\git\\bin',
      'C:\\laragon\\bin\\git\\cmd'
    ]) {
      addIfDir(found, dir);
    }

    // %LOCALAPPDATA%\Programs\<App>\...\bin (one/two levels)
    for (const appDir of listSubdirs(path.join(localAppData, 'Programs'))) {
      addIfDir(found, path.join(appDir, 'bin'));
      addIfDir(found, path.join(appDir, 'resources', 'bin'));
      for (const nested of listSubdirs(appDir).slice(0, 8)) {
        addIfDir(found, path.join(nested, 'bin'));
      }
    }

    // Versioned runtime folders, e.g. Laragon php-8.x / node-x
    for (const runtimeRoot of [
      'C:\\laragon\\bin\\php',
      'C:\\laragon\\bin\\nodejs',
      'C:\\laragon\\bin\\python',
      path.join(home, '.config', 'herd', 'bin')
    ]) {
      if (!exists(runtimeRoot)) continue;
      // Prefer the root itself (shims/wrappers) then newest versioned child.
      addIfDir(found, runtimeRoot);
      const versions = listSubdirs(runtimeRoot).sort().reverse();
      for (const versionDir of versions.slice(0, 2)) {
        addIfDir(found, versionDir);
      }
    }
  } else {
    for (const dir of [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      path.join(home, 'Library', 'Application Support', 'Herd', 'bin'),
      path.join(home, 'Library', 'Application Support', 'Local', 'lightning-services'),
      path.join(home, '.docker', 'bin')
    ]) {
      addIfDir(found, dir);
    }
  }

  return found;
}

function resolveBasePath() {
  if (process.platform === 'win32') {
    return uniquePaths(
      readWindowsRegistryPath(),
      readWindowsShellPath(),
      process.env.Path,
      process.env.PATH
    );
  }

  return uniquePaths(
    readUnixLoginPath(),
    process.env.PATH
  );
}

function findPhpExecutable(env) {
  // Prefer php.exe on Windows so probes don't depend on .bat launching.
  for (const dir of splitPath(env.Path || env.PATH)) {
    for (const name of process.platform === 'win32'
      ? ['php.exe', 'php.bat', 'php.cmd']
      : ['php']) {
      const candidate = path.join(dir, name);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function normalizeIniPath(value) {
  if (!value) return '';
  let cleaned = String(value).trim();
  if (!cleaned || cleaned === 'no value' || cleaned === '(none)') return '';
  // php.ini often escapes Windows paths as C:\\Foo\\bar
  cleaned = cleaned.replace(/\\\\/g, '\\');
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  return cleaned;
}

function readPhpIniSetting(iniPath, key) {
  try {
    const text = fs.readFileSync(iniPath, 'utf8');
    const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'im');
    const match = text.match(pattern);
    if (!match) return '';
    return normalizeIniPath(match[1]);
  } catch {
    return '';
  }
}

function resolveLoadedPhpIni(php, env) {
  // Bypass broken auto_prepend_file while discovering the active php.ini.
  const out = runCapture(php, ['-d', 'auto_prepend_file=', '-d', 'auto_append_file=', '--ini'], {
    env,
    timeout: 4000
  });
  const match = out.match(/Loaded Configuration File:\s*(.+)$/im);
  if (!match) return '';
  const iniPath = match[1].trim();
  if (!iniPath || /\(none\)/i.test(iniPath)) return '';
  return iniPath;
}

/**
 * Herd and similar stacks sometimes set auto_prepend_file to a path that only
 * exists inside their app bundle. When that file is missing, every `php script`
 * invocation fatals. Inject a scan-dir override to clear broken values.
 */
function applyPhpRuntimeFixes(env) {
  const php = findPhpExecutable(env);
  if (!php) return;

  const iniPath = resolveLoadedPhpIni(php, env);
  if (!iniPath || !exists(iniPath)) return;

  const prepend = readPhpIniSetting(iniPath, 'auto_prepend_file');
  const append = readPhpIniSetting(iniPath, 'auto_append_file');
  const clearPrepend = !!(prepend && !exists(prepend));
  const clearAppend = !!(append && !exists(append));
  if (!clearPrepend && !clearAppend) return;

  const overrideDir = path.join(os.homedir(), '.config', 'cmd-deck', 'php-ini.d');
  try {
    fs.mkdirSync(overrideDir, { recursive: true });
    const lines = [
      '; Generated by CmdDeck - clears missing auto_prepend/append paths',
      clearPrepend ? 'auto_prepend_file=' : null,
      clearAppend ? 'auto_append_file=' : null,
      ''
    ].filter((line) => line != null);
    fs.writeFileSync(path.join(overrideDir, 'zz-cmddeck-fix-missing.ini'), lines.join('\n'), 'utf8');
  } catch {
    return;
  }

  const sep = pathSep();
  if (env.PHP_INI_SCAN_DIR && String(env.PHP_INI_SCAN_DIR).trim()) {
    const parts = String(env.PHP_INI_SCAN_DIR).split(sep).map((p) => p.trim()).filter(Boolean);
    if (!parts.some((p) => path.resolve(p) === path.resolve(overrideDir))) {
      parts.push(overrideDir);
    }
    env.PHP_INI_SCAN_DIR = parts.join(sep);
  } else {
    env.PHP_INI_SCAN_DIR = overrideDir;
  }
}

/**
 * Color is opt-in: piped/background runs must not inherit FORCE_COLOR from a
 * parent IDE (or force it themselves), or JSON CLIs like `gh --json` emit ANSI
 * and break parsers (ConvertFrom-Json, jq, etc.).
 */
function applyColorMode(env, color) {
  if (color) {
    env.FORCE_COLOR = '1';
    env.CLICOLOR_FORCE = '1';
    if (env.COLORTERM == null) env.COLORTERM = 'truecolor';
    if (env.TERM == null || env.TERM === 'dumb') env.TERM = 'xterm-256color';
    delete env.NO_COLOR;
    return;
  }

  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  delete env.CLICOLOR_FORCE;
}

/**
 * Build an environment closer to an interactive/login terminal than the
 * often-stale PATH Electron inherits from Finder/Start Menu/IDE launches.
 *
 * @param {{ color?: boolean }} [options]
 *        color=true for visible consoles; false/omit for piped macro runs.
 */
function buildProcessEnv(options = {}) {
  const now = Date.now();
  if (!(cachedEnv && now - cachedAt < CACHE_TTL_MS)) {
    const env = { ...process.env };
    const toolBins = discoverToolBinDirs();
    const mergedPath = uniquePaths(
      toolBins.join(pathSep()),
      resolveBasePath().join(pathSep())
    );

    const pathValue = mergedPath.join(pathSep());
    env.PATH = pathValue;
    if (process.platform === 'win32') {
      env.Path = pathValue;
    }

    // Ensure HOME-like vars exist for tools that expect them.
    if (!env.HOME) env.HOME = os.homedir();
    if (process.platform === 'win32') {
      if (!env.USERPROFILE) env.USERPROFILE = os.homedir();
      if (!env.HOME) env.HOME = os.homedir();
    }

    applyPhpRuntimeFixes(env);

    // Strip color knobs from the cached base; apply per-call via options.color.
    delete env.FORCE_COLOR;
    delete env.CLICOLOR_FORCE;
    delete env.NO_COLOR;

    cachedEnv = env;
    cachedAt = now;
  }

  const env = { ...cachedEnv };
  applyColorMode(env, options.color === true);
  return env;
}

function clearEnvCache() {
  cachedEnv = null;
  cachedAt = 0;
}

/**
 * Resolve an executable using the rebuilt login-like PATH (not Electron's stale PATH).
 */
function whichExecutable(bin) {
  if (!bin) return null;
  const env = buildProcessEnv();

  if (process.platform === 'win32') {
    const whereExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe');
    const out = runCapture(whereExe, [bin], { timeout: 4000, env });
    const hit = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (hit && exists(hit)) return hit;

    // Fallback: scan PATH entries directly for bin / bin.exe / bin.cmd / bin.bat
    const names = [bin];
    if (!/\.[a-z0-9]+$/i.test(bin)) {
      names.push(`${bin}.exe`, `${bin}.cmd`, `${bin}.bat`, `${bin}.com`);
    }
    for (const dir of splitPath(env.Path || env.PATH)) {
      for (const name of names) {
        const candidate = path.join(dir, name);
        if (exists(candidate)) return candidate;
      }
    }
    return null;
  }

  const out = runCapture('which', [bin], { timeout: 4000, env });
  if (out && exists(out.split('\n')[0])) return out.split('\n')[0];

  for (const dir of splitPath(env.PATH)) {
    const candidate = path.join(dir, bin);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return null;
}

module.exports = {
  buildProcessEnv,
  clearEnvCache,
  discoverToolBinDirs,
  resolveBasePath,
  whichExecutable,
  firstExisting,
  exists,
  runCapture
};
