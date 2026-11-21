# Prism: aplikacja

Terminal (Electron + xterm.js + node-pty) z ustawieniami w tym samym oknie i samouczkiem przy pierwszym uruchomieniu. Instrukcja dla użytkowników jest w [README projektu](../../README.md).

```bash
npm install
npm start          # uruchomienie z kodu
npm test           # test generatora komend (potrzebny bash)
npm run dist       # paczka dist/Prism-win-x64.zip (na Windows)
```

- `src/main.js`: okno, powłoki, motywy, uruchamianie `installer/prism.ps1`, test dymny (`Prism.exe --smoke wynik.json`)
- `src/commands.js`: zamienia własne komendy na funkcje PowerShell, bash, zsh i makra cmd. Komendy Prism (`settings`, `krycie`…) wysyłają wiadomości przez folder `PRISM_INBOX`
- `src/renderer/renderer.js`: karty, skróty, powitanie, samouczek
- `src/renderer/settings.js`: ustawienia (motyw z podglądem, kolory, tapeta, okna, pasek, terminal, komendy)
