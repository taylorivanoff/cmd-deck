const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  buildProcessEnv,
  whichExecutable,
  firstExisting,
  exists
} = require('./env');

const SHELL_CACHE_TTL_MS = 30_000;
let cachedShells = null;
let cachedShellsAt = 0;

/** @typedef {'powershell' | 'cmd' | 'posix' | 'fish' | 'nu' | 'wsl'} ShellKind */

/**
 * Known shells to probe. Detection also picks up extras from PATH /etc/shells.
 * `binaries` are tried via login-PATH which(); `candidates` are absolute fallbacks.
 */
const SHELL_DEFINITIONS = [
  {
    id: 'powershell',
    name: 'Windows PowerShell',
    kind: 'powershell',
    platforms: ['win32'],
    binaries: ['powershell.exe'],
    candidates: () => [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    ]
  },
  {
    id: 'pwsh',
    name: 'PowerShell 7',
    kind: 'powershell',
    platforms: ['win32', 'darwin', 'linux'],
    binaries: ['pwsh.exe', 'pwsh'],
    candidates: () => [
      ...findWindowsPowerShell7(),
      '/usr/local/bin/pwsh',
      '/opt/homebrew/bin/pwsh',
      '/usr/bin/pwsh'
    ]
  },
  {
    id: 'cmd',
    name: 'Command Prompt',
    kind: 'cmd',
    platforms: ['win32'],
    binaries: ['cmd.exe'],
    candidates: () => [
      process.env.ComSpec,
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
    ]
  },
  {
    id: 'git-bash',
    name: 'Git Bash',
    kind: 'posix',
    platforms: ['win32'],
    binaries: [],
    candidates: () => findGitBashCandidates()
  },
  {
    id: 'wsl',
    name: 'WSL',
    kind: 'wsl',
    platforms: ['win32'],
    binaries: ['wsl.exe', 'wsl'],
    candidates: () => [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe')
    ]
  },
  {
    id: 'zsh',
    name: 'zsh',
    kind: 'posix',
    platforms: ['darwin', 'linux', 'win32'],
    binaries: ['zsh'],
    candidates: () => ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh']
  },
  {
    id: 'bash',
    name: 'bash',
    kind: 'posix',
    platforms: ['darwin', 'linux', 'win32'],
    binaries: ['bash'],
    candidates: () => ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash']
  },
  {
    id: 'sh',
    name: 'sh',
    kind: 'posix',
    platforms: ['darwin', 'linux'],
    binaries: ['sh'],
    candidates: () => ['/bin/sh', '/usr/bin/sh']
  },
  {
    id: 'fish',
    name: 'fish',
    kind: 'fish',
    platforms: ['darwin', 'linux', 'win32'],
    binaries: ['fish', 'fish.exe'],
    candidates: () => ['/usr/local/bin/fish', '/opt/homebrew/bin/fish', '/usr/bin/fish']
  },
  {
    id: 'nu',
    name: 'Nushell',
    kind: 'nu',
    platforms: ['win32', 'darwin', 'linux'],
    binaries: ['nu.exe', 'nu'],
    candidates: () => [
      path.join(os.homedir(), '.cargo', 'bin', process.platform === 'win32' ? 'nu.exe' : 'nu'),
      '/usr/local/bin/nu',
      '/opt/homebrew/bin/nu'
    ]
  },
  {
    id: 'xonsh',
    name: 'xonsh',
    kind: 'posix',
    platforms: ['darwin', 'linux', 'win32'],
    binaries: ['xonsh', 'xonsh.exe'],
    candidates: () => ['/usr/local/bin/xonsh', '/opt/homebrew/bin/xonsh']
  },
  {
    id: 'elvish',
    name: 'Elvish',
    kind: 'posix',
    platforms: ['darwin', 'linux', 'win32'],
    binaries: ['elvish', 'elvish.exe'],
    candidates: () => ['/usr/local/bin/elvish', '/opt/homebrew/bin/elvish']
  }
];

