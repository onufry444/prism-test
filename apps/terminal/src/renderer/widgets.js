'use strict';
// Things programs can show in a pane through the Prism API (see src/api.js): images, charts, buttons,
// forms, a title. Images and charts are drawn over blank lines the program prints, and scroll with the text.
{
const P = window.Prism, { api, esc } = P;
const pending = new Map(); // pane id -> [{ cancel() }]

// the size of one character cell in pixels
function cell(pane) {
  const screen = pane.el.querySelector('.xterm-screen');
  const w = screen ? screen.clientWidth / pane.term.cols : 9, h = screen ? screen.clientHeight / pane.term.rows : 18;
  return { w: w || 9, h: h || 18 };
}
// wait until the program's last output has reached the screen, so the picture lands below it
function settled(pane) {
  return new Promise(res => {
    const check = () => (Date.now() - (pane.lastData || 0) > 60 ? res() : setTimeout(check, 30));
    setTimeout(check, 30);
  });
}
// a box `rows` high from the cursor line down, anchored to the text
function place(pane, cols, rows, build) {
  const term = pane.term, marker = term.registerMarker(0);
  if (!marker) return null;
  const x = term.buffer.active.cursorX;
  const deco = term.registerDecoration({ marker, x, width: Math.max(1, Math.min(cols, term.cols - x)), height: rows, layer: 'top' });
  if (!deco) { marker.dispose(); return null; }
  deco.onRender(el => { if (!el.dataset.built) { el.dataset.built = '1'; el.classList.add('pwidget'); build(el); } });
  return deco;
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('the image could not be decoded')); i.src = src; });
}

async function image(pane, req) {
  const img = await loadImage(req.src), c = cell(pane), term = pane.term;
  const maxCols = term.cols - 1, maxRows = Math.max(3, term.rows - 2);
  let cols = req.width || Math.min(maxCols, Math.ceil(img.naturalWidth / c.w));
  let rows = req.height || Math.ceil((cols * c.w) * img.naturalHeight / Math.max(1, img.naturalWidth) / c.h);
  if (!req.height && rows > maxRows) { rows = maxRows; if (!req.width) cols = Math.min(maxCols, Math.ceil(rows * c.h * img.naturalWidth / Math.max(1, img.naturalHeight) / c.w)); }
  cols = Math.max(1, Math.min(maxCols, cols)); rows = Math.max(1, rows);
  await settled(pane);
  place(pane, cols, rows, el => {
    const i = document.createElement('img');
    i.src = req.src; i.alt = req.name || 'image'; i.title = req.name || '';
    el.appendChild(i);
  });
  return { rows, cols };
}

