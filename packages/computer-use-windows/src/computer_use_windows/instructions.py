"""Text that steers the agent: MCP server instructions and per-tool descriptions.

SERVER_INSTRUCTIONS is injected into the client's system prompt in every session, even sessions
that never call these tools, so it is capped at 900 characters. Tool descriptions are only loaded
with the tools; each is capped at 450 characters. Constants only, no logic.
"""

from __future__ import annotations

SERVER_INSTRUCTIONS: str = (
    "Last resort: only for GUI-only work (native dialogs, apps without a CLI/API, visual UI"
    " checks). Do the rest in your shell: launch apps/files/URLs (Start-Process), files,"
    " clipboard (Get-/Set-Clipboard), processes, settings with a CLI. Web pages: prefer a"
    " browser automation tool if available.\n"
    "Cheapest first: windows/focus -> elements (text; act by id) -> screenshot (~1.2k tokens)"
    " only if elements fall short -> zoom for details. Don't screenshot after each action;"
    " results name the foreground window; verify with elements.\n"
    "Your terminal is usually in front: bring the target forward first (Start-Process usually"
    " does, else focus). Terminals refuse keyboard input.\n"
    "x,y: pixels in the last screenshot. Element ids: from the last elements call.\n"
    "Never type secrets. If a password field, the failsafe (user's mouse in a screen corner) or"
    " a blocked app refuses an action, stop and ask the user."
)

TOOL_DESCRIPTIONS: dict[str, str] = {
    "screenshot": (
        "Capture a monitor as an image, long edge downscaled (default 1280 px, ~1.2k tokens)."
        " Costly: use only when elements is not enough, not after each action."
        " monitor: 1-based index; omitted = configured default or primary."
        " Returns the image plus one line: monitor i/n, image size, scale, token estimate,"
        " foreground window. Its pixels are the x,y space for click/move/drag/scroll/zoom until"
        " the next screenshot. For small text use zoom."
    ),
    "zoom": (
        "Show a region of the last screenshot at native screen resolution (captured fresh, so it"
        " shows the screen now). x0,y0,x1,y1: opposite corners in last-screenshot pixels, any"
        " order. Use to read small text or icons cheaply instead of a full screenshot. Returns the"
        " image plus its size and token estimate. Coordinates stay in screenshot space: keep"
        " using screenshot x,y for clicks. Needs a prior screenshot."
    ),
    "elements": (
        "A window's UI Automation elements as text, far cheaper than a screenshot: find and"
        ' verify with it. query: case-insensitive name/role substring ("save",'
        ' "button"). window: handle from windows; omitted = foreground. Lines:'
        ' [id] role "name" = "value" (disabled) @x,y (center, screenshot px, if shown).'
        " Act with click(element=id); ids go stale on the next call or if the window moved."
        " Capped/incomplete: use query. Few/none (games, canvases)? Screenshot."
    ),
    "windows": (
        "List visible top-level windows, foreground first, one per line:"
        ' handle | process | "title" plus [foreground] or [minimized].'
        " Use it to get a handle for focus or elements, or to check what is in front."
        " Cheap text, no image. To open an app, file or URL use your shell (Start-Process),"
        " not these tools."
    ),
    "focus": (
        "Bring a window to the foreground, restoring it if minimized. window: handle from"
        " windows. Do this before type_text/key and before clicking elements of a background"
        " window: your own terminal is usually in front, and keyboard input into terminals is"
        " refused. A window that is not responding is refused: wait, then retry. Returns one line"
        " with the new foreground window."
    ),
    "click": (
        "Click a point or an element. Give either x and y (pixels in the last screenshot) or"
        " element (id from the last elements call; clicks its center), not both. The target must"
        " be visible on top; a stale id is refused (call elements again). button:"
        " left|right|middle (right/middle refused on terminals: they paste). clicks: 1-3."
        " modifiers: held keys, any of ctrl, alt, shift, win. Returns one line with the"
        " foreground window; verify with elements."
    ),
    "type_text": (
        "Type text into the focused control of the foreground window (Unicode, any keyboard"
        ' layout; "\\n" = Enter, "\\t" = Tab). Focus the window and click the field first.'
        " Refused when a terminal is in front. Never type passwords or other secrets: password"
        " fields are refused; ask the user to enter them. Re-checked after each Tab/Enter: if"
        " refused there, the error says how many characters were typed. Use key for shortcuts."
        " Returns one line."
    ),
    "key": (
        "Press keys or shortcuts in the foreground window. keys: chords separated by spaces,"
        ' keys in a chord joined by + ("ctrl+s", "tab tab enter"). Names: a-z, 0-9, f1-f24,'
        " enter, esc, tab, space, backspace, delete, home, end, up, down, left, right, ctrl,"
        " alt, shift, win, comma, period... repeat: 1-100; max 200 presses per call."
        " Terminals refuse it: focus the target first. Password fields: only navigation keys"
        " and shortcuts. Returns one line."
    ),
    "scroll": (
        "Scroll the mouse wheel over a point. direction: up|down|left|right. amount: wheel"
        " notches 1-50 (default 3). x,y: point in last-screenshot pixels; omitted = current"
        " mouse position. Returns one line with the foreground window; check what scrolled into"
        " view with elements before taking a screenshot."
    ),
    "drag": (
        "Press the left mouse button at x0,y0, move to x1,y1 and release (sliders, selections,"
        " moving items). Coordinates are pixels in the last screenshot. Refused when either end"
        " is on a terminal. Returns one line with the foreground window."
    ),
    "move": (
        "Move the mouse to x,y (pixels in the last screenshot) without clicking, e.g. to reveal"
        " a hover tooltip or menu. Returns one line with the foreground window."
    ),
    "wait": (
        "Pause so the UI can update (app start, page load, animation). seconds: 0 < seconds <= 10."
        " Returns one line with the foreground window. Then check with elements before a"
        " screenshot."
    ),
}
