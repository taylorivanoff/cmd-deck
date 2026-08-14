# CmdDeck - Software Macro Pad

[![Release](https://img.shields.io/github/v/release/taylorivanoff/cmd-deck)](https://github.com/taylorivanoff/cmd-deck/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/cmd-deck/total)](https://github.com/taylorivanoff/cmd-deck/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/cmd-deck)](LICENSE)

CmdDeck is an open-source, cross-platform Stream Deck-style command launcher for Windows and macOS. It features a software macro pad that runs commands, scripts, and terminal shortcuts. Choose which shell runs each command and optionally attach a console to monitor output.

Ideal for developers or power users who want a lightweight desktop command palette / macro pad without dedicated hardware.

<img width="530" height="397" alt="{38C0ABE5-9C2B-4F4A-A63D-32A005CF6F86}" src="https://github.com/user-attachments/assets/9d8cfcb8-b504-490e-9b7e-64aad5545daf" />

## Features

- **Profiles and pages** — multiple decks with tabbed pages
- **Macro packs** — import/export `.cmddeck-pack.json`; 7 built-in starter packs in `packs/`
- **Global hotkeys** — optional shortcut per macro (e.g. `Ctrl+Shift+1`)
- **Confirm before run** — safety prompt for destructive commands
- **Workflow variables** — `{{date}}`, `{{cwd}}`, `{{env:VAR}}`, `{{gitBranch}}` in commands
- **SSH remote macros** — run commands on remote hosts over SSH
- **LAN web remote** — control the deck from a phone on the same Wi‑Fi
- **Action types** — run command, open URL, open path, or SSH

## Installation

### Windows

1. Download the latest installer from [Releases](https://github.com/taylorivanoff/cmd-deck/releases)
2. Run the installer and follow the prompts

### macOS

1. Download the `.dmg` from [Releases](https://github.com/taylorivanoff/cmd-deck/releases) and drag **CmdDeck** to Applications
2. macOS may say the app is “damaged” - that is Gatekeeper blocking an unsigned download, not a bad file. Go to System Preferences -> Security & Privacy, then "Open anyway".

## Development

```bash
bun install
bun run dev
```

### Building

```bash
bun run build
```

### Releasing

Bump the `version` in `package.json` and push to `master`. The GitHub Actions workflow builds Windows and macOS installers, uploads updater metadata, and creates a GitHub Release.

## Usage

1. Click **+** (or the empty tile) to add a command
2. Enter a command and pick **Run with** (PowerShell, cmd, etc.)
3. Optionally enable **Show terminal window**, set a display name, image, and working directory
4. Click a button to run; click again while running to stop
5. Right-click a button for Run / Edit / Duplicate / Delete

## Example macros

These match the built-in starter packs in [`packs/`](packs/). Import a pack from the app, or copy a command below into a new macro.

### Laravel Dev

**Boot project** (set cwd to the app):

```bash
git pull
composer install
npm install
php artisan migrate
docker compose up -d
```

**Artisan serve** / **Queue worker** / **Vite dev**:

```bash
php artisan serve
```

```bash
php artisan queue:work
```

```bash
npm run dev
```

**PR check**:

```bash
git status
npm run lint
npm test
```

### Node Fullstack

```bash
npm install
```

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run lint
```

### Docker Compose

```bash
docker compose up -d
```

```bash
docker compose logs -f --tail=200
```

```bash
docker compose down
```

### Git Ship Check

```bash
git status
```

```bash
git diff
```

```bash
git push
```

### Daily Routines

**Start workday** (PowerShell):

```powershell
Start-Process https://mail.google.com
Start-Process https://calendar.google.com
Start-Process https://github.com/notifications
```

**GitHub** — action type Open URL: `https://github.com`

**Open Projects** — action type Open path: `{{env:USERPROFILE}}\Projects`

**Tidy Downloads** (confirm before run):

```powershell
$downloads = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
Get-ChildItem $downloads -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
```

### Streamer OBS Shell

**Scene: Main** / **Scene: BRB** (edit OBS host/port and scene names):

```bash
curl -s -X POST http://127.0.0.1:4455/api/requests -H "Content-Type: application/json" -d "{\"requestType\":\"SetCurrentProgramScene\",\"requestData\":{\"sceneName\":\"Main\"}}"
```

```bash
curl -s -X POST http://127.0.0.1:4455/api/requests -H "Content-Type: application/json" -d "{\"requestType\":\"SetCurrentProgramScene\",\"requestData\":{\"sceneName\":\"BRB\"}}"
```

**Open OBS** — action type Open URL: `obs64://`

### Homelab SSH Starter

SSH macros (edit host/user/key per machine). Commands run on the remote:

```bash
df -h
```

```bash
docker ps
```

```bash
cd ~/stack && docker compose restart
```

```bash
sudo apt update && sudo apt upgrade -y
```

## Keywords

Stream Deck alternative, command launcher, terminal shortcuts, macro pad, always-on-top command grid, Tauri desktop app, Windows Terminal launcher, shell command buttons

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

