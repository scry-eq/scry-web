# The game overlay windows

Transparent, frameless, always-on-top, click-through `BrowserWindow`s that float over
the running game. Desktop only — `OverlayToggle` renders nothing in a browser, because
there is no web fallback for an always-on-top OS window.

**Kinds** (`electron/main/kinds.ts`): `vitals` — a small strip of zone, HP, mana, level
and spawn count; `map` — the full `MapCanvas`. Any combination can be open at once, each
its own window with its own remembered bounds. One `overlay.html` serves them all: the
window is loaded with `?kind=`, the preload reads it and threads it into every IPC call,
so a renderer can only ever address its own window. An unknown kind falls back to
`vitals` rather than throwing — a bad query string must not be able to take a window down.

The map overlay opens its own `SeqClient` and `SpawnStore` (`src/overlay/session.ts`)
rather than borrowing the main window's: an overlay has to keep working when the main
window is closed, and the daemon fans out to every subscriber anyway. `MapCanvas` takes
`compact`, which starts the view controls and info box collapsed — they cost half the
window at overlay sizes — and scopes their collapse state to separate storage keys so
folding them there does not fold the main window's map.

- `electron/main/overlay.ts` — the windows and their click-through policy.
- `electron/preload/overlay.ts` — their bridge, deliberately smaller than the main
  window's, and kind-scoped.
- `src/overlay/` — the page it loads. `overlay.html` is a second Vite entry, shared
  by the web build and the shell.

## Click-through

`setIgnoreMouseEvents(true, { forward: true })` is the whole mechanism. Clicks pass
to the game while the window still receives mouse-*moves*, so the renderer knows
where the pointer is and asks for capture back when it crosses the header. There is
no cursor sampling and no hot-zone bookkeeping anywhere.

**`forward` is Windows/macOS only.** Where it is unavailable — Linux — a click-through
window receives no mouse events at all, so hover-to-recover cannot work. The chrome
therefore stays visible when locked on those platforms (`FORWARDS_MOUSE`), because a
locked overlay with hidden chrome, no taskbar button and no Alt-Tab entry is one the
user cannot get back.

## Placement

The window reopens where the user last left it — `moved`/`resized` persist to
`shell.json` in the user data dir, debounced, with a flush on close so a drag that
ends in closing the window is not lost. Only those events are hooked, so nothing
records a position the app chose for itself.

A saved rectangle is used **only if it still lands on a display that exists now**.
Monitors get unplugged and resolutions change; restoring blindly then puts the
overlay somewhere unreachable, and it has no taskbar button or Alt-Tab entry to
recover it with. "Usable" means enough of the header to grab (120x28) overlaps some
display's work area — not a single pixel. Otherwise it falls back to centered.

## First open

Centered on the display under the cursor, **unlocked**, chrome visible. Locked is the
resting state for play, but locked means click-through with the header hidden — and
the window is deliberately absent from the taskbar (`skipTaskbar`) and from Alt-Tab
(`type: 'toolbar'`, i.e. `WS_EX_TOOLWINDOW`). Opening straight into that state gives
the user a panel they can neither see nor find. They lock it once they can see where
they put it.

The panel is drawn opaque enough to read on its own, with bar tracks lighter than the
panel rather than darker. With no daemon connected there is no data to draw, so the
panel itself has to be the thing you see.

Clicking Overlay reports what the window actually is — exists, visible, position,
size, scale, and the display layout — as a toast in the main window. An overlay that
fails by being invisible otherwise gives the user nothing to report.

## Build-shape rules that are easy to get wrong

Both of these fail *silently* — no error, just no bridge and no window:

- **Preloads must be CommonJS.** `package.json` is `type: module`, so a `.js` preload
  is read as ESM and never loads. They are emitted as `.cjs`.
- **`electron` must be externalized.** It is a devDependency, and electron-vite only
  externalizes `dependencies` by default — bundled, the npm package's Node-side
  launcher ends up inside the main bundle and the app tries to download a binary at
  startup. Externalizing it also stops rollup hoisting a shared chunk between the two
  preloads, which a sandboxed preload's `require` cannot resolve.

## Known limits

- **No drag snapping.** The header is a `-webkit-app-region: drag` region, so the OS
  runs the drag. Magnetic snapping would mean a `will-move` handler.
- **Fullscreen-exclusive defeats any of this**, on every platform. The game must run
  windowed or borderless.
- A driver that cannot composite a transparent frameless window renders it as a black
  box. There is no opaque fallback mode.
