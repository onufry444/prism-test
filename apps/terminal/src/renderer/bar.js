'use strict';
// Prism menu bar: modules are listed in config.bar.left/center/right.
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const I = {
  cpu: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/></svg>',
  memory: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 17v3M10 17v3M14 17v3M18 17v3"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2 8.8a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg>',
  off: '<svg viewBox="0 0 24 24"><path d="M2 2l20 20M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M5 12.5a10 10 0 0 1 5.2-2.7"/></svg>'
};
let cfg = null, stats = { cpu: 0, mem: 0, app: null, workspaces: [], glaze: false }, battery = null;

function fmtDate(d, f) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p = n => String(n).padStart(2, '0');
  return f.replace(/dddd|ddd|dd|d|MMMM|MMM|MM|M|yyyy|HH|H|hh|h|mm|ss|tt/g, t => ({
    dddd: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()], ddd: days[d.getDay()], dd: p(d.getDate()), d: d.getDate(),
    MMMM: d.toLocaleString('en', { month: 'long' }), MMM: months[d.getMonth()], MM: p(d.getMonth() + 1), M: d.getMonth() + 1, yyyy: d.getFullYear(),
    HH: p(d.getHours()), H: d.getHours(), hh: p(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12, mm: p(d.getMinutes()), ss: p(d.getSeconds()), tt: d.getHours() < 12 ? 'AM' : 'PM'
  }[t]));
}
const gb = b => (b / 1073741824).toFixed(1);
const MODULES = {
  menu: () => `<button class="mod" data-act="menu" title="Prism"><span class="logo"></span></button>`,
  workspaces: () => stats.glaze && stats.workspaces.length ? `<div class="wss">${stats.workspaces.map(w => `<button class="ws${w.focused ? ' on' : ''}${w.windows ? ' has' : ''}" data-ws="${esc(w.name)}">${esc(w.label)}</button>`).join('')}</div>` : '',
  app: () => stats.app ? `<span class="mod app"><b>${esc(stats.app.name)}</b>${stats.app.title && stats.app.title !== stats.app.name ? `<span>${esc(stats.app.title)}</span>` : ''}</span>` : '',
  clock: () => `<button class="mod clock" data-open="clock">${esc(fmtDate(new Date(), cfg.bar.clockFormat || 'ddd d MMM  HH:mm'))}</button>`,
  date: () => `<span class="mod num">${esc(fmtDate(new Date(), 'yyyy-MM-dd'))}</span>`,
  cpu: () => `<button class="mod" data-open="cpu" title="CPU">${I.cpu}<span class="meter"><i style="width:${stats.cpu}%"></i></span><span class="num">${stats.cpu}%</span></button>`,
  memory: () => `<button class="mod" data-open="memory" title="Memory ${gb(stats.memUsed || 0)} / ${gb(stats.memTotal || 0)} GB">${I.memory}<span class="num">${stats.mem}%</span></button>`,
  // desktops report a full, charging "battery" with chargingTime 0: hide it there
  battery: () => battery && !(battery.charging && battery.level === 1 && battery.chargingTime === 0) ? `<button class="mod${battery.level < .15 && !battery.charging ? ' warn' : ''}" data-open="battery">${battery.charging ? '⚡' : ''}<span class="num">${Math.round(battery.level * 100)}%</span></button>` : '',
  network: () => `<button class="mod" data-open="network" title="${navigator.onLine ? 'Online' : 'Offline'}">${navigator.onLine ? I.wifi : I.off}</button>`
};
function render() {
  if (!cfg) return;
  for (const side of ['left', 'center', 'right']) $('#' + side).innerHTML = (cfg.bar[side] || []).map(m => MODULES[m] ? MODULES[m]() : '').join('');
}
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'menu') desk.prismMenu();
  else if (b.dataset.ws) desk.workspace(b.dataset.ws);
  else if (b.dataset.open) desk.open(b.dataset.open);
});
desk.onConfig(({ config, css }) => {
  cfg = config;
  const c = cfg.terminal.colors || {};
  if (c.accent) document.documentElement.style.setProperty('--ac', c.accent);
  $('#user-css').textContent = css || '';
  render();
});
desk.onStats(s => { stats = { ...stats, ...s }; render(); });
desk.onWorkspaces(ws => { stats.workspaces = ws; stats.glaze = true; render(); });
setInterval(render, 15000);
if (navigator.getBattery) navigator.getBattery().then(b => { battery = b; for (const ev of ['levelchange', 'chargingchange']) b.addEventListener(ev, render); render(); }).catch(() => {});
addEventListener('online', render); addEventListener('offline', render);
}
