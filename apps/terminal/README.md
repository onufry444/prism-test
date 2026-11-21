# Szkło Terminal

To prawdziwy terminal: w środku działa PowerShell, cmd, bash albo zsh. Do tego dochodzi przezroczysty wygląd, który ustawiasz bez edytowania plików, i własne komendy, które klikasz w panelu albo dodajesz jednym poleceniem.

## Uruchomienie

Potrzebujesz [Node.js](https://nodejs.org) w wersji 20 lub nowszej.

```bash
cd apps/terminal
npm install
npm start
```

Żeby zbudować instalator (`.exe` na Windows, `.dmg` na macOS, `.AppImage` na Linux), wpisz:

```bash
npm run dist
```

Gotowy plik znajdziesz w folderze `dist/`.

## Wygląd

Panel ustawień otwierasz kółkiem zębatym albo skrótem **Ctrl+,**. Możesz tam ustawić:

- 6 gotowych motywów (Grafit, Szkło, Papier, Fosfor, Morze, Śliwka),
- krycie tła od 0 do 100%,
- kolory tła, tekstu i akcentu,
- paletę ANSI do ciemnego albo jasnego tła,
- czcionkę, rozmiar, wysokość linii, margines i zaokrąglenie okna,
- kursor (blok, kreska, podkreślenie) i jego miganie,
- **rozmycie pulpitu za oknem** (Windows 11 i macOS; zmiana działa po restarcie).

Wszystko zmienia się na żywo i zapisuje automatycznie.

## Własne komendy

Dodajesz je w zakładce **Komendy** albo prosto z terminala:

```bash
dodaj-komende hej "Cześć {1}, jest {time}"
dodaj-komende -u projekt "cd ~/projekty/strona; code ."
```

Są dwa rodzaje komend:

- **Wypisuje tekst** pokazuje tekst ze wstawionymi zmiennymi.
- **Uruchamia polecenia** uruchamia zwykłe polecenia Twojej powłoki. Oddzielasz je średnikiem albo nową linią.

W treści możesz używać zmiennych: `{1}`, `{2}` itd. to kolejne argumenty, `{args}` to wszystkie argumenty, a do tego `{date}`, `{time}` i `{user}`.

Aplikacja zamienia każdą komendę na prawdziwą funkcję powłoki. Dzięki temu działają potoki (`hej Ola | grep Ola`), przekierowania i podpowiedzi. W otwartych kartach PowerShell, bash i zsh nowa komenda pojawia się po następnym Enterze. W cmd pojawia się w nowej karcie.

Komendy aplikacji, które działają w każdej karcie:

| Komenda | Co robi |
|---|---|
| `komendy` | pokazuje listę Twoich komend |
| `motyw szklo` | zmienia motyw |
| `krycie 40` | ustawia przezroczystość |
| `czcionka 16` | ustawia rozmiar czcionki |
| `ustawienia` | otwiera panel |

Twoje własne pliki startowe (`.bashrc`, `.zshrc`, profil PowerShell) nadal się wczytują, więc nic Ci nie zniknie.

## Skróty

| Akcja | Windows / Linux | macOS |
|---|---|---|
| Nowa karta | Ctrl+Shift+T | Cmd+T |
| Zamknij kartę | Ctrl+Shift+W | Cmd+W |
| Przełącz kartę | Ctrl+Tab, Alt+1…9 | to samo |
| Kopiuj | Ctrl+Shift+C lub Ctrl+C z zaznaczeniem | Cmd+C |
| Wklej | Ctrl+V / Ctrl+Shift+V / prawy przycisk | Cmd+V |
| Czcionka +/− | Ctrl+= / Ctrl+− | Cmd+= / Cmd+− |

Strzałka obok „+” pozwala wybrać powłokę dla nowej karty (np. cmd, Git Bash, WSL).

## Jak to jest zbudowane

- `src/main.js` to okno, uruchamianie powłok (node-pty) i zapis ustawień.
- `src/commands.js` zamienia Twoje komendy na pliki startowe dla bash, zsh, PowerShell i cmd.
- `src/renderer/` to wygląd: karty, terminal (xterm.js) i panel ustawień.

Ustawienia leżą w folderze danych aplikacji, w pliku `settings.json` (na Windows to `%APPDATA%\Szkło Terminal`).

## Znane ograniczenia

- W WSL, fish i innych powłokach terminal działa normalnie, ale własne komendy jeszcze się tam nie wczytują.
- W cmd nie ma komend aplikacji (`motyw`, `krycie` itd.), są tylko Twoje komendy.
- Jeśli `npm install` zgłosi błąd przy `@lydell/node-pty`, zamień w `package.json` tę paczkę na `node-pty`. W `src/main.js` zmień wtedy `require('@lydell/node-pty')` na `require('node-pty')` i dodaj krok `npx electron-rebuild`.

Test generatora komend uruchomisz poleceniem `npm test` (potrzebny bash).
