# CmdDeck

[![Release](https://img.shields.io/github/v/release/taylorivanoff/cmd-deck)](https://github.com/taylorivanoff/cmd-deck/releases)
[![Downloads](https://img.shields.io/github/downloads/taylorivanoff/cmd-deck/total)](https://github.com/taylorivanoff/cmd-deck/releases)
[![License](https://img.shields.io/github/license/taylorivanoff/cmd-deck)](LICENSE)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/taylorivanoff)

Always-on-top Stream Deck–style pad for running terminal commands in the background. Cross-platform Electron app with native-looking UI on Windows and macOS.

## Features

- Compact **always-on-top** command grid (toggleable)
- Run short or multi-line shell commands in the background
- Optional **attached terminal window** per key to monitor output and cancel
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
2. Enter a command (required). Optionally set a display name, image, and working directory
3. Click a button to run; click again while running to stop
4. Right-click a button to edit or delete
5. Use the gear icon for columns, always-on-top, and start-minimised

## Notes

- On Windows, commands run through the system shell (`cmd`/`PowerShell` via `shell: true`)
- On macOS/Linux, commands run via `zsh` (or `bash` if zsh is unavailable)
- Button images are copied into app user data so they stay available after you move the originals

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
