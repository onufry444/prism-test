# Prism shell profile for bash (Git Bash, WSL, Linux, macOS). Loaded by init.bash.

__prism_msg() {
  if [ -n "$PRISM_INBOX" ] && [ -d "$PRISM_INBOX" ]; then printf '%s\n' "$1" > "$PRISM_INBOX/sh-$$-$RANDOM$RANDOM.msg"
  else printf '\033]7777;%s\007' "$1"; fi
}
settings() { __prism_msg "panel;$*"; }

prism() {
  local sub="${1:-help}"; shift 2>/dev/null
  case "$sub" in
    settings) __prism_msg "panel;$*" ;;
    opacity) __prism_msg "opacity;$1" ;;
    font-size) __prism_msg "font;$1" ;;
    scheme) __prism_msg "scheme;$*" ;;
    reload) __prism_msg "reload;" ;;
    alias)
      if [ $# -eq 0 ]; then __prism_aliases; return; fi
      local n="$1"; shift
      if [ $# -eq 0 ]; then __prism_aliases | grep -E "^\s*$n\s"; return; fi
      __prism_msg "add;$(printf 'run\t%s\t%s' "$n" "$*" | base64 | tr -d '\n')"
      echo "alias $n='$*' (saved, available from the next command)" ;;
    unalias) for n in "$@"; do __prism_msg "remove;$n"; done ;;
    plugin|ssh|theme) __prism_toy "$sub" "$@" ;;
    help)
      echo "Prism commands: settings, prism alias NAME CMD, prism unalias NAME, prism opacity 0-100,"
      echo "  prism font-size 10-28, prism scheme NAME, prism update, prism uninstall; sudo COMMAND runs it as administrator" ;;
    *) if command -v cmd.exe >/dev/null 2>&1; then cmd.exe //c prism "$sub" "$@"; else echo "prism: unknown command '$sub'" >&2; return 1; fi ;;
  esac
}

# sudo in Git Bash: runs the command as administrator in this tab (Prism asks Windows for the rights)
if [ -n "$PRISM_TAB" ] && { [ "$OSTYPE" = msys ] || [ "$OSTYPE" = cygwin ]; } && command -v powershell.exe >/dev/null 2>&1; then
  sudo() {
    if [ $# -eq 0 ]; then echo 'usage: sudo COMMAND [ARGS...]' >&2; return 2; fi
    local s="$__TC_DIR/elevate.ps1"
    command -v cygpath >/dev/null 2>&1 && s=$(cygpath -w "$s")
    PRISM_SUDO="${*@Q}" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$s" -Kind bash
  }
fi

# toys (fetch, lava, matrix, pipes, donut, clock, visualizer): Prism draws them in this tab
if [ -n "$PRISM_TAB" ] && { [ "$OSTYPE" = msys ] || [ "$OSTYPE" = cygwin ]; } && command -v powershell.exe >/dev/null 2>&1; then
  __prism_toy() {
    local s="$__TC_DIR/elevate.ps1"
    command -v cygpath >/dev/null 2>&1 && s=$(cygpath -w "$s")
    powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$s" -Toy "$@"
  }
  for __t in $PRISM_COMMANDS; do
    type -P "$__t" >/dev/null 2>&1 || eval "$__t() { __prism_toy $__t \"\$@\"; }"
  done
  unset __t
fi

# `alias name=value` in bash also saves the alias in Prism, so it survives restarts
alias() {
  if [ $# -eq 0 ]; then builtin alias; return; fi
  builtin alias "$@" || return
  local a; for a in "$@"; do
    case "$a" in *=*) __prism_msg "add;$(printf 'run\t%s\t%s' "${a%%=*}" "${a#*=}" | base64 | tr -d '\n')" ;; esac
  done
}

# PowerShell commands typed in bash (Get-Process, Set-Location...) run in PowerShell instead of failing
command_not_found_handle() {
  if [[ "$1" =~ ^[A-Z][a-z]+-[A-Z][A-Za-z]+$ ]] && command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "$*"
    return $?
  fi
  printf 'bash: %s: command not found\n' "$1" >&2
  return 127
}

__prism_git_branch() {
  local d="$PWD" head
  while [ -n "$d" ]; do
    if [ -f "$d/.git/HEAD" ]; then
      read -r head < "$d/.git/HEAD"
      case "$head" in "ref: refs/heads/"*) printf '%s' "${head#ref: refs/heads/}" ;; *) printf '%s' "${head:0:7}" ;; esac
      return
    fi
    [ "$d" = "/" ] && return
    d="${d%/*}"; [ -z "$d" ] && d="/"
  done
}
__prism_prompt() {
  local code=$?
  # tell Prism the folder (new panes and restored tabs start there); only when it changed
  if [ -n "$PRISM_TAB" ] && [ "$PWD" != "$__PRISM_TOLD_CWD" ]; then
    __PRISM_TOLD_CWD=$PWD
    local w=$PWD; command -v cygpath >/dev/null 2>&1 && w=$(cygpath -w "$PWD")
    __prism_msg "cwd;$PRISM_TAB;$w"
  fi
  __tc_reload 2>/dev/null
  [ "$PRISM_KEEP_PROMPT" = 1 ] && return
  local r='\[\e[0m\]' sym_color="$PRISM_C_SYM" branch
  [ $code -ne 0 ] && sym_color="$PRISM_C_ERR"
  branch="$(__prism_git_branch)"
  PS1="\[\e[1m\]${PRISM_C_PATH}\w${r}"
  [ -n "$branch" ] && PS1+=" ${PRISM_C_GIT} ${branch}${r}"
  PS1+="\n${sym_color}${PRISM_SYMBOL}${r} "
}
