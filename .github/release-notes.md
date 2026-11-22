## Install

Open **PowerShell** (no admin rights needed) and paste:

```powershell
irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
```

Prism starts right away. Type `settings` to make it yours, and `sudo <command>` when something needs admin rights. Already installed? Run `prism update`. Remove it with `prism uninstall`.

Runs on Windows 10 and 11 (64-bit). The app is not code-signed yet, so Windows SmartScreen may warn on first launch: choose “More info”, then “Run anyway”.
