# Prism roadmap

## Planned (chosen in the November 2026 survey)

| # | Feature | What it means |
|---|---|---|
| 1 | **Prism API** | Libraries for Python and Node that let terminal programs show buttons, images, charts and forms in Prism. In other terminals the same programs still run, just without the extras. |
| 2 | **Split panes** | Several terminals side by side or stacked in one tab, like tmux. |
| 6 | **Images in the terminal** | Pictures and charts shown inline (kitty/iTerm2/sixel image protocols). |
| 7 | **Theme store** | Ready-made themes from other users, one click to install. |
| 9 | **SSH with saved servers** | A list of servers, connect with one click. |
| 11 | **Restore tabs** | Tabs, folders and history come back after Prism restarts. |
| 14 | **More toys** | bonsai, stars, aquarium, snake, `weather`, `cowsay`… |
| 19 | **Plugins** | Anyone can add their own feature to Prism. |

Suggested order: 11 → 2 → 14 → 1 + 6 + 19 (they share one foundation: programs and plugins talking to Prism) → 7 → 9.

## Later

- Command palette (Ctrl+Shift+P)
- AI suggestions: describe what you want, get a command; explanations of errors
- Command blocks (collapse, copy, share a command with its output)
- Settings sync between computers
- WSL as a first-class tab
- Completions for git, npm, docker, winget flags
- Package manager (winget, Scoop) in Settings
- More prompt segments, Starship style
- Recording a session as a GIF or video
- Quake mode (drop-down terminal)
- Polish translation of the interface
- Smaller download and faster start

## Done

- 0.4: Prism is a terminal only; administrator rights per command (`sudo`, ask before admin-only tools)
- 0.5: Prism as the default terminal of Windows, `prism run`, Explorer menu entries
- 0.6: toys: fetch, lava, matrix, pipes, donut, clock, visualizer
- 0.7: reliable installer, updates from Settings
