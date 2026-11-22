'use strict';
// Prism translator: rewrites bash and cmd habits into PowerShell before a line runs.
//
//   translate('ls -la && cd /d D:\\work', { ps7: false })
//     -> { line: 'ls -la; $__p = $?; if ($__p) { Set-Location D:\\work }', dialects: ['bash', 'cmd'], changed: true }
//
// Commands like ls/rm/grep/touch keep their text: the Prism shell profile defines them with GNU flags.
// The translator only handles what a function cannot: syntax (&&, ||, VAR=x cmd, $VAR, %VAR%, /dev/null,
// !!, cd -), cmd switches (dir /s, del /q, rd /s, set X=1) and names PowerShell aliases to something else.
// A line that starts with a space is never translated.

const PS_AUTOMATIC = new Set(['_', 'args', 'consolefilename', 'error', 'event', 'eventargs', 'eventsubscriber', 'executioncontext', 'false', 'foreach',
  'home', 'host', 'input', 'lastexitcode', 'matches', 'myinvocation', 'nestedpromptlevel', 'null', 'pid', 'profile', 'psboundparameters', 'pscmdlet',
  'pscommandpath', 'psculture', 'psdebugcontext', 'pshome', 'psitem', 'psscriptroot', 'pssenderinfo', 'psuiculture', 'psversiontable', 'pwd', 'sender',
  'shellid', 'stacktrace', 'switch', 'this', 'true', 'env', 'global', 'script', 'local', 'private', 'using', 'variable', 'function', 'alias']);
