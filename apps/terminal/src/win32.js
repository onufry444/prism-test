'use strict';
// Small Windows API layer (via koffi) for the dock and menu bar:
// listing app windows, focusing/minimizing them, the taskbar auto-hide state and the desktop work area.
// Everything is loaded lazily and fails soft: on other systems, or if a call is missing, functions return null/[].
let api = null;
function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll'), dwmapi = koffi.load('dwmapi.dll'), shell32 = koffi.load('shell32.dll');
    const RECT = koffi.struct('PRISM_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const APPBARDATA = koffi.struct('PRISM_APPBARDATA', { cbSize: 'uint32', hWnd: 'intptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr' });
    const EnumProc = koffi.proto('bool __stdcall PrismEnumProc(intptr hwnd, intptr lParam)');
    koffi.struct('PRISM_WCA', { Attrib: 'int32', pvData: 'void *', cbData: 'size_t' });
    api = {
      koffi, RECT, APPBARDATA,
      EnumWindows: user32.func('bool __stdcall EnumWindows(PrismEnumProc *cb, intptr lParam)'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr hwnd, _Out_ uint16 *buf, int max)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hwnd, _Out_ uint16 *buf, int max)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hwnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr hwnd)'),
      IsZoomed: user32.func('bool __stdcall IsZoomed(intptr hwnd)'),
      GetWindow: user32.func('intptr __stdcall GetWindow(intptr hwnd, uint32 cmd)'),
      GetWindowLongPtrW: user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hwnd, _Out_ uint32 *pid)'),
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr hwnd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr hwnd, int cmd)'),
      PostMessageW: user32.func('bool __stdcall PostMessageW(intptr hwnd, uint32 msg, uintptr wp, intptr lp)'),
      FindWindowW: user32.func('intptr __stdcall FindWindowW(str16 cls, str16 title)'),
      SystemParametersInfoW: user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Inout_ PRISM_RECT *rect, uint32 winini)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 vk, uint8 scan, uint32 flags, uintptr extra)'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr h)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)'),
      DwmGetWindowAttribute: dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, _Out_ int32 *value, uint32 size)'),
      SHAppBarMessage: shell32.func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ PRISM_APPBARDATA *data)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr hwnd, _Out_ PRISM_RECT *rect)'),
      SetWindowCompositionAttribute: user32.func('bool __stdcall SetWindowCompositionAttribute(intptr hwnd, PRISM_WCA *data)')
    };
  } catch (e) {
    api = false;
    console.error('Prism: Windows API unavailable:', e.message);
  }
  return api;
}

const str16 = (fn, hwnd) => { const b = Buffer.alloc(1024); const n = fn(hwnd, b, 512); return n > 0 ? b.toString('utf16le', 0, n * 2) : ''; };
const exeCache = new Map();
function exePath(pid) {
  const a = load(); if (!a) return '';
  if (exeCache.has(pid)) return exeCache.get(pid);
  let p = '';
  const h = a.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (h) {
    const b = Buffer.alloc(2048), size = [1024];
    if (a.QueryFullProcessImageNameW(h, 0, b, size)) p = b.toString('utf16le', 0, size[0] * 2);
    a.CloseHandle(h);
  }
  if (exeCache.size > 500) exeCache.clear();
  exeCache.set(pid, p);
  return p;
}

const SKIP_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'Windows.UI.Core.CoreWindow', 'ApplicationManager_ImmersiveShellWindow', 'XamlExplorerHostIslandWindow', 'TopLevelWindowForOverflowXamlIsland', 'ForegroundStaging', 'MultitaskingViewFrame', 'tooltips_class32', 'Xaml_WindowedPopupClass']);
// Same rules as Alt+Tab: visible, not cloaked, top-level, not a tool window, has a title.
function listWindows(ignore = new Set()) {
  const a = load(); if (!a) return [];
  const out = [];
  const fg = Number(a.GetForegroundWindow());
  const val = [0];
  a.EnumWindows((hwnd) => {
    try {
      hwnd = Number(hwnd);
      if (ignore.has(hwnd) || !a.IsWindowVisible(hwnd)) return true;
      if (Number(a.GetWindow(hwnd, 4))) return true; // GW_OWNER
      const ex = Number(a.GetWindowLongPtrW(hwnd, -20)); // GWL_EXSTYLE
      if ((ex & 0x80) && !(ex & 0x40000)) return true; // WS_EX_TOOLWINDOW without WS_EX_APPWINDOW
      if (ex & 0x08000000) return true; // WS_EX_NOACTIVATE
      if (a.DwmGetWindowAttribute(hwnd, 14, val, 4) === 0 && val[0]) return true; // DWMWA_CLOAKED
      const cls = str16(a.GetClassNameW, hwnd);
      if (SKIP_CLASSES.has(cls)) return true;
      const title = str16(a.GetWindowTextW, hwnd);
      if (!title) return true;
      const pid = [0]; a.GetWindowThreadProcessId(hwnd, pid);
      out.push({ hwnd, title, cls, pid: pid[0], exe: exePath(pid[0]), minimized: !!a.IsIconic(hwnd), focused: hwnd === fg });
    } catch {}
    return true;
  }, 0);
  return out;
}

