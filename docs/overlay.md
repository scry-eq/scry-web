# The game overlay window

A second Tauri `WebviewWindow` (label `overlay`) that floats over the running
game: transparent, undecorated, always-on-top, click-through. Desktop only —
`OverlayToggle` renders nothing in a browser, because there is no web fallback
for an always-on-top OS window.

- `src-tauri/src/overlay.rs` — the window, the platform shims, the hover sensor.
- `src/overlay/` — the page it loads (`overlay.html` is the second Vite entry).
- `src-tauri/capabilities/overlay.json` — capabilities are per-window, so the
  overlay's surface is declared separately from the main window's.

## Why the hover sensor polls

Electron's `setIgnoreMouseEvents(true, {forward: true})` keeps a click-through
window receiving mouse-*moves*, which is how an Electron overlay reveals chrome
on hover while clicks still pass to the game. **Tauri has no equivalent.**
`set_ignore_cursor_events(ignore: bool)` takes no options and tao implements it
as `WS_EX_TRANSPARENT | WS_EX_LAYERED` — the window then receives *zero* mouse
events and CSS `:hover` is dead.

So hover is sampled instead of hooked: a thread sleeps, hops to the main thread,
and compares the global cursor to the window rect. This is not merely a
workaround — Electron's `forward` installs a `WH_MOUSE_LL` hook owned by the app
process, so every system mouse event waits on that app's message loop and a
stalled main thread freezes the user's cursor system-wide. Sampling cannot do
that.

Measured cost (Xvfb + llvmpipe, i.e. the slowest rendering path there is; on real
hardware these are all far lower):

| | CPU |
|---|---|
| main window only | 12.7% |
| \+ overlay window, sensor idle | 13.7% |
| \+ sensor at 40 Hz | 14.5% |

**~0.8% of one core for the sensor.** Rate is `POLL` in `overlay.rs`.

The webview declares which regions stay clickable while locked
(`overlay_set_hot_zones`) by measuring its own header — Rust never hard-codes a
chrome height. The header element stays mounted at `opacity: 0` when hidden: a
hot zone with no rectangle is an overlay that can never be unlocked again.

## Platform shims

Everything the cross-platform API cannot express. Both run on the main thread —
Tauri commands do not, and NSWindow mutation is main-thread-only.

- **Windows** — `WS_EX_TOOLWINDOW`. Tauri's `skip_taskbar` is
  `ITaskbarList::DeleteTab`, which deletes the taskbar button only; Alt-Tab and
  Win+Tab consult `WS_EX_TOOLWINDOW`.
- **macOS** — `NSWindow.level` and `collectionBehavior`. `set_always_on_top`
  gives `NSFloatingWindowLevel` (3) only, which a game window can sit above, and
  a floating window is otherwise confined to its own Space. Set to
  `NSScreenSaverWindowLevel` with `CanJoinAllSpaces | FullScreenAuxiliary |
  IgnoresCycle`.
- macOS transparency additionally needs `app.macOSPrivateApi: true` plus the
  `macos-private-api` feature — without it `WebviewWindowBuilder::transparent`
  is `#[cfg]`-compiled away on that target and the build fails.

## Known limits

- **Windows click-through is a poll, not a hit-test.** The idiomatic Win32
  answer is to subclass the window proc and return `HTTRANSPARENT` from
  `WM_NCHITTEST` for pass-through regions — no polling at all, and exact. The
  poll is what works identically on all three platforms; the hit-test is the
  Windows-only upgrade if the sensor ever shows up in a profile.
- **No drag snapping.** Electron's `will-move` can veto a move mid-drag; Tauri
  has no pre-move hook, and `data-tauri-drag-region` hands the whole drag to the
  OS. Magnetic snapping would mean implementing drag in JS (pointer capture +
  `set_position`).
- **Bounds are not persisted** across sessions yet — `tauri-plugin-window-state`
  or a `localPrefs` entry.
- **Fullscreen-exclusive defeats any of this**, on every platform. The game must
  run windowed or borderless.
- A driver that cannot composite a transparent frameless window renders it as a
  black box. There is no opaque fallback mode yet.
