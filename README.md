# Prism

**Jeden plik motywu zmienia wygląd całego Windowsa 11.** Kolory, tryb ciemny, akcent, tapeta, pasek zadań, kafelkowanie okien z odstępami i ramkami, terminal. Wybierasz gotowy szablon albo piszesz własny motyw i dzielisz się nim jako plikiem `.json`.

> *One theme file restyles all of Windows 11: colors, accent, wallpaper, taskbar, window tiling and the terminal. Pick a template or write your own and share it as a `.json` file.*

![Status](https://github.com/onufry444/prism/actions/workflows/check.yml/badge.svg)

## Szybki start

Pobierz repozytorium (zielony przycisk **Code → Download ZIP** albo `git clone`). Potem otwórz w tym folderze wiersz poleceń:

```bat
prism list
prism apply kafel
```

Gdy chcesz wrócić do oryginalnego wyglądu Windowsa:

```bat
prism restore
```

Przy pierwszym `apply` Prism zapisuje kopię wszystkiego, co zmienia: wartości rejestru, tapety i plików konfiguracji. `restore` przywraca dokładnie ten stan. Prism nie potrzebuje uprawnień administratora, bo zmienia tylko ustawienia Twojego konta.

| Komenda | Co robi |
|---|---|
| `prism list` | pokazuje dostępne motywy |
| `prism apply <motyw>` | stosuje motyw z folderu `themes` albo z podanego pliku `.json` |
| `prism apply <motyw> -DryRun` | tylko generuje pliki do folderu `prism-out` i niczego nie zmienia |
| `prism apply <motyw> -SkipInstall` | nie instaluje brakujących programów |
| `prism status` | pokazuje, który motyw jest aktywny |
| `prism restore` | przywraca oryginał |

## Motywy w zestawie

| Motyw | Styl |
|---|---|
| `szklo-dock` | Spokojny i szklany: pasek jak dock na środku, zaokrąglone okna, ciepła tapeta o zmierzchu |
| `kafel` | Kafelkowe okna sterowane klawiaturą, fioletowe ramki, odstępy, chłodna ciemna tapeta |

## Własny motyw

Skopiuj `themes/kafel.json`, zmień `id` (musi być taki sam jak nazwa pliku) i dowolne wartości. Edytory takie jak VS Code podpowiadają pola na podstawie `themes/schema.json`.

```jsonc
{
  "id": "moj-motyw",
  "name": "Mój motyw",
  "colors": { "mode": "dark", "background": "#101216", "surface": "#1a1d24", "text": "#e7e5df", "accent": "#ff8fb1" },
  "effects": { "transparency": true, "opacity": 80, "blur": true, "radius": 12 },
  "fonts": { "mono": "Cascadia Code", "size": 14 },
  "wallpaper": { "type": "gradient", "angle": 135, "colors": ["background", "#3b1f3a", "accent"] },
  "taskbar": { "alignment": "center", "windhawk": { "taskbarStyler": "DockLike" } },
  "windows": {
    "tiling": true,
    "gaps": { "inner": 10, "outer": 14 },
    "border": { "enabled": true, "focused": "accent", "inactive": "surface" },
    "corners": "rounded",
    "inactiveOpacity": 92
  },
  "terminal": { "enabled": true, "ansi": "dark" }
}
```

Tam, gdzie motyw oczekuje koloru, możesz wpisać `#RRGGBB` albo nazwę koloru z sekcji `colors`, np. `"accent"`. Tapeta może być gradientem z 2–8 kolorów albo obrazkiem (`"type": "image", "path": "tapeta.jpg"`, ścieżka względem pliku motywu).

Motyw z dowolnego miejsca zastosujesz tak: `prism apply C:\sciezka\moj-motyw.json`.

## Co Prism zmienia i czym

| Element | Jak |
|---|---|
| Tryb ciemny/jasny, przezroczystość, kolor akcentu, położenie ikon paska | rejestr Windowsa (tylko HKCU) |
| Tapeta | generowana z kolorów motywu w 4K albo kopiowana z obrazka |
| Kafelkowanie, odstępy, ramki, zaokrąglenia, przezroczystość nieaktywnych okien | [GlazeWM](https://github.com/glzr-io/glazewm) (instalowany przez winget, tylko gdy `windows.tiling` to `true`) |
| Wygląd paska zadań i menu Start | [Windhawk](https://windhawk.net) z modami Taskbar/Start Menu Styler. Na razie Prism podaje, który motyw moda wybrać, a w etapie 4 ustawi go sam |
| Terminal | Szkło Terminal z `apps/terminal` |

Prism nie dołącza tych programów do repozytorium. Instaluje je z oficjalnych źródeł przez `winget` i każdy ma własną licencję.

**Uczciwie o ograniczeniach:** zmiany paska zadań i menu Start działają przez podpinanie się pod Eksploratora Windows. Duża aktualizacja systemu może je czasem zepsuć, dopóki autorzy modów ich nie poprawią. Dlatego `prism restore` zawsze działa niezależnie od tych narzędzi.

## Szkło Terminal

`apps/terminal` to terminal z prawdziwą powłoką (PowerShell, cmd, bash, zsh), przezroczystym tłem i własnymi komendami. Prism ustawia mu kolory z motywu. Szczegóły znajdziesz w [apps/terminal/README.md](apps/terminal/README.md).

## Struktura

```
prism.cmd               uruchamianie z wiersza poleceń
installer/prism.ps1     cała logika: motywy, kopia, generowanie konfiguracji
themes/                 motywy + schema.json (format)
apps/terminal/          Szkło Terminal (Electron)
.github/workflows/      automatyczne sprawdzanie każdej zmiany na Windows
```

Każdy push uruchamia na GitHubie test: sprawdza składnię skryptów, zgodność motywów ze schematem i próbne zastosowanie każdego motywu w PowerShell 5.1 i 7. Wygenerowane pliki (tapeta, konfiguracja GlazeWM) można pobrać jako artefakt `podglad-motywow`.

## Plan

- [x] **Etap 1:** format motywu, 2 szablony, instalator, kopia i przywracanie, testy
- [ ] **Etap 2:** Prism Studio, czyli aplikacja do tworzenia motywu z podglądem na żywo
- [ ] **Etap 3:** własny pasek górny (zegar, pulpity GlazeWM, media, menu)
- [ ] **Etap 4:** automatyczne ustawianie modów Windhawk, kursory, ikony, dźwięki
- [ ] **Etap 5:** galeria motywów od społeczności

## Licencja

MIT. Zobacz [LICENSE](LICENSE).
