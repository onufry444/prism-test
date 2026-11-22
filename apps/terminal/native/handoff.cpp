// prism-handoff.exe — makes Prism the default terminal on Windows.
//
// How Windows opens a console app (double-click, Win+R, Start menu):
//   conhost.exe ─(IConsoleHandoff)─▶ the console host in HKCU\Console\%%Startup\DelegationConsole
//                                   (Windows Terminal's OpenConsole.exe; it does the VT translation)
//   OpenConsole ─(ITerminalHandoff)─▶ the terminal in DelegationTerminal = this COM server
// We get the console's pipes and relay them to the running Prism (starting it if needed), which shows
// the app in a tab. If anything here fails, Windows falls back to the classic console window.
//
// Wire format between this helper and Prism (named pipe \\.\pipe\prism-handoff-<user>):
//   frame = [type: u8][length: u32 little-endian][payload]
//   helper -> Prism: 1 hello (JSON), 2 output (bytes), 3 exit (JSON {"code":N})
//   Prism -> helper: 1 input (bytes), 2 resize (u16 cols, u16 rows), 3 close
//
// Troubleshooting: set the HandoffLog value under HKCU\Software\Prism to a file path.
// Build (MSVC): cl /nologo /O2 /EHsc /std:c++17 /DUNICODE /D_UNICODE handoff.cpp /link ole32.lib oleaut32.lib advapi32.lib user32.lib /SUBSYSTEM:WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <atomic>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

// {682C9CD9-030D-4029-BA37-7DD6F909FDF8}
static const CLSID CLSID_PrismHandoff = { 0x682c9cd9, 0x030d, 0x4029, { 0xba, 0x37, 0x7d, 0xd6, 0xf9, 0x09, 0xfd, 0xf8 } };

// ---- interfaces, as declared in microsoft/terminal src/host/proxy/ITerminalHandoff.idl (MIT) ----
typedef struct _TERMINAL_STARTUP_INFO {
  BSTR pszTitle;
  BSTR pszIconPath;
  LONG iconIndex;
  DWORD dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
  WORD wShowWindow;
} TERMINAL_STARTUP_INFO;

MIDL_INTERFACE("59D55CCE-FC8A-48B4-ACE8-0A9286C6557F")
ITerminalHandoff : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE EstablishPtyHandoff(HANDLE in, HANDLE out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client) = 0;
};
MIDL_INTERFACE("AA6B364F-4A50-4176-9002-0AE755E7B5EF")
ITerminalHandoff2 : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE EstablishPtyHandoff(HANDLE in, HANDLE out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client, TERMINAL_STARTUP_INFO startupInfo) = 0;
};
MIDL_INTERFACE("6F23DA90-15C5-4203-9DB0-64E73F1B1B00")
ITerminalHandoff3 : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE EstablishPtyHandoff(HANDLE* in, HANDLE* out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client, const TERMINAL_STARTUP_INFO* startupInfo) = 0;
};

// ---- small helpers ----
static std::wstring g_logPath;
static void Log(const std::wstring& s) {
  if (g_logPath.empty()) return;
  HANDLE f = CreateFileW(g_logPath.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return;
  SYSTEMTIME t; GetLocalTime(&t);
  wchar_t head[64]; swprintf_s(head, L"%02d:%02d:%02d.%03d [%lu] ", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds, GetCurrentProcessId());
  std::wstring line = head + s + L"\r\n";
  int n = WideCharToMultiByte(CP_UTF8, 0, line.c_str(), (int)line.size(), nullptr, 0, nullptr, nullptr);
  std::string u(n, '\0'); WideCharToMultiByte(CP_UTF8, 0, line.c_str(), (int)line.size(), u.data(), n, nullptr, nullptr);
  DWORD w; WriteFile(f, u.data(), (DWORD)u.size(), &w, nullptr); CloseHandle(f);
}
static HANDLE Dup(HANDLE h) {
  HANDLE d = nullptr;
  if (!h || h == INVALID_HANDLE_VALUE) return nullptr;
  if (!DuplicateHandle(GetCurrentProcess(), h, GetCurrentProcess(), &d, 0, FALSE, DUPLICATE_SAME_ACCESS)) return nullptr;
  return d;
}
static void Close(HANDLE& h) { if (h && h != INVALID_HANDLE_VALUE) CloseHandle(h); h = nullptr; }
static std::string Utf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0'); WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), s.data(), n, nullptr, nullptr);
  return s;
}
static std::string JsonStr(const std::wstring& w) {
  std::string s = Utf8(w), o = "\"";
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o += '\\'; o += (char)c; }
    else if (c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); o += b; }
    else o += (char)c;
  }
  return o + "\"";
}
static std::wstring ProcessPath(HANDLE process) {
  wchar_t buf[MAX_PATH * 2]; DWORD n = ARRAYSIZE(buf);
  return QueryFullProcessImageNameW(process, 0, buf, &n) ? std::wstring(buf, n) : L"";
}
static std::wstring RegString(const wchar_t* name) {
  wchar_t buf[2048]; DWORD size = sizeof(buf);
  if (RegGetValueW(HKEY_CURRENT_USER, L"Software\\Prism", name, RRF_RT_REG_SZ, nullptr, buf, &size) != ERROR_SUCCESS) return L"";
  return buf;
}
static std::wstring Lower(std::wstring s) { CharLowerBuffW(s.data(), (DWORD)s.size()); return s; }

