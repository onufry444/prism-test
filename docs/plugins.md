# Writing a Prism plugin

A plugin is a folder in `~/.config/prism/plugins/` with two files. Prism loads it at once (and again whenever you save), and its commands work in new tabs.

```
~/.config/prism/plugins/hello/
  plugin.json
  index.js
```

`plugin.json`:

```json
{ "name": "hello", "version": "1.0.0", "description": "Says hello", "author": "you", "main": "index.js" }
```

`index.js` adds any of these:

```js
module.exports = {
  // commands print text: return it, or call ctx.print()
  commands: {
    hello: async (ctx, args) => `Hello ${args[0] || 'world'}!\n`
  },
  // animations are drawn by Prism in the tab, like the built-in toys (q quits)
  animations: {
    blink: {
      fps: 4,
      init(screen, args, ctx) { this.on = false; },
      frame(screen, seconds) { screen.clear(); this.on = !this.on; if (this.on) screen.text(2, 1, 'blink', 0xffcc00); },
      key(k) {}
    }
  },
  // color schemes appear in Settings › Appearance
  schemes: {
    'my-colors': { name: 'My colors', background: '#101014', foreground: '#e0e0e0', accent: '#ff7a45' }
  }
};
```

- `ctx` for commands: `args`, `cwd` (the folder of the tab), `version` (Prism's), `print(text)`, `fetch(url, options)`.
- `screen` for animations: `cols`, `rows`, `clear()`, `set(x, y, char, color, background)`, `text(x, y, string, color)`. Colors are numbers like `0xRRGGBB`; `ctx.colors` has `rgb`, `hex`, `mix` and `ramp` to make them.
- Command and animation names: lowercase letters, digits and dashes. Names Prism already uses are skipped.

A complete example is in [`examples/plugins/hello`](../examples/plugins/hello): a greeting, a fire animation and a color scheme.

## Sharing

Put the folder in a GitHub repository (`plugin.json` at the top, or one folder below). Others install it with

```
prism plugin install your-name/your-repo
```

or in Settings › Plugins. `prism plugin list` and `prism plugin remove NAME` manage them.

Plugins run inside Prism with the user's rights, like any program. Keep them small and readable, so people can see what they do.
