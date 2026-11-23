# Prism API

Programs that run in a Prism pane can show more than text: pictures, charts, buttons and forms, progress on the tab and the taskbar, and Windows notifications. In any other terminal the same program still works, with a plain-text fallback.

## Libraries

Both are single files with no dependencies. Copy one into your project.

| Language | File | Import |
|---|---|---|
| Node.js | [`sdk/node/prism.js`](../sdk/node/prism.js) | `const prism = require('./prism')` |
| Python 3 | [`sdk/python/prism_terminal.py`](../sdk/python/prism_terminal.py) | `import prism_terminal as prism` |

```python
import prism_terminal as prism

prism.title("Build")
for i in range(0, 101, 10):
    prism.progress(i)
prism.progress(None)

prism.chart({"requests": [12, 18, 9, 30, 42, 38]}, labels=["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], title="This week")
prism.image("screenshot.png")

if prism.choose("Deploy now?", ["Yes", "No"]) == "Yes":
    login = prism.form("Server", [{"name": "user", "label": "User"}, {"name": "password", "label": "Password", "type": "password"}])
prism.notify("Done", "The build finished")
```

```js
const prism = require('./prism');
await prism.chart({ type: 'bar', title: 'Sizes', labels: ['a', 'b', 'c'], series: [{ name: 'KB', values: [120, 80, 200] }] });
const pick = await prism.choose('Which one?', ['first', 'second', 'third']);
```

| Function | What it does | Outside Prism |
|---|---|---|
| `available()` | true in a Prism pane | false |
| `image(path or bytes, width?, height?)` | shows a PNG, JPG, GIF, WebP, BMP or SVG; size in character cells (optional) | prints `[image: name]` |
| `chart(...)` | a line or bar chart in the terminal's colors | a text sparkline |
| `choose(prompt, options)` | buttons on the current line; click, or press 1–9, arrows and Enter | a numbered question |
| `form(title, fields, submit?)` | a form over the pane; fields `text`, `password`, `number`, `select`, `checkbox` | one question per field |
| `progress(0–100 or null, state?)` | a bar under the tab and on the taskbar button; state `normal`, `error`, `paused` | a percentage on stderr |
| `notify(title, body)` | a Windows notification | prints it and beeps |
| `title(text)` | the tab title | sets the title with an escape code |

From a shell, `imgcat picture.png` shows a picture (PowerShell, cmd and Git Bash).

## The protocol

For other languages: connect to the named pipe in the `PRISM_API` environment variable and send one JSON object per line. Prism answers each with one line.

```
→ {"id": 1, "tab": "<PRISM_TAB>", "op": "image", "path": "cat.png", "cwd": "C:\\Users\\me"}
← {"id": 1, "ok": true, "rows": 12, "cols": 40}
```

`tab` is the `PRISM_TAB` environment variable; it tells Prism which pane you are in. Images and charts are drawn starting at the cursor's line, so print `rows` newlines after the answer. Errors come back as `{"id": 1, "ok": false, "error": "..."}`.

| op | fields | answer |
|---|---|---|
| `hello` | | `version`, `ops` |
| `image` | `path` + `cwd`, or `data` (base64); `width`, `height` (cells) | `rows`, `cols` |
| `chart` | `type` (`line`/`bar`), `title`, `labels`, `series` [{`name`, `values`}], `height` | `rows`, `cols` |
| `choose` | `prompt`, `options` | `choice`, `index`, or `cancelled` |
| `form` | `title`, `fields` [{`name`, `label`, `type`, `options`, `value`}], `submit` | `values`, or `cancelled` |
| `progress` | `value` (0–100 or null), `state` | |
| `notify` | `title`, `body` | |
| `title` | `text` | |

Requests only change what Prism shows. None of them can type into a shell or run anything.