// overlapped I/O on the Prism pipe (one reader thread and several writers at once)
static bool OvIo(HANDLE h, bool write, void* buf, DWORD len, DWORD* done) {
  OVERLAPPED ov{}; ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  BOOL ok = write ? WriteFile(h, buf, len, nullptr, &ov) : ReadFile(h, buf, len, nullptr, &ov);
  if (!ok && GetLastError() != ERROR_IO_PENDING) { CloseHandle(ov.hEvent); return false; }
  ok = GetOverlappedResult(h, &ov, done, TRUE);
  CloseHandle(ov.hEvent);
  return ok != FALSE;
}
static bool ReadAll(HANDLE h, void* buf, DWORD len) {
  auto p = (char*)buf;
  while (len) { DWORD n = 0; if (!OvIo(h, false, p, len, &n) || !n) return false; p += n; len -= n; }
  return true;
}

// ---- one handed-off console session ----
struct Session {
  HANDLE inWrite = nullptr, outRead = nullptr, signal = nullptr, ref = nullptr, server = nullptr, client = nullptr;
  HANDLE prism = nullptr;
  std::wstring title;
  std::mutex sendLock, closeLock;
  std::atomic<bool> closing{ false }, ended{ false };

  bool Send(uint8_t type, const void* data, uint32_t len) {
    std::lock_guard<std::mutex> g(sendLock);
    if (!prism) return false;
    std::vector<char> f(5 + len);
    f[0] = (char)type; memcpy(&f[1], &len, 4); if (len) memcpy(&f[5], data, len);
    DWORD n = 0;
    return OvIo(prism, true, f.data(), (DWORD)f.size(), &n) && n == f.size();
  }
  void Resize(uint16_t cols, uint16_t rows) {
    unsigned short packet[3] = { 8 /* PTY_SIGNAL_RESIZE_WINDOW */, cols, rows };
    DWORD n; if (signal) WriteFile(signal, packet, sizeof(packet), &n, nullptr);
  }

