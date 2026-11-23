# Prism

**One terminal for Windows that speaks PowerShell, cmd and bash, asks for admin rights only when a command needs them, and is configured like Linux tools.**

[![Checks](https://github.com/onufry444/prism/actions/workflows/check.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/check.yml) [![App](https://github.com/onufry444/prism/actions/workflows/app.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/app.yml)

## Install

Open **PowerShell** (no admin rights needed) and paste:

```powershell
irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
```

Prism opens right away. Later on, use the Start menu, press **Ctrl+Alt+T** anywhere, or type `prism` in any terminal.
To remove it: `prism uninstall` (add `-Purge` to delete your settings too).

## Why switch

**Type it the way you know it.** The default Prism shell is PowerShell that also understands bash and cmd:

```bash
ls -la ~/projects          # GNU flags, colored output
rm -rf node_modules        # refuses to touch C:\, your home folder or Windows
grep -rn TODO src          # recursive, line numbers, highlighted matches
npm run build && npm test  # && and || even on Windows PowerShell 5.1
export NODE_ENV=production # bash style
echo %APPDATA% $PATH       # cmd and bash variables
dir /s /b *.log            # cmd switches
alias gs='git status'      # saved for every future session
```

When a line uses bash or cmd syntax, Prism rewrites it before it runs and shows you what it did. Start a line with a space to run it exactly as typed. A missing tool like `vim` or `htop` gets a `winget` command that installs it. PowerShell commands typed in Git Bash run in PowerShell.

**Never "Run as administrator" again.** Prism runs as a normal user. When a command needs admin rights, you get them for that one command, in the same tab:

```
❯ sfc /scannow
⚡ sfc needs administrator rights. Run it as admin? [Y/n] y
Beginning system scan.  This process will take some time.
```

- `sudo <command>` runs anything as administrator (PowerShell, cmd and Git Bash tabs). `sudo !!` repeats the last command.
- Tools that always need admin (`sfc`, `DISM`, `choco install`, `diskpart`, firewall and service commands…) ask before they run.
- A command that fails with "Access denied" or "requires elevation" offers to run again as admin.
- The output and your keystrokes stay in the tab. Windows shows its normal UAC prompt; Prism never stores passwords and keeps no admin rights afterwards. Prefer a separate admin window? Switch it in Settings › Administrator.

**Your default terminal.** Turn it on in Settings › Windows and every console app (cmd, PowerShell, Python, anything from winget) opens in a Prism tab, whether you start it from Start, Explorer or Win+R. Programs that fail keep their tab open with the exit code, so you can read the error. You can also add “Open in Prism” to folders and “Run in Prism” to programs and scripts in Explorer, or type `prism run <command>` in any terminal.

**Panes and tabs that come back.** Split a tab right or down (Alt+Shift+= / Alt+Shift+-, or the ⌄ menu), move between panes with Alt+arrows, drag the divider to resize. When Prism starts again, your windows, tabs, panes, folders and the end of their output are back.

**SSH, one click away.** Save servers in Settings › SSH (or import them from `~/.ssh/config`) and open them from the ⌄ menu, or with `prism ssh NAME`. Passwords are typed in the tab and never saved.

**Pictures and more, from your own programs.** The [Prism API](docs/api.md) lets a Python or Node program show images, charts, buttons and forms in the pane, a progress bar on the tab and the taskbar, and Windows notifications; in other terminals it falls back to text. `imgcat picture.png` shows a picture from any shell.

**Plugins and a theme store.** [Plugins](docs/plugins.md) add commands, animations and color schemes (`prism plugin install owner/repo`). The theme store in Settings › Appearance installs themes made by others; [add yours](store/README.md).

**Toys, like on Linux.** `fetch` (system info with the Prism logo, like fastfetch), `lava` (a lava lamp, `t` changes colors), `matrix`, `pipes`, `donut`, `clock`, `visualizer` (bars that move with whatever your PC is playing, like cava), `bonsai`, `stars`, `aquarium`, `snake` (the game), `weather` and `cowsay`. They work in PowerShell, cmd and Git Bash tabs; `q` quits. Settings can show `fetch` in every new tab.

**Nice to use.** Tabs, transparency and blur, 10 color schemes (Tokyo Night, Catppuccin, Gruvbox, Nord, Dracula, Rosé Pine…), a fast prompt with folder and git branch, history suggestions while you type, Ctrl+Shift+F search, copy on select and a show/hide hotkey that works from anywhere.

## Configure it like Linux

Type `settings` for a screen you can use with the mouse. Everything there also lives in text files that reload when you save them:

- `~/.config/prism/config.jsonc` holds every option, as JSON with comments. Values set here win over the Settings screen.
- `~/.config/prism/style.css` is custom CSS for the whole window.

```jsonc
{
  "terminal": { "scheme": "catppuccin", "opacity": 80, "font": "\"JetBrains Mono\", monospace" },
  "shell": { "default": "prism", "translate": true },
  "prompt": { "segments": ["userhost", "path", "git", "duration", "status"], "symbol": "λ" },
  "admin": { "ask": true, "mode": "inline" },
  "windows": { "defaultTerminal": true, "explorerMenu": true },
  "aliases": [ { "name": "proj", "body": "cd ~/projects/{1} && code ." } ],
  "keys": { "toggleWindow": "Ctrl+Alt+T" }
}
```

```css
body.prism-terminal .tab.on { background: var(--ac); color: var(--solid); }
```

## Commands

In any terminal:

| Command | What it does |
|---|---|
| `prism` | open Prism |
| `prism settings` | open Prism in Settings |
| `prism run <command>` | run a program in a new Prism tab |
| `prism version` | show the installed version |
| `prism update` | update Prism |
| `prism uninstall [-Purge]` | remove Prism and switch everything above off (`-Purge` also removes your settings and config) |

Inside Prism: `sudo`, `settings`, `prism alias NAME CMD`, `prism unalias NAME`, `prism opacity 0-100`, `prism font-size N`, `prism scheme NAME` and `prism help`.

## For developers

```
install.ps1               one-line installer (downloads the GitHub release)
installer/prism.ps1       the prism command: version, update, uninstall
apps/terminal/src/        the app: main.js, config.js, translate.js, shells.js, elevate.js, handoff.js, integrate.js, win32.js
apps/terminal/native/     prism-handoff.exe (C++): receives consoles from Windows when Prism is the default terminal
apps/terminal/src/shell/  the Prism shell profiles for PowerShell and bash, and elevate.ps1 (sudo)
```

To run from source, `cd apps/terminal`, then `npm install` and `npm start`. Tests: `npm test` (translator, admin detection and shell files), plus `test/profile.tests.ps1` on Windows.

Every push runs on GitHub Actions with Windows Server 2025. CI builds the app and runs a self-test of the window, Settings and each shell, including `sudo` through the real elevated helper and a console handed over by Windows, then checks the one-line install and the uninstall. Raising the version in `apps/terminal/package.json` on `main` publishes a release.

## License

MIT, see [LICENSE](LICENSE).
