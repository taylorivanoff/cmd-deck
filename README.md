# CmdDeck - Macro Pad for Terminal Commands

[![Release](https://img.shields.io/github/v/release/taylorivanoff/cmd-deck)](https://github.com/taylorivanoff/cmd-deck/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/cmd-deck/total)](https://github.com/taylorivanoff/cmd-deck/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/cmd-deck)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/taylorivanoff)

**CmdDeck** is a free, cross-platform **Stream Deck-style command launcher** for Windows and macOS. Build an always-on-top button pad that runs shell commands, scripts, and terminal shortcuts in the background - choosing which shell runs each command (PowerShell, cmd, pwsh, Git Bash, zsh, bash) and optionally attaching a console to monitor output.

Ideal for developers and power users who want a lightweight **desktop command palette** / macro pad without dedicated Stream Deck hardware.

## Features

- Compact **always-on-top** command grid (toggleable)
- Run short or multi-line shell commands in the background
- **Run with** a selected shell so PATH/environment match that shell (e.g. tools available in PowerShell but not cmd)
- Optional attached console per key to monitor output and cancel
- Button face: custom image, display name, or command text fallback
- Optional working directory per command
- Tray icon with show/hide, always-on-top, start minimised, updates
- Window bounds persistence, splash screen, single-instance, auto-updater
- Close hides to tray (Quit from tray menu)

## Installation

### Windows / Linux

1. Download the latest installer from [Releases](https://github.com/taylorivanoff/cmd-deck/releases)
2. Run the installer and follow the prompts

### macOS

1. Download the `.dmg` from [Releases](https://github.com/taylorivanoff/cmd-deck/releases) and drag **CmdDeck** to Applications
2. macOS may say the app is “damaged” — that is Gatekeeper blocking an unsigned download, not a bad file. Clear quarantine, then open:

```bash
xattr -cr /Applications/CmdDeck.app
open /Applications/CmdDeck.app
```

Or right-click the app → **Open** → **Open**. Full notarization needs an Apple Developer ID (optional later).

## Development

```bash
bun install
bun run start
```

### Building

```bash
bun run release
```

### Releasing

Bump the `version` in `package.json` and push to `master`. The GitHub Actions workflow builds Windows, macOS, and Linux installers, uploads updater metadata, and creates a GitHub Release.

Optional repo secrets for signed builds:

- `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (Windows)
- `CSC_LINK` / `CSC_KEY_PASSWORD` plus Apple notarization env vars (macOS Developer ID)

## Usage

1. Click **+** (or the empty tile) to add a command
2. Enter a command and pick **Run with** (PowerShell, cmd, etc.)
3. Optionally enable **Show terminal window**, set a display name, image, and working directory
4. Click a button to run; click again while running to stop
5. Right-click a button to edit or delete

## Notes

- Detects installed shells from PATH / OS locations (`powershell`, `pwsh`, `cmd`, Git Bash, WSL, zsh, bash, fish, Nushell, and `/etc/shells` entries)
- Defaults to PowerShell 7/Windows PowerShell on Windows, or `$SHELL` / zsh / bash on macOS/Linux
- Commands run with a rebuilt login-like PATH (OS env + common tool bins) so GUI/IDE launches still find Herd, Scoop, Homebrew, nvm, etc.
- Button images are copied into app user data so they stay available after you move the originals

## Keywords

Stream Deck alternative, command launcher, terminal shortcuts, macro pad, always-on-top command grid, Electron desktop app, Windows Terminal launcher, shell command buttons

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