  // Connects to Prism, starting it if it is not running. Only the real Prism may receive the console.
  bool Connect() {
    wchar_t user[256]; DWORD un = ARRAYSIZE(user);
    if (!GetUserNameW(user, &un)) wcscpy_s(user, L"user");
    std::wstring name = L"\\\\.\\pipe\\prism-handoff-";
    // same rule as Prism (handoff.js): ASCII letters, digits, - and _; anything else becomes _
    for (wchar_t* c = user; *c; ++c) { wchar_t x = *c; bool ok = (x >= L'a' && x <= L'z') || (x >= L'A' && x <= L'Z') || (x >= L'0' && x <= L'9') || x == L'-' || x == L'_'; name += ok ? x : L'_'; }
    const std::wstring exe = RegString(L"Exe"), args = RegString(L"Args");
    bool started = false;
    for (int i = 0; i < 200; ++i) { // ~20 s
      HANDLE h = CreateFileW(name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
      if (h != INVALID_HANDLE_VALUE) {
        ULONG pid = 0; GetNamedPipeServerProcessId(h, &pid);
        HANDLE sp = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        std::wstring path = sp ? ProcessPath(sp) : L"";
        if (sp) CloseHandle(sp);
        if (!exe.empty() && Lower(path) == Lower(exe)) { prism = h; return true; }
        Log(L"refused pipe server: " + path);
        CloseHandle(h); return false;
      }
      if (GetLastError() == ERROR_PIPE_BUSY) { WaitNamedPipeW(name.c_str(), 200); continue; }
      if (!started && !exe.empty()) {
        started = true;
        std::wstring cmd = L"\"" + exe + L"\" " + args + L" --background";
        STARTUPINFOW si{ sizeof(si) }; PROCESS_INFORMATION pi{};
        if (CreateProcessW(nullptr, cmd.data(), nullptr, nullptr, FALSE, DETACHED_PROCESS, nullptr, nullptr, &si, &pi)) { CloseHandle(pi.hThread); CloseHandle(pi.hProcess); Log(L"started Prism"); }
        else Log(L"could not start Prism: " + cmd);
      }
      Sleep(100);
    }
    return false;
  }

  void Shutdown() {
    // closing the signal and reference handles ends the console session (like ClosePseudoConsole)
    std::lock_guard<std::mutex> g(closeLock);
    Close(signal); Close(ref); Close(inWrite);
  }

  void Run() {
    if (!Connect()) { Log(L"no Prism to hand the console to"); Shutdown(); Close(outRead); Close(server); Close(client); return; }
    DWORD pid = client ? GetProcessId(client) : 0;
    std::string hello = "{\"title\":" + JsonStr(title) + ",\"pid\":" + std::to_string(pid) + ",\"exe\":" + JsonStr(client ? ProcessPath(client) : L"") + "}";
    Send(1, hello.data(), (uint32_t)hello.size());
    Log(L"session started");

    // console output -> Prism
    HANDLE outDone = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    std::thread out([this, outDone] {
      std::vector<char> buf(64 * 1024);
      for (;;) {
        DWORD n = 0;
        if (!ReadFile(outRead, buf.data(), (DWORD)buf.size(), &n, nullptr) || !n) break;
        if (!Send(2, buf.data(), n)) break;
      }
      SetEvent(outDone);
    });
    // Prism -> console input, resize, close
    std::thread in([this] {
      for (;;) {
        uint8_t head[5];
        if (!ReadAll(prism, head, 5)) break;
        uint32_t len; memcpy(&len, head + 1, 4);
        if (len > 16 * 1024 * 1024) break;
        std::vector<char> p(len);
        if (len && !ReadAll(prism, p.data(), len)) break;
        std::lock_guard<std::mutex> g(closeLock);
        if (head[0] == 1) { DWORD n; if (inWrite) WriteFile(inWrite, p.data(), len, &n, nullptr); }
        else if (head[0] == 2 && len >= 4) { uint16_t c, r; memcpy(&c, p.data(), 2); memcpy(&r, p.data() + 2, 2); Resize(c, r); }
        else if (head[0] == 3) break;
      }
      if (ended) return;
      // the tab was closed, or Prism went away: end the console session
      closing = true;
      Shutdown();
      if (client) TerminateProcess(client, 0xC000013A); // STATUS_CONTROL_C_EXIT, like closing a console window
    });

    // the session ends when the app (the console's first client) exits
    if (client) WaitForSingleObject(client, INFINITE);
    DWORD code = 0;
    if (client) GetExitCodeProcess(client, &code);
    ended = true;
    Sleep(120); // the console host renders asynchronously: let its last output through
    // end the console session; the console host exits and the output pipe drains to its end
    Shutdown(); Close(server);
    if (WaitForSingleObject(outDone, 2000) == WAIT_TIMEOUT) CancelSynchronousIo((HANDLE)out.native_handle());
    out.join();
    CloseHandle(outDone);
    std::string exit = "{\"code\":" + std::to_string((long long)(int)code) + "}";
    if (!closing) Send(3, exit.data(), (uint32_t)exit.size());
    Log(L"session ended, code " + std::to_wstring((int)code));
    CancelIoEx(prism, nullptr); // stops the reader
    in.join();
    { std::lock_guard<std::mutex> g(sendLock); Close(prism); }
    Close(outRead);
    Close(client);
  }
};

// ---- COM ----
static HANDLE g_done = nullptr;
static std::atomic<long> g_sessions{ 0 };

class Handoff : public ITerminalHandoff, public ITerminalHandoff2, public ITerminalHandoff3 {
  std::atomic<ULONG> refs{ 1 };
public:
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == __uuidof(IUnknown) || riid == __uuidof(ITerminalHandoff3)) *ppv = static_cast<ITerminalHandoff3*>(this);
    else if (riid == __uuidof(ITerminalHandoff2)) *ppv = static_cast<ITerminalHandoff2*>(this);
    else if (riid == __uuidof(ITerminalHandoff)) *ppv = static_cast<ITerminalHandoff*>(this);
    else { *ppv = nullptr; return E_NOINTERFACE; }
    AddRef(); return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++refs; }
  STDMETHODIMP_(ULONG) Release() override { ULONG r = --refs; if (!r) delete this; return r; }

  static HRESULT Start(Session* s, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client, const wchar_t* title, UINT titleLen) {
    s->signal = Dup(signal); s->ref = Dup(ref); s->server = Dup(server); s->client = Dup(client);
    if (title && titleLen) s->title.assign(title, titleLen);
    if (!s->signal || !s->ref || !s->inWrite || !s->outRead) { Log(L"handoff: missing handles"); delete s; return E_INVALIDARG; }
    ++g_sessions;
    std::thread([s] { s->Run(); delete s; if (--g_sessions == 0) SetEvent(g_done); }).detach();
    return S_OK;
  }
  // v1/v2: the console made the pipes; we keep our copies
  STDMETHODIMP EstablishPtyHandoff(HANDLE in, HANDLE out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client) override {
    auto s = new Session(); s->inWrite = Dup(in); s->outRead = Dup(out);
    return Start(s, signal, ref, server, client, nullptr, 0);
  }
  STDMETHODIMP EstablishPtyHandoff(HANDLE in, HANDLE out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client, TERMINAL_STARTUP_INFO si) override {
    auto s = new Session(); s->inWrite = Dup(in); s->outRead = Dup(out);
    return Start(s, signal, ref, server, client, si.pszTitle, si.pszTitle ? SysStringLen(si.pszTitle) : 0);
  }
  // v3: we make the pipes and give the console its ends
  STDMETHODIMP EstablishPtyHandoff(HANDLE* in, HANDLE* out, HANDLE signal, HANDLE ref, HANDLE server, HANDLE client, const TERMINAL_STARTUP_INFO* si) override {
    if (!in || !out) return E_POINTER;
    Log(L"handoff v3");
    HANDLE inR, inW, outR, outW;
    if (!CreatePipe(&inR, &inW, nullptr, 128 * 1024)) return HRESULT_FROM_WIN32(GetLastError());
    if (!CreatePipe(&outR, &outW, nullptr, 128 * 1024)) { CloseHandle(inR); CloseHandle(inW); return HRESULT_FROM_WIN32(GetLastError()); }
    auto s = new Session(); s->inWrite = inW; s->outRead = outR;
    HRESULT hr = Start(s, signal, ref, server, client, si && si->pszTitle ? si->pszTitle : nullptr, si && si->pszTitle ? SysStringLen(si->pszTitle) : 0);
    if (FAILED(hr)) { CloseHandle(inR); CloseHandle(outW); return hr; }
    *in = inR; *out = outW; // ownership goes to the console
    return S_OK;
  }
};

