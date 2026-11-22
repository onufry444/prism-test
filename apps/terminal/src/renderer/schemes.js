'use strict';
// Terminal color schemes. Palettes from their open-source projects (Tokyo Night, Catppuccin, Gruvbox, Nord, Dracula, Solarized, Rosé Pine, One Dark).
window.PRISM_SCHEMES = (() => {
  const s = (name, bg, fg, accent, n, b) => ({ name, background: bg, foreground: fg, accent,
    black: n[0], red: n[1], green: n[2], yellow: n[3], blue: n[4], magenta: n[5], cyan: n[6], white: n[7],
    brightBlack: b[0], brightRed: b[1], brightGreen: b[2], brightYellow: b[3], brightBlue: b[4], brightMagenta: b[5], brightCyan: b[6], brightWhite: b[7] });
  return {
    prism: s('Prism', '#11131a', '#e6e6ea', '#8ab4ff', ['#1b1e28', '#ff6b7f', '#7ee0b5', '#ffd27a', '#8ab4ff', '#c792ea', '#78dce8', '#c9cbd6'], ['#5c6178', '#ff8fa0', '#a6f0cf', '#ffe2a6', '#b0ccff', '#dcb6f2', '#a4ecf4', '#ffffff']),
    tokyo: s('Tokyo Night', '#1a1b26', '#c0caf5', '#7aa2f7', ['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6'], ['#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']),
    catppuccin: s('Catppuccin Mocha', '#1e1e2e', '#cdd6f4', '#cba6f7', ['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de'], ['#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']),
    gruvbox: s('Gruvbox', '#282828', '#ebdbb2', '#fabd2f', ['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984'], ['#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
    nord: s('Nord', '#2e3440', '#d8dee9', '#88c0d0', ['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0'], ['#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
    dracula: s('Dracula', '#282a36', '#f8f8f2', '#bd93f9', ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2'], ['#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
    rosepine: s('Rosé Pine', '#191724', '#e0def4', '#c4a7e7', ['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4'], ['#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4']),
    onedark: s('One Dark', '#282c34', '#abb2bf', '#61afef', ['#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'], ['#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
    'solarized-light': s('Solarized Light', '#fdf6e3', '#657b83', '#268bd2', ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5'], ['#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3']),
    paper: s('Paper', '#f6f3ec', '#2a2622', '#c2410c', ['#2a2622', '#c4302b', '#2f7d32', '#9a6b00', '#1f5fbf', '#8e3fae', '#0f7c86', '#6b6560'], ['#8a847c', '#e04a3f', '#3a9a3e', '#b38200', '#2f74d8', '#a957c9', '#1a96a1', '#2a2622'])
  };
})();
