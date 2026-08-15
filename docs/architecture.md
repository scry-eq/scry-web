# Architecture

How scry-web's state and UI systems are put together. For commands and
behavior-changing gotchas, see [`../CLAUDE.md`](../CLAUDE.md).

## State management: three stores, one migration pattern

Three zustand stores hold persisted UI state, plus one non-persisted local
pattern. Add new app-wide settings to one of these rather than to `App.tsx`
`useState` + ad-hoc localStorage:

- **`useLayoutStore`** (`src/state/layoutStore.ts`, persists `scry.layout`
  v1) — panel docking. Shape: `visibility` (View-menu toggles),
  `dockLocation` (`left`/`right`/`floating` per panel key), `panelOrder`
  (per-rail key arrays — render order = array order, so reorder = move
  within the array), `panelsLocked` (freezes detach affordances),
  `statusBarVisible`, `railWidths`, `leftSplit`, `railCollapsed`
  (`{left,right}` whole-rail collapse — keeps panels assigned but hides the
  rail body so the map gets the space; a thin reopen strip plus a collapse
  chevron reopens it, and docking a panel onto a collapsed rail
  auto-expands it). Actions: `togglePanel`/`hidePanel`/`setPanelsLocked`/
  `setStatusBarVisible`/`setLeftRailWidth`/`setRightRailWidth`/
  `setLeftSplit`/`toggleRailCollapsed`/`setRailCollapsed`/`undock`/
  `dockToSlot`/`resetDockTo`/`resetLayout`. `resetLayout` also wipes
  `scry.windowPos.panel.*`/`scry.windowSize.panel.*` and clears
  `railCollapsed`.
- **`usePrefsStore`** (`src/state/prefsStore.ts`, persists `scry.prefs`
  v1) — the 6 user toggles: `selectOnConsider`, `selectOnTarget`,
  `deselectOnUntarget`, `trackPlayer`, `smoothMovement`,
  `predictiveMovement` (a variant of `smoothMovement` that dead-reckons
  spawns forward along their velocity vector instead of easing toward the
  last-reported position — inert unless `smoothMovement` is also on; the
  algorithm lives in `PosSmoother` in `MapCanvas.tsx`). Read prefs from
  non-React contexts (e.g. envelope subscribers) via
  `usePrefsStore.getState().x` — don't capture toggle values in closures,
  the store is the live source of truth.
