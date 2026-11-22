# Prism

**The terminal Windows should have shipped with, and a desktop you design yourself.**

Prism replaces the Windows terminal and restyles the whole desktop: a macOS-style dock, a menu bar with workspaces, tiling windows like Hyprland, colors, wallpaper. One command installs it. Type `settings` to change anything with the mouse, or edit a config file like on Linux.

[![Checks](https://github.com/onufry444/prism/actions/workflows/check.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/check.yml) [![App](https://github.com/onufry444/prism/actions/workflows/app.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/app.yml)

## Install

Open **PowerShell** (no admin rights needed) and paste:

```powershell
irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
```

Prism opens right away. Later on, use the Start menu, press **Ctrl+Alt+T** anywhere, or type `prism` in any terminal.

## Why switch

**One shell that understands everything.** The default Prism shell is PowerShell with the habits you bring from elsewhere:

```bash
ls -la ~/projects          # GNU flags, colored output
rm -rf node_modules        # refuses to touch C:\, your home folder or Windows
grep -rn TODO src          # recursive, line numbers, highlighted matches
npm run build && npm test  # && and || even on Windows PowerShell 5.1
export NODE_ENV=production # bash style
echo %APPDATA% $PATH       # cmd and bash variables
dir /s /b *.log            # cmd switches
sudo !!                    # rerun the last command as administrator
alias gs='git status'      # saved for every future session
```

These Linux commands work out of the box: `ls`, `rm`, `cp`, `mv`, `mkdir -p`, `touch`, `cat -n`, `grep`, `head`, `tail -f`, `wc`, `which`, `df -h`, `du -sh`, `free -h`, `uname -a`, `uptime`, `env`, `export`, `unset`, `sudo`, `open`, `pbcopy`, `pbpaste`, `ln -s`, `kill -9`, `killall`, `pgrep`, `ps aux`, `wget`, `less` and `man`. PowerShell parameters still go to the real cmdlets, so `ls -Recurse` works too.

When a line uses bash or cmd syntax, Prism rewrites it before it runs and shows you what it did. Start a line with a space to run it exactly as typed. If you type a missing tool like `vim` or `htop`, Prism shows the `winget` command that installs it. PowerShell commands typed in Git Bash run in PowerShell.

**A desktop that looks the way you want.**

| Theme | Look |
|---|---|
| `glass` | macOS: a dock with magnification, a translucent menu bar, rounded windows |
| `tiles` | Hyprland: tiling windows, accent borders, gaps, a workspace bar |
| `paper` | light and calm, dock and menu bar |
| `midnight` | minimal dark, auto-hiding dock, tiled windows with wide gaps |

Pick a theme in `settings` and adjust its colors, wallpaper and windows with a live preview. Then click **Apply to Windows**. Your theme is a `.json` file you can share.

**A terminal that is nice to use.** It has tabs, transparency and blur, and 10 color schemes (Tokyo Night, Catppuccin, Gruvbox, Nord, Dracula, Rosé Pine and more). The prompt is fast and shows the folder and git branch. You also get history suggestions as you type, Ctrl+Shift+F search, copy on select and a show/hide hotkey that works from anywhere.

## Configure it like Linux

Everything in Settings also lives in text files that reload when you save them:

- `~/.config/prism/config.jsonc` holds every option, as JSON with comments. Values set here win over the Settings screen.
- `~/.config/prism/style.css` is custom CSS for the terminal, the dock and the menu bar.
- Your desktop themes are `.json` files in `%LOCALAPPDATA%\Prism\themes`.

```jsonc
{
  "terminal": { "scheme": "catppuccin", "opacity": 80, "font": "\"JetBrains Mono\", monospace" },
  "prompt": { "segments": ["userhost", "path", "git", "duration", "status"], "symbol": "λ" },
  "dock": { "enabled": true, "iconSize": 56, "magnification": 2 },
  "bar": { "enabled": true, "left": ["menu", "workspaces"], "center": ["clock"], "right": ["cpu", "memory", "battery"] },
  "aliases": [ { "name": "proj", "body": "cd ~/projects/{1} && code ." } ],
  "keys": { "toggleWindow": "Ctrl+Alt+T" }
}
```

```css
body.prism-dock .dock { border-radius: 26px; background: rgba(0, 0, 0, .35); }
body.prism-bar .ws.on { background: #f5c2e7; }
```

## Commands

In any terminal:

| Command | What it does |
|---|---|
| `prism` | open Prism |
| `prism settings` | open Prism in Settings |
| `prism list` | list desktop themes |
| `prism apply tiles` | apply a desktop theme |
| `prism restore` | put the original Windows look back |
| `prism update` | update Prism |
| `prism uninstall` | remove Prism (restores the original look first) |

These also work inside Prism: `settings`, `prism alias NAME CMD`, `prism unalias NAME`, `prism opacity 0-100`, `prism font-size N`, `prism scheme NAME` and `prism help`.

## Safe to try

The first time you apply a theme, Prism saves a backup of everything it changes: registry values, the wallpaper and the GlazeWM config. `prism restore` or the button in Settings puts it all back. Prism only changes settings for your user and needs no admin rights. The one exception is the first GlazeWM install for tiling, when Windows asks for permission. While the dock is on, the Windows taskbar auto-hides. Turning the dock off, quitting Prism or uninstalling brings it back.

## What Prism uses

| Part | How |
|---|---|
| Terminal | Electron, xterm.js, node-pty |
| Dark/light mode, accent, transparency, wallpaper | Windows registry (current user only) |
| Dock, menu bar | Prism itself (Windows API through koffi) |
| Tiling, gaps, borders, corners | [GlazeWM](https://github.com/glzr-io/glazewm), installed only if a theme uses tiling |

## For developers

```
install.ps1               one-line installer (downloads the GitHub release)
installer/prism.ps1       engine: themes, backup/restore, GlazeWM, update, uninstall
themes/                   built-in themes + schema.json
apps/terminal/src/        the app: main.js, config.js, translate.js, shells.js, desktop.js, win32.js
apps/terminal/src/shell/  the Prism shell profile for PowerShell and bash
```

To run from source, `cd apps/terminal`, then run `npm install` and `npm start`. Tests: `npm test` (translator and shell files), plus `test/profile.tests.ps1` on Windows.

Every push runs on GitHub Actions with Windows Server 2025, which shares its build with Windows 11 24H2. CI builds the app and applies a tiling theme with GlazeWM. It then runs a self-test of the window, Settings, the dock, the menu bar, workspaces and each shell, and checks the one-line install and the uninstall. Raising the version in `apps/terminal/package.json` publishes a release.

## License

MIT, see [LICENSE](LICENSE).
