# Prism

**Terminal, który zmienia wygląd całego Windowsa 11.** Zainstalujesz go jedną komendą. Wpisujesz `settings` i w tym samym oknie wybierasz albo tworzysz motyw: kolory, tapetę, kafelkowanie okien, ramki, pasek zadań. Do tego dochodzą własne komendy i przezroczysty terminal.

> *A Windows 11 terminal that restyles the whole system. One-line install, type `settings` for a mouse-friendly theme editor with live preview, custom commands, transparent terminal.*

[![Sprawdzenie](https://github.com/onufry444/prism/actions/workflows/check.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/check.yml) [![Aplikacja](https://github.com/onufry444/prism/actions/workflows/app.yml/badge.svg)](https://github.com/onufry444/prism/actions/workflows/app.yml)

## Instalacja

Otwórz **PowerShell** (zwykły, bez uprawnień administratora) i wklej:

```powershell
irm https://raw.githubusercontent.com/onufry444/prism/main/install.ps1 | iex
```

Prism pobierze się, zainstaluje i uruchomi. Przy pierwszym uruchomieniu zobaczysz powitanie i samouczek krok po kroku. Nic w wyglądzie Windowsa się nie zmieni, dopóki sam nie wybierzesz motywu.

## Jak używać

W terminalu Prism wpisz:

| Komenda | Co robi |
|---|---|
| `settings` | ustawienia w tym samym oknie, obsługiwane myszką: motywy z podglądem, kolory, tapeta, okna, pasek zadań, terminal, komendy |
| `pomoc` | lista wszystkich komend |
| `tutorial` | samouczek od nowa |
| `krycie 60` | przezroczystość terminala |
| `dodaj-komende hej "Cześć {1}!"` | własna komenda (potem: `hej Ola`) |

W każdym terminalu, także zwykłym cmd czy PowerShell, działa komenda `prism`:

| Komenda | Co robi |
|---|---|
| `prism` | otwiera Prism |
| `prism settings` | otwiera Prism od razu w ustawieniach |
| `prism apply kafel` | stosuje motyw bez otwierania ustawień |
| `prism restore` | przywraca oryginalny wygląd Windowsa |
| `prism update` | aktualizacja do najnowszej wersji |
| `prism uninstall` | usuwa Prism (najpierw przywraca oryginalny wygląd) |

## Bezpieczeństwo zmian

Przy pierwszym zastosowaniu motywu Prism zapisuje kopię wszystkiego, co zmienia: wartości rejestru, tapety i plików konfiguracji. Przycisk „Przywróć oryginalny Windows” (albo `prism restore`) przywraca dokładnie ten stan. Prism zmienia tylko ustawienia Twojego konta i nie potrzebuje uprawnień administratora.

## Co Prism zmienia i czym

| Element | Jak |
|---|---|
| Tryb ciemny/jasny, przezroczystość, kolor akcentu, położenie ikon paska | rejestr Windowsa (tylko HKCU) |
| Tapeta | generowana w 4K z kolorów motywu albo Twój obraz |
| Kafelkowanie, odstępy, ramki, rogi, przezroczystość nieaktywnych okien | [GlazeWM](https://github.com/glzr-io/glazewm), instalowany przez winget tylko wtedy, gdy włączysz kafelkowanie |
| Styl paska zadań | [Windhawk](https://windhawk.net) z modem Taskbar Styler. Na razie Prism podpowiada, co wybrać |
| Terminal | Prism sam w sobie: PowerShell, cmd, Git Bash i WSL w kartach, przezroczyste tło, rozmycie pulpitu |

Programy firm trzecich instalowane są z oficjalnych źródeł przez `winget` i mają własne licencje.

**Uczciwie o ograniczeniach:** zmiany paska zadań działają przez podpinanie się pod Eksploratora Windows, więc duża aktualizacja systemu może je czasem zepsuć. `prism restore` działa zawsze.

## Własne motywy

Najprościej: `settings` → **Nowy motyw**. Zmieniasz kolory, tapetę i okna, patrzysz na podgląd i klikasz „Zastosuj w Windows”. Motywy zapisują się w `%LOCALAPPDATA%\Prism\themes` jako pliki `.json`, więc możesz się nimi dzielić. Format opisuje [themes/schema.json](themes/schema.json), a gotowe przykłady to [kafel.json](themes/kafel.json) i [szklo-dock.json](themes/szklo-dock.json).

## Dla programistów

```
install.ps1             instalacja jedną komendą (pobiera wydanie z GitHub Releases)
installer/prism.ps1     silnik: motywy, kopia i przywracanie, GlazeWM, aktualizacja, dezinstalacja
themes/                 wbudowane motywy + schema.json
apps/terminal/          aplikacja (Electron + xterm.js + node-pty): terminal, ustawienia, samouczek
.github/workflows/      testy na Windows i budowanie wydań
```

Uruchomienie z kodu: `cd apps/terminal`, potem `npm install` i `npm start`. Silnik bez aplikacji uruchomisz z folderu głównego: `prism apply kafel -DryRun`.

Każdy push sprawdzają testy na prawdziwym Windowsie: składnia, motywy, próbne zastosowanie, budowanie aplikacji i test dymny. Test dymny otwiera okno i ustawienia, w PowerShell, cmd i Git Bash uruchamia komendy, a na końcu sprawdza instalację i dezinstalację. Nowe wydanie powstaje samo, gdy podniesiesz wersję w `apps/terminal/package.json` i wyślesz zmianę na `main`.

## Plan

- [x] Format motywu, szablony, kopia i przywracanie
- [x] Instalacja jedną komendą, ustawienia w terminalu z podglądem, samouczek
- [ ] Własny pasek górny (zegar, pulpity GlazeWM, media)
- [ ] Automatyczne ustawianie modów Windhawk, kursory, ikony, dźwięki
- [ ] Galeria motywów od społeczności
- [ ] `winget install Prism`

## Licencja

MIT. Zobacz [LICENSE](LICENSE).