class Factory : public IClassFactory {
public:
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == __uuidof(IUnknown) || riid == __uuidof(IClassFactory)) { *ppv = static_cast<IClassFactory*>(this); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }
  STDMETHODIMP CreateInstance(IUnknown* outer, REFIID riid, void** ppv) override {
    if (outer) return CLASS_E_NOAGGREGATION;
    auto h = new Handoff();
    HRESULT hr = h->QueryInterface(riid, ppv);
    h->Release();
    return hr;
  }
  STDMETHODIMP LockServer(BOOL) override { return S_OK; }
};

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR cmdLine, int) {
  g_logPath = RegString(L"HandoffLog"); // optional, for troubleshooting
  std::wstring args = cmdLine ? cmdLine : L"";
  if (args.find(L"--version") != std::wstring::npos) return 0; // Prism checks that the helper runs
  if (args.find(L"Embedding") == std::wstring::npos) {
    MessageBoxW(nullptr, L"This is a helper of Prism. To make Prism your default terminal, use Prism Settings > Windows.", L"Prism", MB_OK | MB_ICONINFORMATION);
    return 0;
  }
  Log(L"started by COM: " + args);
  g_done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 1;
  static Factory factory;
  DWORD cookie = 0;
  HRESULT hr = CoRegisterClassObject(CLSID_PrismHandoff, &factory, CLSCTX_LOCAL_SERVER, REGCLS_SINGLEUSE, &cookie);
  if (FAILED(hr)) { Log(L"CoRegisterClassObject failed"); CoUninitialize(); return 2; }
  // wait for the session to finish; give up if COM never hands us one
  if (WaitForSingleObject(g_done, 60000) == WAIT_TIMEOUT && g_sessions == 0) Log(L"no handoff arrived");
  else WaitForSingleObject(g_done, INFINITE);
  CoRevokeClassObject(cookie);
  CoUninitialize();
  return 0;
}
