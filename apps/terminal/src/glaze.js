'use strict';
// GlazeWM client: workspaces for the menu bar, over GlazeWM's WebSocket IPC (ws://127.0.0.1:6123).
// Protocol: send "query workspaces", "sub -e workspace_activated ...", "command focus --workspace 2";
// replies are JSON { messageType: 'client_response' | 'event_subscription', data, success }.
const EventEmitter = require('events');

class Glaze extends EventEmitter {
  constructor() {
    super();
    this.ws = null; this.timer = null; this.workspaces = []; this.connected = false; this.stopped = true;
  }
  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; clearTimeout(this.timer); try { this.ws?.close(); } catch {} this.ws = null; this.setConnected(false); }
  setConnected(v) { if (this.connected !== v) { this.connected = v; this.emit('state', v); } }
  connect() {
    if (this.stopped || typeof WebSocket === 'undefined') return;
    let ws;
    try { ws = new WebSocket('ws://127.0.0.1:6123'); } catch { return this.retry(); }
    this.ws = ws;
    ws.onopen = () => { this.setConnected(true); ws.send('sub -e workspace_activated workspace_deactivated workspace_updated focus_changed window_managed window_unmanaged'); this.query(); };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
      if (m.messageType === 'client_response' && /^query workspaces/.test(m.clientMessage || '') && m.success) {
        this.workspaces = (m.data?.workspaces || []).map(w => ({ name: w.name, label: w.displayName || w.name, focused: !!w.hasFocus, displayed: !!w.isDisplayed, windows: (w.children || []).length }));
        this.emit('workspaces', this.workspaces);
      } else if (m.messageType === 'event_subscription') this.query();
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.setConnected(false); this.retry(); } };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  retry() { clearTimeout(this.timer); if (!this.stopped) this.timer = setTimeout(() => this.connect(), 3000); }
  query() { clearTimeout(this.q); this.q = setTimeout(() => { try { this.ws?.send('query workspaces'); } catch {} }, 40); }
  send(cmd) { try { if (this.ws && this.ws.readyState === 1) { this.ws.send(cmd); return true; } } catch {} return false; }
  focusWorkspace(name) { return this.send(`command focus --workspace ${String(name).replace(/[^\w.-]/g, '')}`); }
}

module.exports = { Glaze };
