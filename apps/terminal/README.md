# Prism app

Electron + xterm.js + node-pty. The user guide is in the [project README](../../README.md).

```bash
npm install
npm start        # run from source
npm test         # translator and shell file tests (needs bash)
npm run dist     # dist/Prism-win-x64.zip (on Windows)
```

| File | What it does |
|---|---|
| `src/main.js` | windows, shells (pty), config changes, themes, the translation pipe, `--smoke` self-test |
| `src/config.js` | defaults + Settings layer + `~/.config/prism/config.jsonc`, live reload |
| `src/translate.js` | bash/cmd → PowerShell line translator |
| `src/shells.js` | shell detection and startup files (PowerShell, bash, zsh, cmd) |
| `src/shell/profile.ps1` | the Prism shell: Linux commands, translation on Enter, prompt |
| `src/desktop.js`, `src/win32.js`, `src/glaze.js` | dock, menu bar, Windows API, GlazeWM workspaces |
| `src/renderer/` | terminal window, settings, dock and menu bar pages |
