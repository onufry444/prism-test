# Prism app

Electron + xterm.js + node-pty. The user guide is in the [project README](../../README.md).

```bash
npm install
npm start        # run from source
npm test         # translator and shell file tests (needs bash)
npm run dist     # dist/Prism-win-x64.zip (on Windows; build native/handoff.cpp first, see the comment at its top)
```

| File | What it does |
|---|---|
| `src/main.js` | windows, shells (pty), config changes, the line pipe (sudo, admin checks, translation), `--smoke` self-test |
| `src/config.js` | defaults + Settings layer + `~/.config/prism/config.jsonc`, live reload |
| `src/translate.js` | bash/cmd → PowerShell line translator, commands that need admin rights |
| `src/elevate.js` | admin rights per command: UAC, the elevated helper (`Prism.exe --elevate`) and its pipes |
| `src/shells.js` | shell detection and startup files (PowerShell, bash, zsh, cmd) |
| `src/shell/profile.ps1` | the Prism shell: Linux commands, translation on Enter, admin prompts, prompt |
| `src/shell/elevate.ps1` | `sudo` for PowerShell, cmd and Git Bash |
| `src/handoff.js`, `native/handoff.cpp` | Prism as the default terminal: the COM server Windows hands consoles to, and the pipe it relays them over |
| `src/integrate.js` | registry for the default terminal and the Explorer menu entries (per user, undone on uninstall) |
| `src/win32.js` | Windows API through koffi (blur, admin check, pipe client) |
| `src/renderer/` | terminal window and settings |
