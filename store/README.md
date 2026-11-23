# Prism theme store

The themes you see in **Settings › Appearance › Theme store** live here. Anyone can add one.

## Add your theme

1. In Prism, set up colors you like, then press **Share my colors** in Settings › Appearance. Prism copies your theme as JSON.
2. On GitHub, open the `store/themes` folder of this repository and choose **Add file › Create new file**.
3. Name the file after your theme in lowercase with dashes, for example `my-theme.json`, and paste.
4. Fill in `name` and `author`.
5. Add your theme to `store/index.json`: copy one entry, change `id` (the file name without `.json`), `name`, `author` and `description`, and paste your colors as `preview`.
6. Propose the change. When it is merged, everyone can install your theme.

## Theme file

```json
{
  "name": "My theme",
  "author": "you",
  "colors": {
    "background": "#101418", "foreground": "#e6e6e6", "accent": "#7aa2f7", "cursor": "#7aa2f7", "selection": "#2a3550",
    "black": "#1c2128", "red": "#f7768e", "green": "#9ece6a", "yellow": "#e0af68", "blue": "#7aa2f7", "magenta": "#bb9af7", "cyan": "#7dcfff", "white": "#c0caf5",
    "brightBlack": "#545c7e", "brightRed": "#ff8fa3", "brightGreen": "#b5e48c", "brightYellow": "#f2c97d", "brightBlue": "#9ab8ff", "brightMagenta": "#cdb4ff", "brightCyan": "#a5e3ff", "brightWhite": "#ffffff"
  }
}
```

Every color is `#rrggbb`. `background` and `foreground` are required; missing colors fall back to the built-in scheme.

You can also keep themes just for yourself: put the file in `~/.config/prism/themes/`, and it shows up in Settings at once.
