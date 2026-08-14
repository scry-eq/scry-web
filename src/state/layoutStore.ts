import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';

// Single source of truth for the panel-layout UI state. All of:
//   visibility / dockLocation / panelOrder / panelsLocked / rail widths /
//   left split
// live here and persist through the `scry.layout` key. Floating window
// pos+size for individual panels still live under their own
// `scry.windowPos.*` / `scry.windowSize.*` keys (managed by
// localPrefs + FloatingWindow) — that's per-window, not per-layout.

export type PanelKey =
  | 'spawns' | 'spawnPoints' | 'stats' | 'buffs' | 'targetEffects' | 'group' | 'chat' | 'combat' | 'expLog' | 'lootHistory';
export type DockLocation = 'left' | 'right' | 'floating';
export type RailSide = 'left' | 'right';
export type RailWidths = { left: number; right: number };

export const DEFAULT_VISIBILITY: Record<PanelKey, boolean> = {
  spawns:      true,
  spawnPoints: true,
  stats:       true,
  buffs:       false,
  targetEffects: false,
  group:       true,
  chat:        true,
  combat:      false,
  expLog:      false,
  lootHistory: false,
};

export const DEFAULT_DOCK_LOCATION: Record<PanelKey, RailSide> = {
  spawns:      'left',
  spawnPoints: 'left',
  stats:       'right',
  buffs:       'right',
  targetEffects: 'right',
  group:       'right',
  combat:      'right',
  chat:        'right',
  expLog:      'right',
  lootHistory: 'right',
};

export const DEFAULT_PANEL_ORDER: Record<RailSide, PanelKey[]> = {
  left:  ['spawns', 'spawnPoints'],
  right: ['stats', 'buffs', 'targetEffects', 'group', 'chat', 'combat', 'expLog', 'lootHistory'],
};

export const RAIL_MIN = 200;
export const RAIL_MAX = 600;
export const DEFAULT_LEFT_WIDTH = 320;
export const DEFAULT_RIGHT_WIDTH = 320;
export const LEFT_SPLIT_MIN = 0.15;
export const LEFT_SPLIT_MAX = 0.85;
export const DEFAULT_LEFT_SPLIT = 0.55;

const clampRail  = (w: number) => Math.max(RAIL_MIN, Math.min(RAIL_MAX, w));
const clampSplit = (s: number) => Math.max(LEFT_SPLIT_MIN, Math.min(LEFT_SPLIT_MAX, s));

const isPanelKey = (v: unknown): v is PanelKey =>
  typeof v === 'string' && v in DEFAULT_DOCK_LOCATION;

