# The game overlay window

A second Tauri `WebviewWindow` (label `overlay`) that floats over the running
game: transparent, undecorated, always-on-top, click-through. Desktop only —
`OverlayToggle` renders nothing in a browser, because there is no web fallback
for an always-on-top OS window.

- `src-tauri/src/overlay.rs` — the window, the platform shims, and the two
  sensors (`mod sensor`, one per platform, same two entry points).
- `src/overlay/` — the page it loads (`overlay.html` is the second Vite entry).
- `src-tauri/capabilities/overlay.json` — capabilities are per-window, so the
  overlay's surface is declared separately from the main window's.

## Click-through, and why it differs per platform

Electron's `setIgnoreMouseEvents(true, {forward: true})` keeps a click-through
window receiving mouse-*moves*, which is how an Electron overlay reveals chrome
on hover while clicks still pass to the game. **Tauri has no equivalent.**
`set_ignore_cursor_events(ignore: bool)` takes no options and tao implements it
as `WS_EX_TRANSPARENT | WS_EX_LAYERED` — the window then receives *zero* mouse
events and CSS `:hover` is dead. So the two platforms answer differently.

**Windows — `WM_NCHITTEST`.** The window is subclassed
(`SetWindowSubclass`) and its proc answers `HTTRANSPARENT` for any point outside
a hot zone; the OS then carries on down the z-order and the game gets the click.
Exact, per-message, and it never sets `WS_EX_TRANSPARENT` at all. The same
message is also the hover signal — Windows sends `WM_NCHITTEST` for every mouse
move over the window, before it decides where to route the message — so entering
and crossing the overlay cost nothing but the message that was already being
sent.

Leaving is the one thing still sampled, because silence is ambiguous: a cursor
resting inside the window looks exactly like a cursor that walked out. A watcher
thread parks on a condvar and is woken by the hit-test when the cursor arrives,
checks at 120 ms until it leaves, then parks again. At rest it does not run.

**Everywhere else — sampled.** A thread sleeps, hops to the main thread, and
compares the global cursor to the window rect at 40 Hz. Measured on Xvfb +
llvmpipe (the slowest rendering path there is; on real hardware all three are
far lower):

| | CPU |
|---|---|
| main window only | 12.7% |
| \+ overlay window, sensor idle | 13.7% |
| \+ sensor at 40 Hz | 14.5% |

**~0.8% of one core.** Rate is `POLL` in `overlay.rs`.

Neither path installs a global mouse hook. Electron's `forward` installs
`WH_MOUSE_LL` owned by the app process, so every system mouse event waits on
that app's message loop and a stalled main thread freezes the user's cursor
system-wide. Neither of these can do that.

## Hot zones

The webview declares which regions stay clickable while locked
(`overlay_set_hot_zones`) by measuring its own header — Rust never hard-codes a
chrome height. The header element stays mounted at `opacity: 0` when hidden: a
hot zone with no rectangle is an overlay that can never be unlocked again.

Verified on Linux by reading the X input shape back off the server while warping
the pointer:

| cursor | input shape |
|---|---|
| outside the window | `1x1` — click-through |
| in the header (hot zone) | `340x200` — the pin and close button are clickable |
| in the body | `1x1` — click-through, even though the panel is under the cursor |

Geometry uses **`inner_position` + `inner_size`**, not outer. The webview's CSS
origin is the client area, so inner is the rectangle the hot zones were measured
against — and on GTK `outer_size` is fed by frame-extents events that never
arrive without a window manager, so it reads `0x0` and every point tests as
outside.

## Platform shims

Everything the cross-platform API cannot express. Both run on the main thread —
Tauri commands do not, and NSWindow mutation is main-thread-only.

- **Windows** — `WS_EX_TOOLWINDOW`. Tauri's `skip_taskbar` is
  `ITaskbarList::DeleteTab`, which deletes the taskbar button only; Alt-Tab and
  Win+Tab consult `WS_EX_TOOLWINDOW`. **It must be re-applied after every tao
  flag change.** `WindowState::apply_diff` rewrites the *whole* ex-style word
  from tao's own cached flags (`SetWindowLongW(GWL_EXSTYLE, …)`), so anything
  set behind its back is silently dropped by the next `show` / `set_focusable`
  / `set_always_on_top`. And `show()` only *queues* that change — it returns
  before `is_visible()` is even true — so "tune after show" is not enough on
  its own; there is a deferred re-apply as well. `platform_tune` only ORs bits,
  so running it repeatedly is free.
- **macOS** — `NSWindow.level` and `collectionBehavior`. `set_always_on_top`
  gives `NSFloatingWindowLevel` (3) only, which a game window can sit above, and
  a floating window is otherwise confined to its own Space. Set to
  `NSScreenSaverWindowLevel` with `CanJoinAllSpaces | FullScreenAuxiliary |
  IgnoresCycle`.
- macOS transparency additionally needs `app.macOSPrivateApi: true` plus the
  `macos-private-api` feature — without it `WebviewWindowBuilder::transparent`
  is `#[cfg]`-compiled away on that target and the build fails.

## First open

Centered, **unlocked**, chrome visible. That combination is deliberate: locked
means click-through with the header hidden, and an undecorated transparent
window is also absent from the taskbar and from Alt-Tab — so a locked first
open is a panel with no visible controls and no way to find it. The user locks
it once they can see where they put it.

For the same reason the panel is drawn opaque enough to read on its own
(`bg-black/75`, a light border, and bar tracks lighter than the panel rather
than darker). With no daemon connected there is no data to draw, so the panel
itself has to be the thing you see.

Release builds log to the OS log dir (`%LOCALAPPDATA%\com.scryeq.web\logs` on
Windows, `~/.local/share/com.scryeq.web/logs` on Linux) and record the
overlay's position, size and scale at open — a packaged app has no console, and
this is a window whose failure mode is being invisible.

## Known limits

- **Never touch the input shape before the window is realized.** On GTK
  `set_ignore_cursor_events(true)` reaches for the GdkWindow, which does not
  exist until the widget is realized, and tao unwraps it *inside the event
  loop* — a non-unwinding abort, not an error you can catch. Everything is
  gated on `is_visible()`.
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
