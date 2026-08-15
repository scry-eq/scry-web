# scry-web

React + TypeScript web client for Scry. Connects to a running daemon
(`scry-cpp` for Live EQ, `scry-cpp-quarm` for Project Quarm — the client is
daemon-agnostic and never branches on which one it's talking to) over
WebSocket, decodes `seq.v1` protobuf messages, and renders spawns, zones,
and player state in the browser.

## Stack

- [Vite](https://vitejs.dev/) for the dev server and build
- React 18 + TypeScript
- [`@bufbuild/protobuf`](https://github.com/bufbuild/protobuf-es) for protobuf
- Native `WebSocket` for transport

## Quick start

`bun run gen` runs `buf generate proto`, where `proto/` is the
[`scry-proto`](https://github.com/scry-eq/scry-proto)
git submodule. Initialize it on first checkout:

```sh
git clone --recurse-submodules https://github.com/scry-eq/scry-web.git
# or, if already cloned:
git submodule update --init --recursive

cd scry-web
bun install
bun run gen           # generates src/gen/ from proto/
bun run dev           # starts dev server on :5173
```

Open http://localhost:5173 with a running `scry-cpp` on
`ws://localhost:9090`.

## Connecting from an HTTPS-hosted page

When you load scry-web from `https://...` (e.g. the GitHub Pages
build), browsers block insecure `ws://` connections as mixed content,
and the daemon doesn't terminate TLS itself. Two ways around it:

- **Run the dev server locally.** `bun run dev` serves over plain
  `http://localhost:5173`, which is allowed to open `ws://localhost`
  connections — no TLS or tunneling needed.
- **SSH-tunnel a remote daemon to localhost.** If the daemon is on a
  different machine, forward its port over SSH and connect as if it
  were local:

  ```sh
  ssh -N -L 9090:localhost:9090 user@daemon-host
  ```

  Then point the client at `ws://localhost:9090` (Settings → Daemon
  URL). The browser sees a localhost target, so the mixed-content
  rule doesn't fire even on an HTTPS page; SSH carries the traffic.

## Desktop builds

Tagged releases (`v*`) publish three desktop bundles via GitHub Actions: a
Linux AppImage, a macOS `.dmg` (aarch64), and two Windows artifacts — an NSIS
installer and a portable `.exe` (`scry-web-vX.Y.Z-portable-x86_64.exe`)
cross-compiled from Linux via `cargo-xwin`.

**Windows users:** Tauri renders the UI through Microsoft's WebView2 runtime.
Windows 10 (newer builds) and Windows 11 ship it preinstalled with Edge, so
the portable `.exe` and the NSIS installer should both run with no setup. On
older or stripped-down Windows installs, grab the **Evergreen Bootstrapper**
from <https://developer.microsoft.com/microsoft-edge/webview2/> first — without
it the app launches to a blank window.

## Dev scripts

### Item icons (`scripts/gen-item-icons.py`)

The Loot History panel (and future buff/spell/AA panels) render real EQ item
icons via `src/ui/ItemIcon.tsx`, which reads sprite atlases from
`public/icons/`. Those PNGs are transcoded from the **local EQ/EQL client
install** and are **gitignored** — a fresh checkout must generate them once:

```
python3 scripts/gen-item-icons.py [SRC_DIR] [OUT_DIR]
#   SRC_DIR default: ~/src/showeq/EverQuest/uifiles/default   (varies per machine)
#   OUT_DIR default: public/icons
```

Needs Pillow (`pip install pillow`). The client ships `dragitem*.dds`
(DXT5-compressed), which Pillow reads natively — no texconv/ImageMagick. Each
`dragitemN.dds` is a 256×256 atlas of a 6×6 grid of 40×40 icons. An icon id
maps to a sprite by:

```
file = (icon - 500) // 36 + 1      # dragitem{file}.png
cell = (icon - 500) %  36
col  = cell % 6 ;  row = cell // 6 # sprite at (col*40, row*40)
```

The client path varies per machine — pass `SRC_DIR` if yours differs.

## Layout

```
src/
  main.tsx                    # Vite entry, mounts <App>
  index.css                   # Tailwind base + shared tokens
  title.ts                    # document.title sync (zone + connection state)
  gen/                        # generated protobuf (git-ignored)
  net/
    client.ts                 # WebSocket + subscribe/receive loop, resume
  lib/                        # EQ data tables + small utilities: chatColors.ts,
                               #   coords.ts (screen<->runtime coordinate convention),
                               #   equipModels.ts, races.ts, audioCue.ts, speech.ts, ...
  recorder/                   # loot-history recording (core.ts, loot.ts, schema.ts)
  state/
    store.ts                  # in-memory spawn/zone/chat/combat/buffs/group state
    layoutStore.ts            # panel docking (visibility, dockLocation, panelOrder, rails)
    prefsStore.ts             # user behavior toggles (selectOnConsider, smoothMovement, ...)
    spawnFilterStore.ts       # filter state shared by SpawnList + MapCanvas
    alertsStore.ts, boxStore.ts, localPrefs.ts, legacyKeys.ts, theme.ts
  ui/
    App.tsx                   # root layout, rails, panel orchestration
    MapCanvas.tsx             # canvas-based spawn map (geometry, FOV, hits)
    SpawnList.tsx             # tanstack-table spawn grid + tinting
    FloatingWindow.tsx        # detachable/dockable panel chrome (drag, resize, persistence)
    SnapZones.tsx             # rail snap-to-dock overlay during a drag
    Panel.tsx, RailDivider.tsx,   # generic panel/rail chrome
    ResizeHandle.tsx, VerticalResizeHandle.tsx
    *Panel.tsx / *Window.tsx      # ~30 docked panels + floating windows: stats, group,
                                   #   buffs, chat, combat, guild, AA, skills, loot,
                                   #   inventory stats, alerts, target, spawn points, ...
    classes.ts, concolor.ts,      # EQ presentation helpers: class id -> name/color,
    filterflags.ts, skills.ts     #   con-color math, FilterMgr bitmask + row tints, skill caps
```

## License

MIT. Deliberately permissive so any client fork can remain closed-source if
someone wants to build a private overlay against the same daemon.
