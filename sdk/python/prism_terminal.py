"""Prism API for Python: show images, charts, buttons and forms in Prism, report progress, send notifications.

No dependencies. In any other terminal every function still works, with a plain-text fallback.

    import prism_terminal as prism          # copy this file next to your script
    if prism.available():
        prism.image("chart.png")
    pick = prism.choose("Deploy?", ["Yes", "No"])
    prism.progress(40)

Docs: https://github.com/onufry444/prism/blob/main/docs/api.md
"""
import base64
import json
import os
import sys

_pipe = None
_seq = 0

__all__ = ["available", "image", "chart", "choose", "form", "progress", "notify", "title"]


def available():
    """True when this program runs in a Prism pane."""
    return bool(os.environ.get("PRISM_API") and os.environ.get("PRISM_TAB") and sys.platform == "win32")


def _request(op, **fields):
    global _pipe, _seq
    if _pipe is None:
        _pipe = open(os.environ["PRISM_API"], "r+b", buffering=0)
    _seq += 1
    msg = dict(fields, id=_seq, op=op, tab=os.environ.get("PRISM_TAB"))
    _pipe.write((json.dumps(msg) + "\n").encode("utf-8"))
    line = b""
    while not line.endswith(b"\n"):
        chunk = _pipe.read(1)
        if not chunk:
            raise ConnectionError("Prism closed the connection")
        line += chunk
    reply = json.loads(line.decode("utf-8"))
    if not reply.get("ok"):
        raise RuntimeError(reply.get("error") or "Prism refused the request")
    return reply


def _reserve(rows):
    # images and charts are drawn over lines the program leaves empty
    sys.stdout.write("\n" * max(1, int(rows or 1)))
    sys.stdout.flush()


def image(source, width=None, height=None):
    """Show a picture: a file path, or the image bytes. width/height in character cells."""
    if not available():
        print("[image: %s]" % (source if isinstance(source, str) else "picture"))
        return
    sys.stdout.flush()
    fields = {"path": source, "cwd": os.getcwd()} if isinstance(source, str) else {"data": base64.b64encode(bytes(source)).decode()}
    if width:
        fields["width"] = width
    if height:
        fields["height"] = height
    _reserve(_request("image", **fields).get("rows"))


def chart(series, labels=None, kind="line", title="", height=12):
    """Draw a chart. series: {"name": [values...]} or [{"name": ..., "values": [...]}]."""
    if isinstance(series, dict):
        series = [{"name": k, "values": list(v)} for k, v in series.items()]
    if not available():
        bars = " ▁▂▃▄▅▆▇█"
        for s in series:
            v = s["values"]
            lo, hi = min(v), max(v)
            print(s.get("name", ""), "".join(bars[round((x - lo) / ((hi - lo) or 1) * 8)] for x in v))
        return
    sys.stdout.flush()
    _reserve(_request("chart", type=kind, title=title, labels=[str(x) for x in (labels or [])], series=series, height=height).get("rows"))


def choose(prompt, options=None):
    """Buttons on the current line. Returns the chosen option, or None if cancelled."""
    if options is None:
        prompt, options = "", prompt
    options = [str(o) for o in options]
    if not available():
        a = input("%s%s: " % (prompt + " " if prompt else "", "  ".join("[%d] %s" % (i + 1, o) for i, o in enumerate(options)))).strip()
        if a.isdigit() and 0 < int(a) <= len(options):
            return options[int(a) - 1]
        return a if a in options else None
    sys.stdout.flush()
    r = _request("choose", prompt=prompt, options=options)
    print()
    return None if r.get("cancelled") else r.get("choice")


def form(title, fields, submit="OK"):
    """A form. fields: [{"name", "label", "type": text|password|number|select|checkbox, "options", "value"}].
    Returns {name: value}, or None if cancelled."""
    if not available():
        out = {}
        for f in fields:
            a = input("%s: " % (f.get("label") or f["name"])).strip()
            t = f.get("type")
            out[f["name"]] = a.lower() in ("y", "yes", "true", "1") if t == "checkbox" else (float(a) if t == "number" and a else a)
        return out
    r = _request("form", title=title, fields=fields, submit=submit)
    return None if r.get("cancelled") else r.get("values")


def progress(value, state="normal"):
    """Progress in the tab and on the taskbar button: 0-100, or None to hide it. state: normal, error, paused."""
    if not available():
        if value is not None:
            sys.stderr.write("\r%d%% " % value)
        return
    _request("progress", value=value, state=state)


def notify(title_, body=""):
    """A Windows notification."""
    if not available():
        print("\a%s%s" % (title_, ": " + body if body else ""))
        return
    _request("notify", title=title_, body=body)


def title(text):
    """The tab title."""
    if not available():
        sys.stdout.write("\x1b]0;%s\x07" % text)
        return
    _request("title", text=text)
