'use strict';
// Small Windows API layer (via koffi): window blur, the admin check, and the pipe client the elevated helper uses.
// Also undoes desktop changes made by Prism 0.3 (taskbar auto-hide, reserved screen space).
// Everything is loaded lazily and fails soft: on other systems, or if a call is missing, functions return null/false.
let api = null;
function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll'), kernel32 = koffi.load('kernel32.dll'), shell32 = koffi.load('shell32.dll');
    const RECT = koffi.struct('PRISM_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
    const APPBARDATA = koffi.struct('PRISM_APPBARDATA', { cbSize: 'uint32', hWnd: 'intptr', uCallbackMessage: 'uint32', uEdge: 'uint32', rc: RECT, lParam: 'intptr' });
    koffi.struct('PRISM_WCA', { Attrib: 'int32', pvData: 'void *', cbData: 'size_t' });
    api = {
      koffi, APPBARDATA,
      IsUserAnAdmin: shell32.func('bool __stdcall IsUserAnAdmin()'),
      SHAppBarMessage: shell32.func('uintptr __stdcall SHAppBarMessage(uint32 msg, _Inout_ PRISM_APPBARDATA *data)'),
      FindWindowW: user32.func('intptr __stdcall FindWindowW(str16 cls, str16 title)'),
      SystemParametersInfoW: user32.func('bool __stdcall SystemParametersInfoW(uint32 action, uint32 param, _Inout_ PRISM_RECT *rect, uint32 winini)'),
      SetWindowCompositionAttribute: user32.func('bool __stdcall SetWindowCompositionAttribute(intptr hwnd, PRISM_WCA *data)'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr h, uint32 flags, _Out_ uint16 *buf, _Inout_ uint32 *size)'),
      CreateFileW: kernel32.func('intptr __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, intptr template)'),
      ReadFile: kernel32.func('bool __stdcall ReadFile(intptr h, void *buf, uint32 len, void *read, void *overlapped)'),
      WriteFile: kernel32.func('bool __stdcall WriteFile(intptr h, uint8 *buf, uint32 len, _Out_ uint32 *written, void *overlapped)'),
      GetNamedPipeServerProcessId: kernel32.func('bool __stdcall GetNamedPipeServerProcessId(intptr h, _Out_ uint32 *pid)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr h)')
    };
  } catch (e) {
    api = false;
    console.error('Prism: Windows API unavailable:', e.message);
  }
  return api;
}

// Is this process running with administrator rights?
function isElevated() { const a = load(); try { return a ? !!a.IsUserAnAdmin() : (typeof process.getuid === 'function' && process.getuid() === 0); } catch { return false; } }

function exePath(pid) {
  const a = load(); if (!a) return '';
  const h = a.OpenProcess(0x1000, false, pid); // PROCESS_QUERY_LIMITED_INFORMATION
  if (!h) return '';
  try {
    const b = Buffer.alloc(2048), size = [1024];
    return a.QueryFullProcessImageNameW(h, 0, b, size) ? b.toString('utf16le', 0, size[0] * 2) : '';
  } finally { a.CloseHandle(h); }
}

// Pipe client for the elevated helper. Opens an existing pipe and reports which process serves it,
// so the helper can make sure it talks to the Prism window that asked for it and nothing else.
function pipeOpen(name) {
  const a = load(); if (!a) throw new Error('Windows API unavailable');
  const h = Number(a.CreateFileW(name, 0xC0000000, 0, null, 3, 0, 0)); // GENERIC_READ|WRITE, OPEN_EXISTING
  if (!h || h === -1) throw new Error('could not open ' + name);
  const pid = [0];
  if (!a.GetNamedPipeServerProcessId(h, pid)) { a.CloseHandle(h); throw new Error('could not identify the pipe server'); }
  return {
    serverPid: pid[0],
    write(str) { const b = Buffer.from(str, 'utf8'), n = [0]; return !!a.WriteFile(h, b, b.length, n, null); },
    // calls back with a Buffer, or null when the pipe closes; runs on a worker thread so the event loop stays free
    readLoop(cb) {
      // plain buffers are handed to Windows as raw pointers, so they hold the result when the call returns
      const buf = Buffer.alloc(65536), got = Buffer.alloc(4);
      const next = () => a.ReadFile.async(h, buf, buf.length, got, null, (err, ok) => {
        if (err || !ok) return cb(null);
        cb(Buffer.from(buf.subarray(0, got.readUInt32LE(0)))); next();
      });
      next();
    },
    close() { try { a.CloseHandle(h); } catch {} }
  };
}

// Blur the desktop behind a transparent window (Windows 10/11). mode: 'blur' | 'acrylic' | 'off'.
function blurBehind(hwnd, mode, tint = 0x01000000) {
  const a = load(); if (!a || !hwnd) return false;
  const accent = Buffer.alloc(16);
  accent.writeInt32LE(mode === 'acrylic' ? 4 : mode === 'blur' ? 3 : 0, 0);
  accent.writeInt32LE(mode === 'acrylic' ? 2 : 0, 4);
  accent.writeUInt32LE(tint >>> 0, 8);
  try { return !!a.SetWindowCompositionAttribute(hwnd, { Attrib: 19, pvData: accent, cbData: 16 }); } catch { return false; }
}
const hwndOf = win => { try { const b = win.getNativeWindowHandle(); return b.length >= 8 ? Number(b.readBigUInt64LE(0)) : b.readUInt32LE(0); } catch { return 0; } };

// ---- undo Prism 0.3 desktop changes ----
function taskbarAutohide(on) {
  const a = load(); if (!a) return null;
  const data = { cbSize: a.koffi.sizeof(a.APPBARDATA), hWnd: Number(a.FindWindowW('Shell_TrayWnd', null)), uCallbackMessage: 0, uEdge: 0, rc: { left: 0, top: 0, right: 0, bottom: 0 }, lParam: 0 };
  const prev = Number(a.SHAppBarMessage(4, data));
  if (on !== undefined) { data.lParam = (on ? 1 : 0) | (prev & 2); a.SHAppBarMessage(10, data); }
  return !!(prev & 1);
}
function setWorkArea(r) { const a = load(); return a ? !!a.SystemParametersInfoW(0x2F, 0, { ...r }, 2) : false; }

module.exports = { available: () => !!load(), isElevated, exePath, pipeOpen, blurBehind, hwndOf, taskbarAutohide, setWorkArea };
