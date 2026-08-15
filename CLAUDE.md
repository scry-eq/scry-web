# scry-web

React/TypeScript web client — connects to a scry daemon (`scry-cpp` or
`scry-cpp-quarm`) over WebSocket, speaking `seq.v1` protobuf. Daemon-agnostic:
the client never knows or branches on which server it's talking to. See
[`docs/architecture.md`](docs/architecture.md) for state management, the
floating-window/docking system, and the coordinate/con-color conventions.

## Stack

- React + TypeScript, Vite.
- Tailwind v4, TanStack Table, shadcn/ui (Radix-backed, à la carte
  components under `src/components/ui/`), zustand for cross-cutting state.
- **Use `~/.bun/bin/bun` for all JS tooling** — system Node 18 breaks
  Vite/Vitest.

## Structure

- `src/lib/` — `chatColors.ts`, `coords.ts`, `equipModels.ts`, `races.ts`
- `src/state/` — `layoutStore.ts`, `prefsStore.ts`, `spawnFilterStore.ts`,
  `localPrefs.ts`
- `src/ui/` — components, incl. `FloatingWindow.tsx`, `SnapZones.tsx`,
  `concolor.ts`, `classes.ts`
- `src/overlay/` — the transparent always-on-top overlay window's page
  (`overlay.html` is a second Vite entry; see `docs/overlay.md`)
- `src-tauri/` — the Tauri desktop shell: window policy, overlay window,
  per-window capabilities
- `src/**/*.test.ts` — vitest unit tests (happy-dom env)
- `e2e/**/*.spec.ts` — playwright e2e tests
- `scripts/` — `diag-movement.ts`, `watch-smoother.ts` (live-state
  diagnostics — see `docs/architecture.md`)
- `proto/` — git submodule → `scry-proto`

## Commands

- `bun run dev` — Vite dev server
- `bun run gen` — regenerate TS bindings from `proto/` via buf
- `bun run typecheck`
- `bun run test` — vitest unit tests
- `bun run test:e2e` — playwright e2e tests (against the local vite dev
  server, auto-started)
- `bun run smoke`
- `bun run tauri:dev` / `bun run tauri:build` — the desktop shell. Both
  drive Vite on :5173, so they collide with a `bun run dev` already up.

## Conventions

- **No hardcoded opcodes** — use `scry-proto` enums only.
- **The web layer never branches on target server.** If a feature seems to
  need target-specific code, the difference belongs in the daemon, not
  here.
- **Proto schema is unified** — there is no Quarm-specific proto; both
  daemons emit the same `seq.v1.*` messages. If a feature needs a new proto
  field, do the proto work as part of `scry-cpp` (Live) first; never
  request Quarm-only proto.
- New app-wide settings go into one of the three zustand stores (see
  `docs/architecture.md`), never into `App.tsx` `useState` + ad-hoc
  localStorage.

## Gotchas

- **`SpawnStore` getters (`chatLog()`/`combatLog()`/`combatEvents()`)
  return the SAME array reference forever and mutate in place.** Never
  wrap them in `useMemo([fullLog])` — the dependency never changes, so the
  memo caches the initial (often empty) result and the panel renders empty
  forever. Filter inline; the `tick` prop is the re-render driver, not the
  array reference.

## Before Committing

- `bun run typecheck`
- `bun run test` and `bun run test:e2e` — CI runs both on every push and
  PR; a failed playwright run uploads its report as an artifact. New
  unit-testable logic belongs in `src/**/*.test.ts`; reach for playwright
  only when the behavior depends on real pointer events or DOM layout.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — state management (the
  three zustand stores + `localPrefs`), the FloatingWindow/panel-docking
  system, the coordinate convention, con-color/chat-color source of truth,
  map rendering rules, and live-state debugging recipes.
- [`docs/overlay.md`](docs/overlay.md) — the transparent always-on-top
  overlay window: why its hover sensor polls, the per-platform shims, and
  what Tauri cannot express.