function programFilesRoots() {
  return [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.ProgramW6432,
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean);
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

function findWindowsPowerShell7() {
  const found = [];
  for (const root of programFilesRoots()) {
    const psRoot = path.join(root, 'PowerShell');
    for (const versionDir of listSubdirs(psRoot).sort().reverse()) {
      found.push(path.join(versionDir, 'pwsh.exe'));
    }
  }
  return found;
}

function findGitBashCandidates() {
  const found = [];
  for (const root of programFilesRoots()) {
    found.push(
      path.join(root, 'Git', 'bin', 'bash.exe'),
      path.join(root, 'Git', 'usr', 'bin', 'bash.exe'),
      path.join(root, 'Git', 'git-bash.exe')
    );
  }
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  found.push(
    path.join(local, 'Programs', 'Git', 'bin', 'bash.exe'),
    path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    path.join(local, 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    'C:\\laragon\\bin\\git\\bin\\bash.exe',
    'C:\\laragon\\bin\\git\\usr\\bin\\bash.exe'
  );

  // Prefer bash.exe that clearly belongs to Git (avoid random bash on PATH).
  const pathBash = whichExecutable('bash.exe');
  if (pathBash && /[\\/]git[\\/]/i.test(pathBash)) found.unshift(pathBash);

  return found;
}

function platformMatches(def) {
  return !def.platforms || def.platforms.includes(process.platform);
}

function isWindowsWslBashStub(executable) {
  if (process.platform !== 'win32' || !executable) return false;
  const normalized = executable.replace(/\//g, '\\').toLowerCase();
  return normalized.endsWith('\\system32\\bash.exe') || normalized.endsWith('\\sysnative\\bash.exe');
}

function resolveDefinition(def) {
  for (const bin of def.binaries || []) {
    const hit = whichExecutable(bin);
    if (!hit) continue;

    // System32\bash.exe is the WSL stub, not a usable POSIX shell.
    if (def.id === 'bash' && isWindowsWslBashStub(hit)) continue;
    // Prefer the dedicated git-bash entry over Git's bash.exe labeled as "bash".
    if (def.id === 'bash' && process.platform === 'win32' && /[\\/]git[\\/]/i.test(hit)) continue;

    return hit;
  }
  const candidates = typeof def.candidates === 'function' ? def.candidates() : (def.candidates || []);
  return firstExisting(candidates.filter((candidate) => !isWindowsWslBashStub(candidate)));
}

function readEtcShells() {
  if (process.platform === 'win32') return [];
  try {
    return fs.readFileSync('/etc/shells', 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && exists(line));
  } catch {
    return [];
  }
}

function kindFromExecutable(executable) {
  const base = path.basename(executable || '').toLowerCase();
  if (base.startsWith('pwsh') || base.startsWith('powershell')) return 'powershell';
  if (base === 'cmd.exe' || base === 'cmd') return 'cmd';
  if (base === 'fish' || base === 'fish.exe') return 'fish';
  if (base === 'nu' || base === 'nu.exe') return 'nu';
  if (base === 'wsl.exe' || base === 'wsl') return 'wsl';
  return 'posix';
}

function idFromExecutable(executable) {
  const base = path.basename(executable || '', path.extname(executable || '')).toLowerCase();
  if (base === 'powershell') return 'powershell';
  if (base === 'pwsh') return 'pwsh';
  if (base === 'cmd') return 'cmd';
  if (base === 'bash' && /[\\/]git[\\/]/i.test(executable)) return 'git-bash';
  if (base === 'wsl') return 'wsl';
  return base || 'shell';
}

function detectShells() {
  const shells = [];
  const seenIds = new Set();
  const seenExec = new Set();

  function addShell(entry) {
    if (!entry?.executable || !exists(entry.executable)) return;
    const execKey = process.platform === 'win32'
      ? entry.executable.toLowerCase()
      : entry.executable;
    if (seenExec.has(execKey) || seenIds.has(entry.id)) return;
    seenExec.add(execKey);
    seenIds.add(entry.id);
    shells.push({
      id: entry.id,
      name: entry.name,
      detail: entry.executable,
      executable: entry.executable,
      kind: entry.kind || kindFromExecutable(entry.executable)
    });
  }

  for (const def of SHELL_DEFINITIONS) {
    if (!platformMatches(def)) continue;
    const executable = resolveDefinition(def);
    if (!executable) continue;
    addShell({
      id: def.id,
      name: def.name,
      executable,
      kind: def.kind
    });
  }

  // POSIX systems: include anything listed in /etc/shells that we missed.
  for (const executable of readEtcShells()) {
    const id = idFromExecutable(executable);
    if (seenIds.has(id)) continue;
    addShell({
      id,
      name: path.basename(executable),
      executable,
      kind: kindFromExecutable(executable)
    });
  }

  // Prefer a sensible order: default shell first when present.
  const preferred = defaultShellId();
  shells.sort((a, b) => {
    if (a.id === preferred) return -1;
    if (b.id === preferred) return 1;
    return a.name.localeCompare(b.name);
  });

  return shells;
}

function listShells() {
  const now = Date.now();
  if (cachedShells && now - cachedShellsAt < SHELL_CACHE_TTL_MS) {
    return cachedShells.map((shell) => ({ ...shell }));
  }
  cachedShells = detectShells();
  cachedShellsAt = now;
  return cachedShells.map((shell) => ({ ...shell }));
}

function defaultShellId() {
  if (process.platform === 'win32') {
    if (whichExecutable('pwsh.exe') || whichExecutable('pwsh')) return 'pwsh';
    return 'powershell';
  }

  const shellEnv = process.env.SHELL;
  if (shellEnv && exists(shellEnv)) {
    return idFromExecutable(shellEnv);
  }
  if (exists('/bin/zsh') || whichExecutable('zsh')) return 'zsh';
  if (exists('/bin/bash') || whichExecutable('bash')) return 'bash';
  return 'sh';
}

function migrateShellId(value) {
  if (!value) return defaultShellId();
  const map = {
    builtin: defaultShellId(),
    'windows-terminal': 'cmd',
    terminal: defaultShellId(),
    iterm: defaultShellId(),
    warp: defaultShellId(),
    alacritty: defaultShellId(),
    kitty: defaultShellId(),
    hyper: defaultShellId()
  };
  return map[value] || value;
}

function resolveShell(shellId) {
  const id = migrateShellId(shellId);
  const shells = listShells();
  return shells.find((s) => s.id === id)
    || shells.find((s) => s.id === defaultShellId())
    || shells[0]
    || null;
}

function quoteWin(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function quoteSh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function spawnArgsForShell(shell, command) {
  switch (shell.kind) {
    case 'powershell':
      return [shell.executable, ['-NoProfile', '-NoLogo', '-Command', command]];
    case 'cmd':
      return [shell.executable, ['/d', '/s', '/c', command]];
    case 'fish':
      return [shell.executable, ['-c', command]];
    case 'nu':
      return [shell.executable, ['-c', command]];
    case 'wsl':
      return [shell.executable, ['-e', 'bash', '-lc', command]];
    case 'posix':
    default:
      return [shell.executable, ['-lc', command]];
  }
}

function spawnWithShell(shellId, command, cwd) {
  const shell = resolveShell(shellId);
  if (!shell) throw new Error('No shell available.');
  const workdir = cwd && exists(cwd) ? cwd : undefined;
  const [executable, args] = spawnArgsForShell(shell, command);
  return spawn(executable, args, {
    cwd: workdir,
    windowsHide: true,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildProcessEnv()
  });
}

function launchVisibleShell(shellId, command, cwd) {
  const shell = resolveShell(shellId);
  if (!shell) return { ok: false, error: 'No shell available.' };
  const workdir = cwd && exists(cwd) ? cwd : undefined;
  const title = 'CmdDeck';
  const env = buildProcessEnv();

  try {
    if (process.platform === 'win32') {
      if (shell.kind === 'powershell') {
        const ps = [
          workdir ? `Set-Location -LiteralPath ${quoteWin(workdir)}` : null,
          command.trim(),
          'Write-Host ""',
          'Read-Host "Press Enter to close"'
        ].filter(Boolean).join('; ');
        spawn(process.env.ComSpec || 'cmd.exe', [
          '/c', 'start', title, shell.executable, '-NoExit', '-NoProfile', '-NoLogo', '-Command', ps
        ], { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
        return { ok: true, external: true, shell: shell.id };
      }

      if (shell.kind === 'cmd') {
        const script = [
          workdir ? `cd /d ${quoteWin(workdir)}` : null,
          command.trim()
        ].filter(Boolean).join(' && ');
        spawn(process.env.ComSpec || 'cmd.exe', [
          '/c', 'start', title, shell.executable, '/k', script
        ], { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
        return { ok: true, external: true, shell: shell.id };
      }

      if (shell.kind === 'wsl') {
        spawn(process.env.ComSpec || 'cmd.exe', [
          '/c', 'start', title, shell.executable, '-e', 'bash', '-lc',
          `${command.trim()}; echo; read -n 1 -p "Press any key to close..."`
        ], { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
        return { ok: true, external: true, shell: shell.id };
      }

      if (shell.kind === 'posix' || shell.kind === 'fish' || shell.kind === 'nu') {
        const bashCmd = [
          workdir ? `cd ${quoteSh(workdir)}` : null,
          command.trim(),
          'echo',
          'read -n 1 -p "Press any key to close..."'
        ].filter(Boolean).join('; ');
        const args = shell.kind === 'posix'
          ? ['--login', '-i', '-c', bashCmd]
          : ['-c', bashCmd];
        spawn(process.env.ComSpec || 'cmd.exe', [
          '/c', 'start', title, shell.executable, ...args
        ], { detached: true, stdio: 'ignore', windowsHide: false, env }).unref();
        return { ok: true, external: true, shell: shell.id };
      }
    }

    if (process.platform === 'darwin') {
      const script = [
        workdir ? `cd ${quoteSh(workdir)}` : null,
        command.trim()
      ].filter(Boolean).join(' && ');
      const wrapped = shell.kind === 'posix'
        ? `${quoteSh(shell.executable)} -lc ${quoteSh(script)}`
        : `${quoteSh(shell.executable)} -c ${quoteSh(script)}`;
      const appleScript = `
tell application "Terminal"
  activate
  do script ${quoteSh(wrapped)}
end tell`;
      spawn('osascript', ['-e', appleScript], {
        detached: true,
        stdio: 'ignore',
        env
      }).unref();
      return { ok: true, external: true, shell: shell.id };
    }

    // Linux: best-effort via x-terminal-emulator / xdg-terminal-exec
    const script = [
      workdir ? `cd ${quoteSh(workdir)}` : null,
      command.trim(),
      'echo',
      'read -n 1 -p "Press any key to close..."'
    ].filter(Boolean).join('; ');
    const term = whichExecutable('xdg-terminal-exec')
      || whichExecutable('x-terminal-emulator')
      || whichExecutable('gnome-terminal')
      || whichExecutable('konsole')
      || whichExecutable('xfce4-terminal');
    if (term) {
      spawn(term, ['-e', shell.executable, '-lc', script], {
        detached: true,
        stdio: 'ignore',
        env
      }).unref();
      return { ok: true, external: true, shell: shell.id };
    }

    return { ok: false, error: `Visible shell not supported for ${shell.id} on this platform.` };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function clearShellCache() {
  cachedShells = null;
  cachedShellsAt = 0;
}

module.exports = {
  listShells,
  resolveShell,
  migrateShellId,
  defaultShellId,
  spawnWithShell,
  launchVisibleShell,
  clearShellCache
};
