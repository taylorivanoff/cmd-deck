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

### Developer workflows

**Boot a project** (set cwd to the app; PowerShell / zsh):

```bash
git pull
composer install
npm install
php artisan migrate
docker compose up -d
```

**Start a coding session** (Laravel + Vite; enable Show terminal, or split into two buttons):

```bash
docker compose up -d
php artisan queue:work &
npm run dev
```

**Ship check before PR** (set cwd to the repo):

```bash
git status
npm run lint
npm test
gh pr checks
```

**GitHub public repository download counts and stars** (PowerShell; requires authenticated `gh`):

```powershell
gh repo list --visibility public --limit 1000 --json nameWithOwner,stargazerCount |
  ConvertFrom-Json |
  ForEach-Object {
    $repo = $_.nameWithOwner
    $stars = $_.stargazerCount
    $downloads = 0
    gh api "repos/$repo/releases" --paginate --jq '[.[].assets[].download_count] | add // 0' 2>$null |
      ForEach-Object { $downloads += [int]$_ }
    [pscustomobject]@{
      Repo      = $repo
      Stars     = $stars
      Downloads = $downloads
    }
  } |
  Sort-Object Downloads, Stars -Descending |
  Format-Table -AutoSize
```

**Hotfix local data**:

```bash
php artisan migrate:fresh --seed
php artisan cache:clear
php artisan config:clear
php artisan view:clear
```

**Unstick a busy port, then serve** (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
php artisan serve
```

**Unstick a busy port, then serve** (zsh):

```bash
lsof -ti:8000 | xargs kill 2>/dev/null
php artisan serve
```

### Everyday workflows

**Start workday** — open the tools you always need (Windows, PowerShell; edit URLs/apps):

```powershell
Start-Process "https://mail.google.com"
Start-Process "https://calendar.google.com"
Start-Process "https://github.com/notifications"
Start-Process "slack://"
code "$env:USERPROFILE\Projects"
```

**Start workday** (macOS, zsh):

```bash
open https://mail.google.com
open https://calendar.google.com
open https://github.com/notifications
open -a Slack
code ~/Projects
```

**Meeting prep** - pull notes folder + open call link (edit paths/URL):

```powershell
$notes = "$env:USERPROFILE\Documents\MeetingNotes"
Start-Process explorer.exe $notes
Start-Process "https://meet.google.com/your-room"
```

```bash
open ~/Documents/MeetingNotes
open "https://meet.google.com/your-room"
```

**Client delivery zip** - stage today’s folder and compress (Windows, PowerShell; edit paths):

```powershell
$day = Get-Date -Format yyyy-MM-dd
$src = "$env:USERPROFILE\Documents\Clients\Acme\Outgoing"
$dst = "$env:USERPROFILE\Desktop\Acme-$day.zip"
Compress-Archive -Path "$src\*" -DestinationPath $dst -Force
explorer.exe /select,$dst
```

**Weekly project backup** (Windows, PowerShell):

```powershell
$src = "$env:USERPROFILE\Projects"
$dst = "D:\Backups\Projects-$(Get-Date -Format yyyy-MM-dd)"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
robocopy $src $dst /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS
Write-Host "Backup complete: $dst"
```

**Tidy Downloads older than 30 days** (Windows, PowerShell):

```powershell
$downloads = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
Get-ChildItem $downloads -File |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
Write-Host "Old Downloads cleaned."
```

```bash
find ~/Downloads -type f -mtime +30 -delete
echo "Old Downloads cleaned."
```

## Keywords

Stream Deck alternative, command launcher, terminal shortcuts, macro pad, always-on-top command grid, Tauri desktop app, Windows Terminal launcher, shell command buttons

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