const CMD_PASSTHRU = new Set(['mklink', 'assoc', 'ftype', 'vol', 'ver', 'pause', 'dpath', 'verify']);
const SC_VERBS = new Set(['query', 'queryex', 'start', 'stop', 'pause', 'continue', 'config', 'qc', 'delete', 'create', 'description', 'failure', 'sdshow', 'qdescription', 'getdisplayname', 'getkeyname']);
const WELL_KNOWN_ENV = ['PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'USERNAME', 'COMPUTERNAME', 'OS', 'PROGRAMFILES', 'PROGRAMDATA',
  'SYSTEMROOT', 'WINDIR', 'HOMEDRIVE', 'HOMEPATH', 'PATHEXT', 'COMSPEC', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS'];

// ---------- tokenizer ----------
// Splits a line into commands joined by operators (&&, ||, ;, |, newline), respecting quotes and nesting.
function splitTop(line) {
  const parts = []; let cur = '', depth = 0, q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i], n = line[i + 1];
    if (q) { cur += c; if (c === '`' && q === '"' && i + 1 < line.length) { cur += line[++i]; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === '`' && i + 1 < line.length) { cur += c + line[++i]; continue; }
    if (c === '(' || c === '{' || c === '[') { depth++; cur += c; continue; }
    if ((c === ')' || c === '}' || c === ']') && depth > 0) { depth--; cur += c; continue; }
    if (depth === 0) {
      if ((c === '&' && n === '&') || (c === '|' && n === '|')) { parts.push({ cmd: cur, op: c + n }); cur = ''; i++; continue; }
      if (c === '|' && n === '&') { parts.push({ cmd: cur + ' 2>&1', op: '|' }); cur = ''; i++; continue; }
      if (c === '|' || c === ';' || c === '\n') { parts.push({ cmd: cur, op: c }); cur = ''; continue; }
    }
    cur += c;
  }
  parts.push({ cmd: cur, op: null });
  return parts;
}
// Splits one command into words, keeping each word's raw text (quotes included).
function words(cmd) {
  const out = []; let cur = '', depth = 0, q = null, any = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) { cur += c; if (c === '`' && q === '"' && i + 1 < cmd.length) { cur += cmd[++i]; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; any = true; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    if ((c === ')' || c === '}' || c === ']') && depth > 0) depth--;
    if (depth === 0 && /\s/.test(c)) { if (any) { out.push(cur); cur = ''; any = false; } continue; }
    cur += c; any = true;
  }
  if (any) out.push(cur);
  return out;
}
const unquote = w => (/^'.*'$/s.test(w) || /^".*"$/s.test(w)) ? w.slice(1, -1) : w;
// values always become PowerShell strings: single-quoted, or double-quoted when they reference a variable
const psQuote = v => "'" + v.replace(/'/g, "''") + "'";
const psValue = raw => /^".*"$/s.test(raw) || /^'.*'$/s.test(raw) ? raw : raw.includes('$') ? '"' + raw.replace(/"/g, '`"') + '"' : psQuote(raw);
const isSwitch = w => /^\/[a-z?](?:[:-]?[a-z-]*)?$/i.test(w);

// ---------- variables ----------
// $NAME / ${NAME} (bash) and %NAME% (cmd) become $env:NAME when NAME is an environment variable
// and not a PowerShell variable in the current session.
function translateVars(text, ctx, hit) {
  const env = ctx.envSet, vars = ctx.varSet;
  let out = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q === "'") { out += c; if (c === "'") q = null; continue; }
    if (c === "'" && !q) { q = "'"; out += c; continue; }
    if (c === '"') { q = q === '"' ? null : '"'; out += c; continue; }
    if (c === '$') {
      const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}|^\$([A-Za-z_][A-Za-z0-9_]*)(?![:\w])/.exec(text.slice(i));
      if (m) {
        const name = m[1] || m[2], low = name.toLowerCase();
        let target = null;
        if (low === 'user' && !vars.has('user')) target = 'USERNAME';
        else if (env.has(low) && !vars.has(low) && !PS_AUTOMATIC.has(low)) target = name;
        if (target) { out += '$env:' + target; i += m[0].length - 1; hit('bash'); continue; }
      }
      if (text.slice(i, i + 3) === '$((') {
        const end = text.indexOf('))', i);
        if (end > 0) { out += '$(' + text.slice(i + 3, end) + ')'; i = end + 1; hit('bash'); continue; }
      }
    }
    if (c === '%') {
      const m = /^%([A-Za-z_][A-Za-z0-9_()]*)%/.exec(text.slice(i));
      if (m && (env.has(m[1].toLowerCase()) || WELL_KNOWN_ENV.includes(m[1].toUpperCase()))) { out += '$env:' + m[1]; i += m[0].length - 1; hit('cmd'); continue; }
    }
    out += c;
  }
  return out;
}

