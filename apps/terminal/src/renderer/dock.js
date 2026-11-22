'use strict';
// Prism dock: pinned and running apps, macOS-style magnification, optional auto-hide.
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let cfg = { dock: { iconSize: 48, magnification: 1.6, autohide: false, labels: true } }, items = [];
const dock = $('#dock');

function render() {
  const pinned = items.filter(i => i.pinned), others = items.filter(i => !i.pinned);
  const html = i => `<button class="item${i.running ? ' running' : ''}${i.focused ? ' focused' : ''}" data-key="${esc(i.key)}" aria-label="${esc(i.name)}">
      ${i.iconUrl ? `<img src="${i.iconUrl}" alt="">` : `<span class="ph">${esc((i.name || '?').charAt(0))}</span>`}
      <span class="dot"></span><span class="tip">${esc(i.name)}${i.count > 1 ? ` · ${i.count}` : ''}</span></button>`;
  dock.innerHTML = pinned.map(html).join('') + (others.length ? '<span class="sep"></span>' + others.map(html).join('') : '');
  size(null);
}
function size(mouseX) {
  const base = cfg.dock.iconSize, mag = Math.max(1, cfg.dock.magnification || 1), range = base * 2.6;
  for (const el of dock.querySelectorAll('.item')) {
    let s = base;
    if (mouseX !== null && mag > 1) {
      const r = el.getBoundingClientRect(), d = Math.abs(mouseX - (r.left + r.width / 2));
      s = base * (1 + (mag - 1) * Math.max(0, Math.cos(Math.min(1, d / range) * Math.PI / 2)));
    }
    el.style.width = el.style.height = s + 'px';
  }
}
dock.addEventListener('mousemove', e => size(e.clientX));
dock.addEventListener('mouseenter', () => { desk.mouse(true); show(true); });
dock.addEventListener('mouseleave', () => { desk.mouse(false); size(null); if (cfg.dock.autohide) hideSoon(); });
dock.addEventListener('click', e => { const b = e.target.closest('.item'); if (b) desk.activate(b.dataset.key); });
dock.addEventListener('contextmenu', e => { e.preventDefault(); const b = e.target.closest('.item'); if (b) desk.menu(b.dataset.key); });

// auto-hide: a thin strip at the bottom edge brings the dock back
let hideT;
function show(v) { clearTimeout(hideT); document.body.classList.toggle('hidden', !v); }
function hideSoon() { clearTimeout(hideT); hideT = setTimeout(() => show(false), 700); }
document.addEventListener('mousemove', e => { if (cfg.dock.autohide && e.clientY >= window.innerHeight - 4) show(true); });

desk.onConfig(({ config, css }) => {
  cfg = config;
  document.documentElement.style.setProperty('--size', cfg.dock.iconSize + 'px');
  const c = cfg.terminal.colors || {};
  if (c.accent) document.documentElement.style.setProperty('--ac', c.accent);
  document.body.classList.toggle('nolabels', !cfg.dock.labels);
  $('#user-css').textContent = css || '';
  if (cfg.dock.autohide) hideSoon(); else show(true);
  size(null);
});
desk.onItems(list => { items = list; render(); });
desk.onBounce(key => { const el = dock.querySelector(`[data-key="${CSS.escape(key)}"]`); if (el) { el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce'); } });
}
