# CmdDeck macro packs

Macro packs are JSON files (`.cmddeck-pack.json` or `.json` in this folder) with:

```json
{
  "schemaVersion": 1,
  "name": "Pack name",
  "description": "Short description",
  "profile": {
    "id": "any-id-remapped-on-import",
    "name": "Profile name",
    "columns": 3,
    "rows": 2,
    "activePageId": "page1",
    "pages": [{ "id": "page1", "name": "Page 1", "macroIds": ["m1", "m2"] }]
  },
  "macros": [{
    "id": "m1",
    "name": "Button label",
    "command": "echo hello",
    "shell": "pwsh",
    "actionType": "runCommand",
    "showTerminal": false,
    "confirmBeforeRun": false,
    "createdAt": 0,
    "updatedAt": 0
  }]
}
```

Variables in commands: `{{date}}`, `{{time}}`, `{{cwd}}`, `{{profile}}`, `{{env:USERPROFILE}}`, `{{gitBranch}}`.

Import via **Settings → Import pack** or install built-in packs from the dropdown.