function focus(hwnd) {
  const a = load(); if (!a) return false;
  if (a.IsIconic(hwnd)) a.ShowWindow(hwnd, 9); // SW_RESTORE
  // Windows only lets the foreground process change focus; a synthetic Alt press satisfies that rule.
  a.keybd_event(0x12, 0, 0, 0); a.keybd_event(0x12, 0, 2, 0);
  return !!a.SetForegroundWindow(hwnd);
}
function minimize(hwnd) { const a = load(); return a ? !!a.ShowWindow(hwnd, 6) : false; }
function close(hwnd) { const a = load(); return a ? !!a.PostMessageW(hwnd, 0x0010, 0, 0) : false; }
function foreground() { const a = load(); return a ? Number(a.GetForegroundWindow()) : 0; }
function className(hwnd) { const a = load(); return a && hwnd ? str16(a.GetClassNameW, hwnd) : ''; }
// The desktop and the taskbar cover the whole screen but are never "full-screen apps".
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow']);
// A full-screen app (video, game, presentation) is in front on the primary monitor.
function fullscreenApp(own, bounds) {
  const fg = foreground(); if (!fg || own.has(fg)) return null;
  const cls = className(fg); if (SHELL_CLASSES.has(cls)) return null;
  if (load().IsZoomed(fg)) return null; // a maximized window is not a full-screen app
  const r = windowRect(fg);
  if (!r || r.left > bounds.left || r.top > bounds.top || r.right < bounds.right || r.bottom < bounds.bottom) return null;
  return { hwnd: fg, cls, rect: r };
}

// Taskbar auto-hide (ABM_GETSTATE / ABM_SETSTATE). Returns the previous state or null.
function taskbarAutohide(on) {
  const a = load(); if (!a) return null;
  const data = { cbSize: a.koffi.sizeof(a.APPBARDATA), hWnd: Number(a.FindWindowW('Shell_TrayWnd', null)), uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
  const prev = Number(a.SHAppBarMessage(4, data)); // ABM_GETSTATE
  if (on !== undefined) { data.lParam = (on ? 1 : 0) | (prev & 2); a.SHAppBarMessage(10, data); } // ABM_SETSTATE: ABS_AUTOHIDE=1, ABS_ALWAYSONTOP=2
  return !!(prev & 1);
}
// Primary monitor work area: the region maximized windows fill.
function getWorkArea() {
  const a = load(); if (!a) return null;
  const r = { left: 0, top: 0, right: 0, bottom: 0 };
  return a.SystemParametersInfoW(0x30, 0, r, 0) ? r : null; // SPI_GETWORKAREA
}
function setWorkArea(r) {
  const a = load(); if (!a) return false;
  return !!a.SystemParametersInfoW(0x2F, 0, { ...r }, 2); // SPI_SETWORKAREA, SPIF_SENDCHANGE
}

function windowRect(hwnd) {
  const a = load(); if (!a) return null;
  const r = {};
  return a.GetWindowRect(hwnd, r) ? r : null;
}
// Blur the desktop behind a transparent window (Windows 10/11). mode: 'blur' | 'acrylic' | 'off'.
// tint is ABGR, e.g. 0x01000000 = almost no tint (the page draws its own translucent background).
function blurBehind(hwnd, mode, tint = 0x01000000) {
  const a = load(); if (!a || !hwnd) return false;
  const accent = Buffer.alloc(16);
  accent.writeInt32LE(mode === 'acrylic' ? 4 : mode === 'blur' ? 3 : 0, 0); // ACCENT_ENABLE_ACRYLICBLURBEHIND / BLURBEHIND / DISABLED
  accent.writeInt32LE(mode === 'acrylic' ? 2 : 0, 4);
  accent.writeUInt32LE(tint >>> 0, 8);
  try { return !!a.SetWindowCompositionAttribute(hwnd, { Attrib: 19, pvData: accent, cbData: 16 }); } catch { return false; } // WCA_ACCENT_POLICY
}
// AppBar: tells Windows to reserve a screen edge for the window (like the taskbar does),
// so maximized windows and GlazeWM stay clear of it. rect is in physical pixels; returns the final rect.
function appbar(hwnd, edge, rect, register) {
  const a = load(); if (!a || !hwnd) return null;
  const data = { cbSize: a.koffi.sizeof(a.APPBARDATA), hWnd: hwnd, uCallbackMessage: 0x0401, uEdge: edge === 'top' ? 1 : 3, rc: { ...rect }, lParam: 0 };
  if (register) a.SHAppBarMessage(0, data); // ABM_NEW
  const h = rect.bottom - rect.top;
  a.SHAppBarMessage(2, data); // ABM_QUERYPOS: Windows may move the rect (e.g. next to another app bar)
  if (edge === 'top') data.rc.bottom = data.rc.top + h; else data.rc.top = data.rc.bottom - h;
  a.SHAppBarMessage(3, data); // ABM_SETPOS
  return { ...data.rc };
}
function appbarRemove(hwnd) {
  const a = load(); if (!a || !hwnd) return;
  a.SHAppBarMessage(1, { cbSize: a.koffi.sizeof(a.APPBARDATA), hWnd: hwnd, uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 }); // ABM_REMOVE
}
const hwndOf = win => { try { const b = win.getNativeWindowHandle(); return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0); } catch { return 0; } };

module.exports = { className, fullscreenApp, windowRect, blurBehind, hwndOf, appbar, appbarRemove, available: () => !!load(), listWindows, focus, minimize, close, foreground, taskbarAutohide, getWorkArea, setWorkArea, exePath };
