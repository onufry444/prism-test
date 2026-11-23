// An example Prism plugin. Copy this folder to ~/.config/prism/plugins/hello and open a new tab:
//   hello Ada        prints a rainbow greeting
//   fire             a fire animation (q quits)
// and the "Ember" color scheme appears in Settings > Appearance.
module.exports = {
  commands: {
    // ctx: { args, cwd, version, print(text), fetch(url) }. Return text, or print it.
    hello: async (ctx, args) => {
      const name = args.join(' ') || 'there';
      const colors = [196, 208, 226, 46, 33, 129];
      const text = `Hello, ${name}! This is Prism ${ctx.version}.`;
      return [...text].map((c, i) => `\x1b[38;5;${colors[i % colors.length]}m${c}`).join('') + '\x1b[0m\n';
    }
  },
  animations: {
    // Drawn like the built-in toys. screen: { cols, rows, set(x, y, char, color, background), text(x, y, s, color), clear() }
    // ctx.colors: { rgb(r, g, b), hex('#rrggbb'), mix(a, b, t), ramp([colors], t) }
    fire: {
      fps: 24,
      init(screen, args, ctx) { this.c = ctx.colors; this.heat = []; },
      frame(screen) {
        const W = screen.cols, H = screen.rows * 2, { ramp, hex } = this.c;
        if (this.heat.length !== W * H) this.heat = new Array(W * H).fill(0);
        const h = this.heat;
        for (let x = 0; x < W; x++) h[(H - 1) * W + x] = Math.random() < 0.6 ? 1 : 0.3;
        for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
          const below = h[(y + 1) * W + Math.min(W - 1, Math.max(0, x + ((Math.random() * 3) | 0) - 1))];
          h[y * W + x] = Math.max(0, below - Math.random() * 0.09);
        }
        const pal = [hex('#000000'), hex('#5a0a00'), hex('#c42b00'), hex('#ff8a00'), hex('#ffe08a'), hex('#ffffff')];
        for (let y = 0; y < screen.rows; y++) for (let x = 0; x < W; x++) {
          screen.set(x, y, '▀', ramp(pal, h[(y * 2) * W + x]), ramp(pal, h[(y * 2 + 1) * W + x]));
        }
      }
    }
  },
  schemes: {
    ember: {
      name: 'Ember', background: '#1a0f0d', foreground: '#f2d7c9', accent: '#ff7a45', cursor: '#ff7a45', selection: '#5a2e22',
      black: '#2a1a16', red: '#ff5c57', green: '#9bd35b', yellow: '#ffc65c', blue: '#6fa8ff', magenta: '#e58fd6', cyan: '#6fd6c9', white: '#e8d3c8',
      brightBlack: '#6b4d43', brightRed: '#ff7f7a', brightGreen: '#b6e27e', brightYellow: '#ffd88a', brightBlue: '#98c1ff', brightMagenta: '#f0b0e4', brightCyan: '#93e6dc', brightWhite: '#fff4ee'
    }
  }
};