// ---------- single command ----------
function translateCommand(raw, ctx, pos, hit) {
  const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
  let w = words(raw);
  if (!w.length) return raw;
  const name = unquote(w[0]).toLowerCase();
  const args = w.slice(1);
  const build = s => lead + s + trail;

  // /dev/null and &> redirections
  let changed = false;
  const fixed = [];
  for (let i = 0; i < w.length; i++) {
    let x = w[i];
    if (/^(&|\d)?>>?\/dev\/null$/.test(x)) { x = x.replace(/^&>/, '*>').replace('/dev/null', '$null'); changed = true; }
    else if (x === '/dev/null' && /^(&|\d)?>>?$/.test(fixed[fixed.length - 1] || '')) { fixed[fixed.length - 1] = fixed[fixed.length - 1].replace(/^&>/, '*>'); x = '$null'; changed = true; }
    else if (/^&>/.test(x)) { x = x.replace(/^&>/, '*>'); changed = true; }
    fixed.push(x);
  }
  if (changed) { w = fixed; hit('bash'); }
  // `cmd < file`: PowerShell has no input redirection
  const lt = w.indexOf('<');
  if (lt > 0 && w[lt + 1]) {
    const file = w[lt + 1];
    w = [...w.slice(0, lt), ...w.slice(lt + 2)];
    hit('bash');
    return build(`Get-Content ${file} | ${w.join(' ')}`);
  }
  const line = () => w.join(' ');

  // NAME=value cmd ...  (environment for one command)
  const asg = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(w[0]);
  if (asg && !/^\$/.test(w[0])) {
    hit('bash');
    const set = `$env:${asg[1]} = ${psValue(asg[2] || "''")}`;
    if (w.length === 1) return build(set);
    return build(`${set}; ${translateCommand(w.slice(1).join(' '), ctx, pos, hit).trim()}`);
  }

  switch (name) {
    case 'cd': case 'chdir': {
      if (!args.length) { hit('bash'); return build('Set-Location ~'); }
      if (args.length === 1 && args[0] === '-' && !ctx.ps7) { hit('bash'); return build('Set-Location $global:PRISM_OLDPWD'); }
      if (args[0] && args[0].toLowerCase() === '/d') { hit('cmd'); return build(`Set-Location ${args.slice(1).join(' ')}`); }
      return build(line());
    }
    case 'dir': {
      const sw = args.filter(isSwitch), paths = args.filter(a => !isSwitch(a));
      if (!sw.length) break;
      hit('cmd');
      const p = [];
      for (const s of sw.map(x => x.toLowerCase())) {
        if (s === '/s') p.push('-Recurse');
        else if (s === '/b') p.push('-Name');
        else if (s === '/ad' || s === '/a:d') p.push('-Directory');
        else if (s === '/a-d' || s === '/a:-d') p.push('-File');
        else if (s.startsWith('/a')) p.push('-Force');
      }
      return build(['Get-ChildItem', ...paths, ...new Set(p)].join(' '));
    }
    case 'del': case 'erase': {
      const sw = args.filter(isSwitch).map(x => x.toLowerCase()), paths = args.filter(a => !isSwitch(a));
      if (!sw.length) break;
      hit('cmd');
      const p = [];
      if (sw.includes('/s')) p.push('-Recurse');
      if (sw.includes('/q') || sw.includes('/f')) p.push('-Force');
      return build(['Remove-Item', paths.join(', '), ...p].join(' '));
    }
    case 'rd': case 'rmdir': {
      const sw = args.filter(isSwitch).map(x => x.toLowerCase()), paths = args.filter(a => !isSwitch(a));
      if (!sw.length) break;
      hit('cmd');
      const p = [];
      if (sw.includes('/s')) p.push('-Recurse');
      if (sw.includes('/q') || sw.includes('/s')) p.push('-Force');
      return build(['Remove-Item', paths.join(', '), ...p].join(' '));
    }
    case 'copy': case 'move': {
      const sw = args.filter(isSwitch).map(x => x.toLowerCase()), paths = args.filter(a => !isSwitch(a));
      if (!sw.length) break;
      hit('cmd');
      return build([name === 'copy' ? 'Copy-Item' : 'Move-Item', ...paths, ...(sw.includes('/y') ? ['-Force'] : [])].join(' '));
    }
    case 'set': {
      if (pos > 0) break;
      if (!args.length) { hit('cmd'); return build('Get-ChildItem env:'); }
      const rest = raw.trim().slice(raw.trim().indexOf(' ') + 1);
      const m = /^"?([A-Za-z_][A-Za-z0-9_]*)=(.*?)"?$/s.exec(rest);
      if (m && !rest.startsWith('/')) { hit('cmd'); return build(`$env:${m[1]} = ${psQuote(m[2])}`); }
      if (args.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(args[0]) && args[0] === args[0].toUpperCase()) { hit('cmd'); return build(`Get-ChildItem env:${args[0]}*`); }
      break;
    }
    case 'where': if (pos === 0 && args.length && !/^-/.test(args[0]) && !/[{$]/.test(raw)) { hit('cmd'); return build(['where.exe', ...args].join(' ')); } break;
    case 'sc': if (pos === 0 && args.length && SC_VERBS.has(args[0].toLowerCase())) { hit('cmd'); return build(['sc.exe', ...args].join(' ')); } break;
    case 'call': if (args.length) { hit('cmd'); return build(['&', ...args].join(' ')); } break;
    case 'title': hit('cmd'); return build(`$Host.UI.RawUI.WindowTitle = ${psQuote(args.map(unquote).join(' '))}`);
    case 'echo.': hit('cmd'); return build("Write-Output ''");
    case 'exit': if (args[0] && args[0].toLowerCase() === '/b') { hit('cmd'); return build(['exit', ...args.slice(1)].join(' ')); } break;
    case 'source': if (args.length) { hit('bash'); return build(['.', ...args].join(' ')); } break;
    case 'alias': {
      hit('bash');
      if (!args.length) return build('prism alias');
      const m = /^([^=\s]+)=(.*)$/s.exec(args.join(' '));
      if (m) return build(`prism alias ${m[1]} ${psValue(m[2])}`);
      return build(`prism alias ${args.join(' ')}`);
    }
    case 'unalias': if (args.length) { hit('bash'); return build(`prism unalias ${args.join(' ')}`); } break;
    case 'export': {
      // PATH=$PATH:/x  ->  PATH=$env:PATH;/x  (Windows separates paths with ;)
      const fixedArgs = args.map(a => /^"?PATH=/i.test(a) ? a.replace(/\$\{?PATH\}?:/g, '$env:PATH;').replace(/:\$\{?PATH\}?/g, ';$env:PATH') : a);
      if (fixedArgs.join() !== args.join()) { hit('bash'); return build(['export', ...fixedArgs].join(' ')); }
      break;
    }
    default:
      if (CMD_PASSTHRU.has(name) && pos === 0) { hit('cmd'); return build(`cmd /c ${raw.trim()}`); }
  }
  return build(line());
}

// ---------- && and || for Windows PowerShell 5.1 ----------
function chain(cmds) {
  // cmds: [{ text, op }] with op in &&, || between them. Correct bash semantics via a status variable.
  let out = cmds[0].text.trim() + '; $__p = $?';
  for (let i = 1; i < cmds.length; i++) {
    const cond = cmds[i - 1].op === '&&' ? '$__p' : '-not $__p';
    out += `; if (${cond}) { ${cmds[i].text.trim()}; $__p = $? }`;
  }
  return out;
}

function translate(input, opts = {}) {
  const original = String(input ?? '');
  const res = { line: original, changed: false, dialects: [] };
  if (!original.trim() || /^\s/.test(original) || original.length > 4000) return res;
  const hits = new Set();
  const hit = d => hits.add(d);
  const ctx = {
    ps7: !!opts.ps7,
    envSet: new Set([...(opts.env || []), ...WELL_KNOWN_ENV].map(s => String(s).toLowerCase())),
    varSet: new Set((opts.vars || []).map(s => String(s).toLowerCase()))
  };
  let line = original;

  // history: !! and !$
  if (opts.last && /(^|[^'\w])!!|!\$/.test(line) && !/'[^']*!!/.test(line)) {
    const lastWords = words(opts.last);
    line = line.replace(/!!/g, opts.last).replace(/!\$/g, lastWords[lastWords.length - 1] || '');
    hit('bash');
  }
  // whole-line shortcuts
  const t = line.trim();
  const dots = { '..': '..', '...': '../..', '....': '../../..', '~': '~' }[t];
  if (dots) { res.line = `Set-Location ${dots}`; res.changed = true; res.dialects = ['bash']; return res; }

  line = translateVars(line, ctx, hit);
  const parts = splitTop(line);
  // translate each command; pos = position inside its pipeline
  let pos = 0;
  for (const p of parts) { p.text = translateCommand(p.cmd, ctx, pos, hit); pos = p.op === '|' ? pos + 1 : 0; }

  const needsChain = !ctx.ps7 && parts.some(p => p.op === '&&' || p.op === '||');
  let out;
  if (needsChain) {
    hit('bash');
    // group into statements separated by ; or newline, each statement may contain an && / || chain of pipelines
    const statements = []; let stmt = []; let pipe = '';
    for (const p of parts) {
      pipe += p.text;
      if (p.op === '|') { pipe += '|'; continue; }
      stmt.push({ text: pipe, op: p.op }); pipe = '';
      if (p.op !== '&&' && p.op !== '||') { statements.push({ items: stmt, sep: p.op }); stmt = []; }
    }
    out = statements.map(s => (s.items.length > 1 ? chain(s.items) : s.items[0].text.trim()) + (s.sep ? (s.sep === '\n' ? '\n' : '; ') : '')).join('').trim();
  } else {
    out = parts.map(p => p.text + (p.op || '')).join('');
  }
  if (out !== original) { res.line = out; res.changed = true; }
  res.dialects = [...hits];
  if (!res.changed) res.dialects = [];
  return res;
}

// ---------- administrator rights ----------
// Commands that always need administrator rights on Windows. Prism asks before running them
// (instead of letting them fail with "Access denied"). Help requests (/?, -?, --help) are left alone.
const ADMIN_RULES = [
  /^sfc(\.exe)?\s+\/(scannow|verifyonly|scanfile|verifyfile)/i,
  /^dism(\.exe)?\s+\/online\b/i,
  /^chkdsk(\.exe)?\b.*\s\/[frxb]\b/i,
  /^(diskpart|bcdedit|bootrec|bcdboot|manage-bde|vssadmin|winsat)(\.exe)?\b/i,
  /^fsutil(\.exe)?\s+(behavior\s+set|dirty\s+set|repair|resource)\b/i,
  /^choco(\.exe)?\s+(install|upgrade|uninstall|update|pin|feature|source|apikey)\b/i,
  /^(enable|disable)-windowsoptionalfeature\b/i,
  /^(add|remove)-windowscapability\b/i,
  /^(install|uninstall|add|remove)-windowsfeature\b/i,
  /^repair-windowsimage\b/i,
  /^set-executionpolicy\b(?![^;|]*-scope\s+(currentuser|process)\b)/i,
  /^netsh(\.exe)?\s+(advfirewall|winsock\s+reset|int(erface)?\s+(ip|ipv4|ipv6)\s+(reset|set|add|delete))/i,
  /^(new|remove|set|enable|disable)-netfirewallrule\b/i,
  /^(new|remove)-service\b/i,
  /^sc(\.exe)?\s+(create|delete|config|failure|sdset)\b/i,
  /^net(\.exe)?\s+(user|localgroup)\s+.*\/(add|delete|del|active)/i,
  /^net(\.exe)?\s+(start|stop)\s+\S/i,
  /^reg(\.exe)?\s+(add|delete|import|restore|load|unload)\s+"?(hklm|hkey_local_machine|hkcr|hkey_classes_root|hku|hkey_users)\b/i,
  /^powercfg(\.exe)?\s+[-\/](h|hibernate)\b/i,
  /^w32tm(\.exe)?\s+\/(resync|config|register|unregister)/i,
  /^(set|add|remove)-mppreference\b/i,
  /^(checkpoint-computer|enable-computerrestore|disable-computerrestore)\b/i,
  /^takeown(\.exe)?\b/i
];
function needsAdmin(line) {
  const text = String(line || '');
  if (/(^|\s)(\/\?|-\?|--help|-help)(\s|$)/i.test(text)) return false;
  return splitTop(text).some(p => {
    const c = p.cmd.trim().replace(/^&\s*/, '').replace(/^["']|["'](?=\s|$)/g, '');
    return ADMIN_RULES.some(r => r.test(c));
  });
}
// "sudo cmd..." -> "cmd..." (null when the line does not start with sudo)
function sudoRest(line) {
  const m = /^\s*sudo(?:\s+(.*))?$/s.exec(String(line || ''));
  return m ? (m[1] || '') : null;
}

module.exports = { translate, needsAdmin, sudoRest, _internal: { splitTop, words, translateVars } };