// One-time read of the legacy per-feature localStorage keys that
// existed before this store. Used as initial state so an existing
// install doesn't lose its layout the first time it picks up the
// migration. Once the persist middleware writes `scry.layout`,
// rehydration takes over and these legacy reads become no-ops.
function readLegacyJson<T>(key: string, validate: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadInitialVisibility(): Record<PanelKey, boolean> {
  const v = readLegacyJson<Partial<Record<PanelKey, boolean>>>('scry.panels',
    (x): x is Partial<Record<PanelKey, boolean>> => typeof x === 'object' && x !== null);
  return { ...DEFAULT_VISIBILITY, ...(v ?? {}) };
}

function loadInitialDockLocation(): Record<PanelKey, DockLocation> {
  const v = readLegacyJson<Partial<Record<PanelKey, DockLocation>>>('scry.dockLocation',
    (x): x is Partial<Record<PanelKey, DockLocation>> => typeof x === 'object' && x !== null);
  return { ...DEFAULT_DOCK_LOCATION, ...(v ?? {}) };
}

function loadInitialPanelOrder(): Record<RailSide, PanelKey[]> {
  const v = readLegacyJson<Partial<Record<RailSide, unknown>>>('scry.panelOrder',
    (x): x is Partial<Record<RailSide, unknown>> => typeof x === 'object' && x !== null);
  // No legacy data → use the documented default exactly. Don't fall
  // through to the backfill loop below, whose iteration order is the
  // declaration order of DEFAULT_DOCK_LOCATION and may not match
  // DEFAULT_PANEL_ORDER (which is the rail-render order users see).
  if (!v) {
    return { left: [...DEFAULT_PANEL_ORDER.left], right: [...DEFAULT_PANEL_ORDER.right] };
  }
  const result: Record<RailSide, PanelKey[]> = {
    left:  Array.isArray(v.left)  ? v.left.filter(isPanelKey)  : [],
    right: Array.isArray(v.right) ? v.right.filter(isPanelKey) : [],
  };
  // Backfill any keys missing from saved order with their defaults.
  const seen = new Set<PanelKey>([...result.left, ...result.right]);
  for (const k of Object.keys(DEFAULT_DOCK_LOCATION) as PanelKey[]) {
    if (!seen.has(k)) result[DEFAULT_DOCK_LOCATION[k]].push(k);
  }
  return result;
}

function loadInitialRailWidths(): RailWidths {
  const v = readLegacyJson<Partial<RailWidths>>('scry.railWidths',
    (x): x is Partial<RailWidths> => typeof x === 'object' && x !== null);
  return {
    left:  clampRail(v?.left  ?? DEFAULT_LEFT_WIDTH),
    right: clampRail(v?.right ?? DEFAULT_RIGHT_WIDTH),
  };
}

function loadInitialLeftSplit(): number {
  try {
    const raw = localStorage.getItem('scry.leftSplit');
    if (raw == null) return DEFAULT_LEFT_SPLIT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampSplit(parsed) : DEFAULT_LEFT_SPLIT;
  } catch {
    return DEFAULT_LEFT_SPLIT;
  }
}

function loadInitialPanelsLocked(): boolean {
  return localStorage.getItem('scry.panelsLocked') === '1';
}

function loadInitialStatusBarVisible(): boolean {
  // Default to visible — the bar carries info (zone server + EQ time)
  // that's hard to surface elsewhere. Hide-by-default would render the
  // first-launch experience strictly worse.
  const raw = localStorage.getItem('scry.statusBar');
  return raw == null ? true : raw === '1';
}

interface LayoutState {
  // Which top-level view fills the center area: the live map, or the loot browser.
  viewMode: 'map' | 'loot';
  visibility: Record<PanelKey, boolean>;
  dockLocation: Record<PanelKey, DockLocation>;
  panelOrder: Record<RailSide, PanelKey[]>;
  panelsLocked: boolean;
  statusBarVisible: boolean;
  railWidths: RailWidths;
  leftSplit: number;
  // Whole-rail collapse. Independent of per-panel visibility: a collapsed
  // rail keeps its panels assigned but hides the rail body so the map gets
  // the space. A thin reopen strip is rendered in App when collapsed.
  railCollapsed: { left: boolean; right: boolean };

  setViewMode: (v: 'map' | 'loot') => void;
  togglePanel: (k: PanelKey) => void;
  hidePanel: (k: PanelKey) => void;
  setPanelsLocked: (v: boolean) => void;
  setStatusBarVisible: (v: boolean) => void;
  setLeftRailWidth: (dx: number) => void;
  setRightRailWidth: (dx: number) => void;
  setLeftSplit: (updater: (prev: number) => number) => void;
  toggleRailCollapsed: (side: RailSide) => void;
  setRailCollapsed: (side: RailSide, v: boolean) => void;
  undock: (k: PanelKey, anchor?: { x: number; y: number; w: number; h: number }) => void;
  dockToSlot: (k: PanelKey, side: RailSide, slot?: number) => void;
  resetDockTo: (k: PanelKey) => void;
  resetLayout: () => void;
}

// Custom JSON storage so we don't have to repeat the boilerplate but
// still tolerate localStorage being absent (SSR shouldn't apply here,
// but cheap insurance).
const jsonStorage: PersistStorage<unknown> = {
  getItem: (name) => {
    try {
      const raw = localStorage.getItem(name);
      return raw ? (JSON.parse(raw) as StorageValue<unknown>) : null;
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* ignore */ }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* ignore */ }
  },
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      viewMode:     'map',
      visibility:   loadInitialVisibility(),
      dockLocation: loadInitialDockLocation(),
      panelOrder:   loadInitialPanelOrder(),
      panelsLocked: loadInitialPanelsLocked(),
      statusBarVisible: loadInitialStatusBarVisible(),
      railWidths:   loadInitialRailWidths(),
      leftSplit:    loadInitialLeftSplit(),
      railCollapsed: { left: false, right: false },

      togglePanel: (k) =>
        set((s) => ({ visibility: { ...s.visibility, [k]: !s.visibility[k] } })),
      hidePanel: (k) =>
        set((s) => ({ visibility: { ...s.visibility, [k]: false } })),
      setViewMode: (v) => set({ viewMode: v }),
      setPanelsLocked: (v) => set({ panelsLocked: v }),
      setStatusBarVisible: (v) => set({ statusBarVisible: v }),
      setLeftRailWidth: (dx) =>
        set((s) => ({ railWidths: { ...s.railWidths, left: clampRail(s.railWidths.left + dx) } })),
      setRightRailWidth: (dx) =>
        // Right rail grows when the handle is dragged leftward.
        set((s) => ({ railWidths: { ...s.railWidths, right: clampRail(s.railWidths.right - dx) } })),
      setLeftSplit: (updater) =>
        set((s) => ({ leftSplit: clampSplit(updater(s.leftSplit)) })),
      toggleRailCollapsed: (side) =>
        set((s) => ({ railCollapsed: { ...s.railCollapsed, [side]: !s.railCollapsed[side] } })),
      setRailCollapsed: (side, v) =>
        set((s) => ({ railCollapsed: { ...s.railCollapsed, [side]: v } })),

      undock: (k, anchor) => {
        // Seed the FloatingWindow's persisted pos+size to the panel's
        // current bounding rect so the in-place pop-out matches what the
        // user just released. FloatingWindow reads these on mount.
        if (anchor) {
          const id = `panel.${k}`;
          const cx = anchor.x + anchor.w / 2;
          const cy = anchor.y + anchor.h / 2;
          const offset = { x: cx - window.innerWidth / 2, y: cy - window.innerHeight / 2 };
          try {
            localStorage.setItem(`scry.windowPos.${id}`, JSON.stringify(offset));
            localStorage.setItem(`scry.windowSize.${id}`, JSON.stringify({ w: anchor.w, h: anchor.h }));
          } catch { /* storage full — fall back to default centered */ }
        }
        set((s) => ({ dockLocation: { ...s.dockLocation, [k]: 'floating' } }));
      },

      dockToSlot: (k, side, slot) =>
        set((s) => {
          const next: Record<RailSide, PanelKey[]> = {
            left:  s.panelOrder.left.filter((x) => x !== k),
            right: s.panelOrder.right.filter((x) => x !== k),
          };
          const insertAt = slot === undefined
            ? next[side].length
            : Math.max(0, Math.min(next[side].length, slot));
          next[side] = [...next[side].slice(0, insertAt), k, ...next[side].slice(insertAt)];
          return {
            panelOrder: next,
            dockLocation: { ...s.dockLocation, [k]: side },
          };
        }),

      resetDockTo: (k) => get().dockToSlot(k, DEFAULT_DOCK_LOCATION[k]),

      resetLayout: () => {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith('scry.windowPos.panel.') || k.startsWith('scry.windowSize.panel.')) {
            localStorage.removeItem(k);
          }
        }
        set({
          dockLocation: { ...DEFAULT_DOCK_LOCATION },
          panelOrder: {
            left:  [...DEFAULT_PANEL_ORDER.left],
            right: [...DEFAULT_PANEL_ORDER.right],
          },
          railWidths: { left: DEFAULT_LEFT_WIDTH, right: DEFAULT_RIGHT_WIDTH },
          leftSplit: DEFAULT_LEFT_SPLIT,
          railCollapsed: { left: false, right: false },
        });
      },
    }),
    {
      name: 'scry.layout',
      version: 1,
      storage: jsonStorage,
      // Persist data fields only — actions stay on the store but don't
      // need to round-trip through localStorage.
      partialize: (state) => ({
        viewMode: state.viewMode,
        visibility: state.visibility,
        dockLocation: state.dockLocation,
        panelOrder: state.panelOrder,
        panelsLocked: state.panelsLocked,
        statusBarVisible: state.statusBarVisible,
        railWidths: state.railWidths,
        leftSplit: state.leftSplit,
        railCollapsed: state.railCollapsed,
      }),
    },
  ),
);
