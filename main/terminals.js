const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BUILTIN_ID = 'builtin';

function which(bin) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where.exe', [bin], { encoding: 'utf8', windowsHide: true });
      return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
    }
    const out = execFileSync('which', [bin], { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function exists(filePath) {
  try {
    return !!(filePath && fs.existsSync(filePath));
  } catch {
    return false;
  }
}

function winLocalAppData(...parts) {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(root, ...parts);
}

function winProgramFiles(...parts) {
  const roots = [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)'
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = path.join(root, ...parts);
    if (exists(candidate)) return candidate;
  }
  return null;
}

function detectWindowsTerminals() {
  const found = [];

  found.push({
    id: BUILTIN_ID,
    name: 'CmdDeck console',
    detail: 'Built-in output window',
    kind: 'builtin'
  });

  const wt = which('wt') || which('wt.exe') || winLocalAppData('Microsoft', 'WindowsApps', 'wt.exe');
  if (exists(wt) || which('wt')) {
    found.push({
      id: 'windows-terminal',
      name: 'Windows Terminal',
      detail: wt || 'wt.exe',
      kind: 'external',
      executable: which('wt') || wt
    });
  }

  const cmd = which('cmd.exe') || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
  if (exists(cmd)) {
    found.push({
      id: 'cmd',
      name: 'Command Prompt',
      detail: cmd,
      kind: 'external',
      executable: cmd
    });
  }

  const powershell = which('powershell.exe') || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (exists(powershell)) {
    found.push({
      id: 'powershell',
      name: 'Windows PowerShell',
      detail: powershell,
      kind: 'external',
      executable: powershell
    });
  }

  const pwsh = which('pwsh.exe') || which('pwsh') || winProgramFiles('PowerShell', '7', 'pwsh.exe');
  if (pwsh && (exists(pwsh) || which('pwsh'))) {
    found.push({
      id: 'pwsh',
      name: 'PowerShell 7',
      detail: which('pwsh') || pwsh,
      kind: 'external',
      executable: which('pwsh') || pwsh
    });
  }

  const gitBash = winProgramFiles('Git', 'bin', 'bash.exe') || winProgramFiles('Git', 'git-bash.exe');
  if (gitBash) {
    found.push({
      id: 'git-bash',
      name: 'Git Bash',
      detail: gitBash,
      kind: 'external',
      executable: gitBash
    });
  }

  const alacritty = which('alacritty.exe') || which('alacritty') || winProgramFiles('Alacritty', 'alacritty.exe');
  if (alacritty && (exists(alacritty) || which('alacritty'))) {
    found.push({
      id: 'alacritty',
      name: 'Alacritty',
      detail: which('alacritty') || alacritty,
      kind: 'external',
      executable: which('alacritty') || alacritty
    });
  }

  return found;
}

function macAppExists(appName) {
  return exists(`/Applications/${appName}`) || exists(path.join(os.homedir(), 'Applications', appName));
}

function detectMacTerminals() {
  const found = [];

  found.push({
    id: BUILTIN_ID,
    name: 'CmdDeck console',
    detail: 'Built-in output window',
    kind: 'builtin'
  });

  if (macAppExists('Terminal.app')) {
    found.push({
      id: 'terminal',
      name: 'Terminal',
      detail: '/Applications/Terminal.app',
      kind: 'external',
      app: 'Terminal'
    });
  }

  if (macAppExists('iTerm.app')) {
    found.push({
      id: 'iterm',
      name: 'iTerm2',
      detail: '/Applications/iTerm.app',
      kind: 'external',
      app: 'iTerm'
    });
  }

  if (macAppExists('Warp.app')) {
    found.push({
      id: 'warp',
      name: 'Warp',
      detail: '/Applications/Warp.app',
      kind: 'external',
      app: 'Warp'
    });
  }

  if (macAppExists('Alacritty.app') || which('alacritty')) {
    found.push({
      id: 'alacritty',
      name: 'Alacritty',
      detail: which('alacritty') || '/Applications/Alacritty.app',
      kind: 'external',
      executable: which('alacritty') || 'alacritty',
      app: 'Alacritty'
    });
  }

  if (macAppExists('kitty.app') || which('kitty')) {
    found.push({
      id: 'kitty',
      name: 'kitty',
      detail: which('kitty') || '/Applications/kitty.app',
      kind: 'external',
      executable: which('kitty') || 'kitty'
    });
  }

  if (macAppExists('Hyper.app')) {
    found.push({
      id: 'hyper',
      name: 'Hyper',
      detail: '/Applications/Hyper.app',
      kind: 'external',
      app: 'Hyper'
    });
  }

  return found;
}

function listTerminals() {
  if (process.platform === 'darwin') return detectMacTerminals();
  if (process.platform === 'win32') return detectWindowsTerminals();
  return [
    {
      id: BUILTIN_ID,
      name: 'CmdDeck console',
      detail: 'Built-in output window',
      kind: 'builtin'
    }
  ];
}

function resolveTerminal(terminalId) {
  const list = listTerminals();
  return list.find((t) => t.id === terminalId) || list.find((t) => t.id === BUILTIN_ID) || list[0];
}

function shellQuoteWin(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function shellQuoteSh(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildScript(command, cwd) {
  const trimmed = String(command || '').trim();
  if (process.platform === 'win32') {
    const lines = [];
    if (cwd) lines.push(`cd /d ${shellQuoteWin(cwd)}`);
    lines.push(trimmed);
    return lines.join(' && ');
  }
  const lines = [];
  if (cwd) lines.push(`cd ${shellQuoteSh(cwd)}`);
  lines.push(trimmed);
  return lines.join(' && ');
}

function launchExternal(terminal, command, cwd) {
  const script = buildScript(command, cwd);
  const title = 'CmdDeck';

  if (process.platform === 'win32') {
    return launchWindows(terminal, script, cwd, title);
  }
  if (process.platform === 'darwin') {
    return launchMac(terminal, script, cwd);
  }
  return { ok: false, error: 'External terminals are not supported on this platform.' };
}

function launchWindows(terminal, script, cwd, title) {
  try {
    if (terminal.id === 'windows-terminal') {
      const exe = terminal.executable || 'wt.exe';
      const args = [];
      if (cwd) args.push('-d', cwd);
      args.push('cmd.exe', '/k', script);
      spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'cmd') {
      spawn(terminal.executable || 'cmd.exe', ['/c', 'start', title, 'cmd.exe', '/k', script], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        cwd: cwd || undefined
      }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'powershell' || terminal.id === 'pwsh') {
      const exe = terminal.executable || (terminal.id === 'pwsh' ? 'pwsh.exe' : 'powershell.exe');
      const psCommand = cwd
        ? `Set-Location -LiteralPath ${shellQuoteWin(cwd)}; ${script.replace(/^cd \/d .*? && /, '')}`
        : script;
      // Prefer keeping the window open after the command finishes.
      const wrapped = `${commandAsPowerShell(commandFromScript(script, cwd))}; if ($LASTEXITCODE -ne $null) { Write-Host \"`nExit: $LASTEXITCODE\" }; Read-Host \"Press Enter to close\"`;
      spawn('cmd.exe', ['/c', 'start', title, exe, '-NoExit', '-Command', wrapped], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'git-bash') {
      const exe = terminal.executable;
      spawn('cmd.exe', ['/c', 'start', title, exe, '--login', '-i', '-c', `${toBashScript(script, cwd)}; echo; read -n 1 -p \"Press any key to close...\"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'alacritty') {
      const exe = terminal.executable || 'alacritty';
      const args = [];
      if (cwd) args.push('--working-directory', cwd);
      args.push('-e', 'cmd.exe', '/k', script);
      spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, external: true };
    }

    return { ok: false, error: `Unsupported terminal: ${terminal.id}` };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function commandFromScript(script, cwd) {
  if (!cwd) return script;
  return script.replace(/^cd \/d .*? && /, '');
}

function commandAsPowerShell(command) {
  // Run through cmd so multi-line / shell builtins behave similarly to background runs.
  return `cmd /c ${shellQuoteWin(command)}`;
}

function toBashScript(script, cwd) {
  // script is cmd-oriented; rebuild a simple bash form from cwd + original is better done by caller.
  // For git-bash we receive cmd script — convert crudely.
  if (cwd) {
    const body = script.replace(/^cd \/d .*? && /, '');
    return `cd ${shellQuoteSh(cwd)} && ${body}`;
  }
  return script;
}

function launchMac(terminal, script, cwd) {
  try {
    if (terminal.id === 'terminal') {
      const appleScript = `
tell application "Terminal"
  activate
  do script ${shellQuoteSh(script)}
end tell`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'iterm') {
      const appleScript = `
tell application "iTerm"
  activate
  try
    tell current window
      create tab with default profile
      tell current session
        write text ${shellQuoteSh(script)}
      end tell
    end tell
  on error
    create window with default profile
    tell current session of current window
      write text ${shellQuoteSh(script)}
    end tell
  end try
end tell`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'warp') {
      // Warp accepts open with optional deep link; fall back to launching shell via open + osascript-less path.
      const bash = `/bin/zsh -lc ${shellQuoteSh(script)}`;
      spawn('open', ['-a', 'Warp', '--args', 'run', script], { detached: true, stdio: 'ignore' }).unref();
      // Also try generic open if args unsupported — Warp will at least open.
      void bash;
      return { ok: true, external: true };
    }

    if (terminal.id === 'alacritty') {
      const exe = terminal.executable || 'alacritty';
      const args = [];
      if (cwd) args.push('--working-directory', cwd);
      args.push('-e', '/bin/zsh', '-lc', `${script}; echo; read -n 1 -s -p 'Press any key to close...'`);
      spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'kitty') {
      const exe = terminal.executable || 'kitty';
      const args = [];
      if (cwd) args.push('--directory', cwd);
      args.push('/bin/zsh', '-lc', `${script}; echo; read -n 1 -s -p 'Press any key to close...'`);
      spawn(exe, args, { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, external: true };
    }

    if (terminal.id === 'hyper') {
      const appleScript = `
tell application "Hyper"
  activate
end tell
delay 0.4
tell application "System Events"
  tell process "Hyper"
    keystroke "t" using command down
    delay 0.2
    keystroke ${shellQuoteSh(script)}
    keystroke return
  end tell
end tell`;
      spawn('osascript', ['-e', appleScript], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, external: true };
    }

    return { ok: false, error: `Unsupported terminal: ${terminal.id}` };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function isBuiltin(terminalId) {
  return !terminalId || terminalId === BUILTIN_ID;
}

module.exports = {
  BUILTIN_ID,
  listTerminals,
  resolveTerminal,
  launchExternal,
  isBuiltin
};
