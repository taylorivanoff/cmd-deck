# CmdDeck — Always-On-Top Command Pad for Terminal Shortcuts

[![Release](https://img.shields.io/github/v/release/taylorivanoff/cmd-deck)](https://github.com/taylorivanoff/cmd-deck/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/cmd-deck/total)](https://github.com/taylorivanoff/cmd-deck/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/cmd-deck)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/taylorivanoff)

**CmdDeck** is a free, cross-platform **Stream Deck–style command launcher** for Windows and macOS. Build an always-on-top button pad that runs shell commands, scripts, and terminal shortcuts in the background — choosing which shell runs each command (PowerShell, cmd, pwsh, Git Bash, zsh, bash) and optionally attaching a console to monitor output.

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

1. Download the latest installer from [Releases](https://github.com/taylorivanoff/cmd-deck/releases)
2. Run the installer and follow the prompts

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

Bump the `version` in `package.json` and push to `master`. The GitHub Actions workflow builds a Windows installer, uploads `latest.yml` / blockmap for auto-updates, and creates a GitHub Release.

Optional repo secrets for signed builds:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

## Usage

1. Click **+** (or the empty tile) to add a command
2. Enter a command and pick **Run with** (PowerShell, cmd, etc.)
3. Optionally enable **Show terminal window**, set a display name, image, and working directory
4. Click a button to run; click again while running to stop
5. Right-click a button to edit or delete

## Notes

- Windows detects PowerShell, PowerShell 7, Command Prompt, and Git Bash when installed
- macOS detects zsh, bash, sh, and fish when installed
- New keys default to PowerShell on Windows and zsh on macOS
- Button images are copied into app user data so they stay available after you move the originals

## Keywords

Stream Deck alternative, command launcher, terminal shortcuts, macro pad, always-on-top command grid, Electron desktop app, Windows Terminal launcher, shell command buttons

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