// line and bar charts, drawn as SVG in the terminal's colors
function chartSvg(req, wpx, hpx) {
  const pal = P.palette(), colors = [pal.accent, pal.green, pal.yellow, pal.magenta, pal.cyan, pal.red, pal.blue, pal.brightWhite];
  const all = req.series.flatMap(s => s.values).filter(v => v !== null);
  let lo = Math.min(0, ...all), hi = Math.max(...all);
  if (hi === lo) hi = lo + 1;
  const n = Math.max(...req.series.map(s => s.values.length)), top = req.title ? 26 : 10, left = 46, right = 12, bottom = req.labels.length ? 24 : 12;
  const W = wpx - left - right, H = hpx - top - bottom;
  const X = i => left + (n <= 1 ? W / 2 : (req.type === 'bar' ? (i + 0.5) * W / n : i * W / (n - 1)));
  const Y = v => top + H - (v - lo) / (hi - lo) * H;
  const fmt = v => Math.abs(v) >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(+v.toFixed(2));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx}" font-family="Segoe UI, system-ui, sans-serif" font-size="11" fill="${pal.foreground}">`;
  if (req.title) svg += `<text x="${left}" y="16" font-size="13" font-weight="600">${esc(req.title)}</text>`;
  for (let k = 0; k <= 4; k++) {
    const v = lo + (hi - lo) * k / 4, y = Y(v);
    svg += `<line x1="${left}" x2="${left + W}" y1="${y}" y2="${y}" stroke="${pal.foreground}" stroke-opacity=".12"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" opacity=".6">${fmt(v)}</text>`;
  }
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(W / 60))));
  req.labels.forEach((l, i) => { if (i % every === 0 && i < n) svg += `<text x="${X(i)}" y="${top + H + 16}" text-anchor="middle" opacity=".6">${esc(l)}</text>`; });
  req.series.forEach((s, si) => {
    const col = colors[si % colors.length];
    if (req.type === 'bar') {
      const bw = Math.max(1, W / n / req.series.length * 0.8);
      s.values.forEach((v, i) => { if (v === null) return; const x = X(i) - bw * req.series.length / 2 + si * bw, y0 = Y(Math.max(0, lo)), y = Y(v); svg += `<rect x="${x}" y="${Math.min(y, y0)}" width="${bw - 1}" height="${Math.abs(y0 - y)}" rx="2" fill="${col}"/>`; });
    } else {
      const pts = s.values.map((v, i) => (v === null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean);
      svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`;
    }
  });
  if (req.series.length > 1) req.series.forEach((s, si) => { svg += `<rect x="${left + si * 110}" y="${hpx - 10}" width="9" height="9" rx="2" fill="${colors[si % colors.length]}"/><text x="${left + si * 110 + 13}" y="${hpx - 2}" opacity=".8">${esc(s.name)}</text>`; });
  return svg + '</svg>';
}
async function chart(pane, req) {
  const c = cell(pane), cols = pane.term.cols - 1, rows = Math.min(req.height, Math.max(4, pane.term.rows - 2));
  const svg = chartSvg(req, Math.floor(cols * c.w), Math.floor(rows * c.h));
  await settled(pane);
  place(pane, cols, rows, el => { const i = document.createElement('img'); i.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg))); el.appendChild(i); });
  return { rows, cols };
}

// buttons on the current line; answered by a click, or the keys 1-9 / arrows + Enter
function choose(pane, req) {
  return settled(pane).then(() => new Promise(resolve => {
    let sel = 0, done = false, root = null;
    const paint = () => root && root.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', i === sel));
    const finish = i => {
      if (done) return; done = true;
      pane.widgetKeys = null;
      if (root) { root.classList.add('done'); root.querySelectorAll('button').forEach((b, k) => { b.disabled = true; b.classList.toggle('chosen', k === i); }); }
      resolve(i < 0 ? { cancelled: true } : { choice: req.options[i], index: i });
    };
    const width = Math.min(pane.term.cols, req.options.reduce((a, o) => a + o.length + 6, (req.prompt || '').length + 2));
    place(pane, width, 1, el => {
      root = document.createElement('div'); root.className = 'pchoose';
      root.innerHTML = (req.prompt ? `<span>${esc(req.prompt)}</span>` : '') + req.options.map((o, i) => `<button data-i="${i}">${i < 9 ? `<kbd>${i + 1}</kbd>` : ''}${esc(o)}</button>`).join('');
      root.addEventListener('mousedown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); finish(+b.dataset.i); } });
      el.appendChild(root); paint();
    });
    pane.widgetKeys = e => {
      if (/^[1-9]$/.test(e.key) && +e.key <= req.options.length) finish(+e.key - 1);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') { sel = (sel + 1) % req.options.length; paint(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { sel = (sel - 1 + req.options.length) % req.options.length; paint(); }
      else if (e.key === 'Enter') finish(sel);
      else if (e.key === 'Escape' || (e.ctrlKey && e.key === 'c')) finish(-1);
      return false;
    };
    (pending.get(pane.id) || pending.set(pane.id, []).get(pane.id)).push({ cancel: () => finish(-1) });
  }));
}

// a form over the pane; Enter submits, Esc cancels
function form(pane, req) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'pform';
    box.innerHTML = `<form><h3>${esc(req.title)}</h3>${req.fields.map((f, i) => {
      const id = `pf${i}`, v = esc(f.value ?? '');
      if (f.type === 'checkbox') return `<label class="ck"><input type="checkbox" id="${id}" ${f.value ? 'checked' : ''}> ${esc(f.label)}</label>`;
      if (f.type === 'select') return `<label for="${id}">${esc(f.label)}</label><select id="${id}">${f.options.map(o => `<option ${String(o) === String(f.value) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      return `<label for="${id}">${esc(f.label)}</label><input id="${id}" type="${f.type}" value="${v}" autocomplete="off" spellcheck="false">`;
    }).join('')}<div class="pfb"><button type="button" class="btn ghost" data-a="cancel">Cancel</button><button class="btn" type="submit">${esc(req.submit)}</button></div></form>`;
    let done = false;
    const finish = values => {
      if (done) return; done = true;
      box.remove(); pane.term.focus();
      resolve(values ? { values } : { cancelled: true });
    };
    box.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const values = {};
      req.fields.forEach((f, i) => { const el = box.querySelector(`#pf${i}`); values[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; });
      finish(values);
    });
    box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') finish(null); });
    box.querySelector('[data-a=cancel]').addEventListener('click', () => finish(null));
    pane.el.appendChild(box);
    setTimeout(() => box.querySelector('input,select')?.focus(), 30);
    (pending.get(pane.id) || pending.set(pane.id, []).get(pane.id)).push({ cancel: () => finish(null) });
  });
}

api.onApiRequest(async ({ rid, pane: id, op, payload }) => {
  const pane = P.paneById(id);
  try {
    if (!pane) throw new Error('the pane is closed');
    let r;
    if (op === 'title') { pane.title = payload.text || pane.title; P.renderTabs(); r = {}; }
    else if (op === 'image') r = await image(pane, payload);
    else if (op === 'chart') r = await chart(pane, payload);
    else if (op === 'choose') r = await choose(pane, payload);
    else if (op === 'form') r = await form(pane, payload);
    else throw new Error('unknown request');
    api.apiReply(rid, r);
  } catch (e) { api.apiReply(rid, null, e.message); }
});
api.onProgress(({ pane: id, value, state }) => {
  const pane = P.paneById(id); if (!pane) return;
  pane.progress = value === null ? null : { value, state };
  P.renderTabs();
});
// pictures printed by programs with the iTerm2 protocol (ESC ] 1337 ; File=...:<base64> BEL), where it gets through
P.on('pane', pane => {
  pane.term.parser.registerOscHandler(1337, data => {
    const m = /^File=([^:]*):(.*)$/s.exec(data); if (!m) return false;
    const args = Object.fromEntries(m[1].split(';').map(kv => kv.split('=')));
    if (args.inline !== '1') return true;
    const bytes = atob(m[2].slice(0, 8));
    const type = bytes.startsWith('\x89PNG') ? 'image/png' : bytes.startsWith('\xff\xd8') ? 'image/jpeg' : bytes.startsWith('GIF') ? 'image/gif' : 'image/png';
    const num = v => (/^\d+$/.test(v || '') ? +v : null);
    image(pane, { src: `data:${type};base64,${m[2]}`, width: num(args.width), height: num(args.height), name: args.name ? atob(args.name) : '' }).catch(() => {});
    return true;
  });
});
P.on('pane-closed', pane => { for (const p of pending.get(pane.id) || []) p.cancel(); pending.delete(pane.id); });
}