- **`spawnFilterStore`** (`src/state/spawnFilterStore.ts`, persists
  `scry.spawnFilters`) — filter state shared by SpawnList + MapCanvas, via
  a `passesSpawnFilter(spawn, state)` predicate both surfaces apply
  (MapCanvas passes the whole store object as predicate state, so any field
  added here is honored on the map for free). Fields: `categoryFilter`,
  `hideFiltered`, `nameFilter`, level band (either absolute
  `levelMin`/`levelMax`, 0 = unbounded that side, OR
  `levelRelative`+`levelRelLow`/`levelRelHigh` — signed "±Me" offsets
  resolved by `resolveLevelBand` against the live, non-persisted
  `playerLevel` App syncs each tick; no-ops when level is unknown),
  `types` (npc/pc/corpse buckets via `spawnTypeBucket` — there's no PET on
  the wire, pets ride under NPC), and named `presets`
  (`savePreset`/`applyPreset`/`deletePreset`, each snapshotting all filter
  values; `applyPreset` deep-clones so presets don't alias live state). The
  advanced level+type controls live in a collapsed "Filters ▾" section in
  SpawnList's header. **Filters do NOT pierce selection** — hidden means
  hidden across both surfaces. Exception: the map's Z-window height filter
  is separate MapCanvas-local state (`useState`+localStorage+ref) and
  *does* pierce — see [Map rendering](#map-rendering) below.
- **`localPrefs`** (`src/state/localPrefs.ts`) — scoped to per-`FloatingWindow`
  pos/size only (`scry.windowPos.{id}`/`scry.windowSize.{id}`). Don't add
  app-wide settings here; it's component-local state with dynamic ids.

Both `useLayoutStore` and `usePrefsStore` read legacy per-key localStorage
on init so existing installs migrate without losing data.

**`SpawnStore` getters** (`chatLog()`/`combatLog()`/`combatEvents()`, not a
zustand store — the decode-side store) return the SAME array reference
forever and mutate it in place via `push`. Never wrap them in
`useMemo([fullLog])` — the dependency never changes, so the memo caches the
initial (often empty) filter result and the panel renders empty forever.
Filter inline instead; the arrays are bounded by `*_HISTORY_LIMIT` so it's
cheap. The `tick` prop (App's global 1s `setInterval`) is the re-render
driver, not the array reference — any floating panel reading async store
data (`store.inspectFor()`, `store.byId()`, etc.) needs `tick` passed in
for the same reason (same pattern as `PlayerPanel`, `BuffsPanel`).

## Floating windows and panel docking

Floating popups wrap `src/ui/FloatingWindow.tsx` — it handles drag
(react-draggable, controlled `position={pos}` mode with `setPos` on every
`onDrag`, because the store's ~1Hz tick re-renders the parent and
uncontrolled mode would snap back), SE-corner resize, and persistence via
`localPrefs.windowPos(id)`/`windowSize(id)`. Position is an offset from
CSS-centered (`{0,0}` = viewport-centered); first open is centered, drags
persist a delta.

Detached dock panels reuse the same `FloatingWindow` with id namespace
`panel.<key>` — keeps `panel.stats` (the docked Player rail panel,
detached) separate from `stats` (the standalone `StatsWindow`). The 5
floating utility windows (loot/skills/aa/stats/inventoryStats) keep bare
ids.

**Drag-out gesture**: a Panel header `pointerdown` → 6px threshold →
undock hands the active press off to the new floating window via
`flushSync(undock)` + a synthetic `mousedown` on
`[data-fw-id="panel.{key}"] .fw-drag-handle` at the current cursor —
same-tick handoff so the drag continues without a release+reclick. Don't
switch to rAF-based timing here; the gap reintroduces a visible jump on
small panels (Buffs).

**Snap-to-rail** uses the `SnapZones.tsx` overlay during floating-panel
drags. `hitTest()` returns `{side, slot}` — `slot` is computed from cursor
Y vs. each docked panel's mid-line in the target rail. Drop calls
`dockToSlot(key, side, slot)`, which splices the key into
`panelOrder[side]` at the chosen index.

## Coordinate convention

The daemon ships positions in **SCREEN convention** (`protoencoder.cpp`'s
`fillPos` negates EQ runtime X/Y; Z ships raw). The map renders directly in
that convention (identity `project()`), so dot/line/grid **geometry** is
correct as-is — but any coordinate **number** shown to the user must be
flipped back to EQ `/loc` convention (Y, X, Z) via `src/lib/coords.ts`
(`formatLoc`/`runtimeX`/`runtimeY`), or it reads negated/backwards vs.
in-game `/loc` and legacy showeq (which stays un-negated internally and
mirrors in its projection instead, so its grid labels are already
runtime). Route ALL new coordinate readouts (tooltips, grid ticks, panel
X/Y columns) through these helpers — status bar, map `HoverTip`, map grid
labels, and the Spawn Points X/Y columns already do.

## Con colors and chat colors

`src/ui/concolor.ts` is the con-color source of truth, **derived from the
client's own runtime con table** — not the legacy `Player::fillConTable`
ladder that used to back it (that ladder capped yellow at +3 and was off
by one at the grey/green edge on 19 player levels). The client builds a
131×131 int8 table at startup indexed `[myLevel][targetLevel]`; its
builder reduces to the closed form in `conOf` — `cyanBase`/`greenBase`
scale as 3/4 and 2/3 of player level until 60, then flatten to -15/-20,
each clamped against the band above. Two other mirrors of this logic exist
and must change together: `../scry-qt/src/util/ConColor.h` and
`../iced-miseru/src/concolor.rs`. Daemons carry **no** con logic — level
ships raw and each client colors it. Treat live con reports as ground
truth over the formula; if one disagrees, re-derive against the client
binary rather than reintroducing a per-level ladder, and add the case to
`concolor.test.ts`.

Chat line label + color is centralised in `src/lib/chatColors.ts`. Two key
spaces: `cc:<id>` for raw EQ ChatColor (`CC_*`), `mt:<id>` MessageType
fallback when `chatColor=0`. Unknown ids fall through to a gray
`CC#<n>`/`#<n>` placeholder — when one shows up in the UI, add an entry to
`CHAT_COLOR_ENTRIES` (label + default hex + category) rather than adding
bespoke handling elsewhere. Categories drive the settings-panel grouping.

## Map rendering

Map filters should let the selected spawn **pierce** — always draw it, keep
it in hit-testing, and keep the magenta connector, even when it's
out-of-band/category/otherwise filtered — so the user can still navigate to
it. Apply this to any future filter, not just the existing height filter.

`MapCanvas.tsx` view toggles (grid, FPS cap, height filter, …) use a local
`useState` + localStorage + ref pattern: the render-loop `useEffect`'s deps
are `[store]` only, so a toggle change doesn't restart the render loop —
refs (`showGridRef`, etc.) carry live values into it. Keep new map-local
toggles in this shape; don't promote them to `usePrefsStore`.

Static EQ lookup tables live in `src/lib/equipModels.ts` (weapon model
codes + armor materials — `equipSummary()` produces legacy-style
"C:Leather 1:MorningStar" strings) and `src/lib/races.ts` (full race
id→name table); `classShortOf(id)` in `src/ui/classes.ts` returns
WAR/CLR/PAL/RNG/SHD/etc.

## Debugging live state

**Chrome MCP / devtools**: the spawn position cache lives in a
`Map<spawnId, {prevX, prevY, targetX, targetY, updateTimeMs}>` at variable
fiber depth. Recipe: walk UP from the canvas element —
`canvas[Object.keys(canvas).find(k=>k.startsWith('__reactFiber'))]`, then
`.return.return` reaches `MapCanvas` — then walk its `memoizedState.next`
chain for `.current.positions instanceof Map` whose first value has
`targetX`. Do NOT start from `document.getElementById('root')`: root has
key `__reactContainer$...` not `__reactFiber$...` and the walk is harder
from there. Check `document.visibilityState !== 'hidden'` before debugging
the render loop — rAF freezes in background tabs, which makes fps=0 and
the smoother look frozen when it's actually fine. Spawn list table data is
at `f*.h*.current.options.data` (array of
`{id, name, level, klass, hpPct, distance, conColor, filterFlags, type}` —
has `distance`, not `x`/`y`).

**`scripts/diag-movement.ts`** — a standalone bun script connecting
directly to the daemon WebSocket; measures live position update rates,
step sizes, and dt distributions without needing Chrome tab focus. Run:
`~/.bun/bin/bun run scripts/diag-movement.ts [ws://host:port]`. Preferred
over Playwright for smooth-movement diagnosis.

**`scripts/watch-smoother.ts`** — a Playwright headless-Chrome smoother
watcher; requires the tab in the foreground (rAF freezes when hidden). Use
`diag-movement.ts` instead for live capture; this one is better for
watching visual lerp state.
